import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("AgentSession cd tool and cwd reload", () => {
	let baseDir: string;
	let agentDir: string;
	let dirA: string;
	let dirB: string;
	let outsideDir: string;

	beforeEach(() => {
		// baseDir is the temp root and doubles as the jailRoot.
		baseDir = mkdtempSync(join(tmpdir(), "pi-cd-session-"));
		agentDir = join(baseDir, "agent");
		dirA = join(baseDir, "A");
		dirB = join(baseDir, "B");
		outsideDir = mkdtempSync(join(tmpdir(), "pi-cd-outside-"));
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(dirA, { recursive: true });
		mkdirSync(dirB, { recursive: true });
		mkdirSync(outsideDir, { recursive: true });
		// Each child has its own AGENTS.md; the jail root has none, so the initial
		// prompt carries no project context and accumulation is attributable to the children.
		writeFileSync(join(dirA, "AGENTS.md"), "MARKER_A");
		writeFileSync(join(dirB, "AGENTS.md"), "MARKER_B");
	});

	afterEach(() => {
		for (const dir of [baseDir, outsideDir]) {
			if (dir && existsSync(dir)) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	async function buildSetup() {
		const settingsManager = SettingsManager.create(baseDir, agentDir);
		const sessionManager = SessionManager.inMemory();
		const resourceLoader = new DefaultResourceLoader({
			cwd: baseDir,
			agentDir,
			settingsManager,
			jailRoot: baseDir,
		});
		await resourceLoader.reload();
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		return { settingsManager, sessionManager, resourceLoader, model };
	}

	async function createSession(): Promise<AgentSession> {
		const { settingsManager, sessionManager, resourceLoader, model } = await buildSetup();
		const { session } = await createAgentSession({
			cwd: baseDir,
			agentDir,
			model,
			settingsManager,
			sessionManager,
			resourceLoader,
			jailRoot: baseDir,
		});
		return session;
	}

	it("reloads context files and the cwd line, accumulating across setCwd calls", async () => {
		const session = await createSession();

		// No AGENTS.md at the jail root, so the initial prompt has no project context.
		expect(session.systemPrompt).not.toContain("MARKER_A");
		expect(session.systemPrompt).not.toContain("MARKER_B");

		session.setCwd(dirA);
		expect(session.systemPrompt).toContain("MARKER_A");
		expect(session.systemPrompt).not.toContain("MARKER_B");
		expect(session.systemPrompt).toContain(`Current working directory: ${dirA}`);
		expect(session.cwd).toBe(dirA);

		// A further cd to B accumulates B's context file alongside A's (no drop).
		session.setCwd(dirB);
		expect(session.systemPrompt).toContain("MARKER_A");
		expect(session.systemPrompt).toContain("MARKER_B");
		expect(session.systemPrompt).toContain(`Current working directory: ${dirB}`);
		expect(session.cwd).toBe(dirB);

		session.dispose();
	});

	it("keeps the tool registry and custom tools intact across setCwd", async () => {
		const { settingsManager, sessionManager, resourceLoader, model } = await buildSetup();
		// customTools is inlined as a direct argument to createAgentSession so the object
		// literal keeps contextual typing.
		const { session } = await createAgentSession({
			cwd: baseDir,
			agentDir,
			model,
			settingsManager,
			sessionManager,
			resourceLoader,
			jailRoot: baseDir,
			customTools: [
				{
					name: "mytool",
					label: "My Tool",
					description: "A custom tool injected through the SDK",
					parameters: Type.Object({}),
					execute: async () => ({
						content: [{ type: "text", text: "ok" }],
						details: {},
					}),
				},
			],
		});

		// The custom tool is registered and active before the cwd change.
		expect(session.getAllTools().map((tool) => tool.name)).toContain("mytool");
		expect(session.getActiveToolNames()).toContain("mytool");

		session.setCwd(dirA);

		// setCwd updates the cwd and prompt but does not rebuild the registry, so the
		// custom tool (and the built-ins) remain registered and active afterward.
		expect(session.getAllTools().map((tool) => tool.name)).toContain("mytool");
		expect(session.getActiveToolNames()).toContain("mytool");
		expect(session.getAllTools().map((tool) => tool.name)).toContain("read");

		session.dispose();
	});

	it("registers the cd tool when the session is constructed with a jailRoot", async () => {
		const session = await createSession();
		expect(session.getActiveToolNames()).toContain("cd");
		expect(session.getAllTools().map((tool) => tool.name)).toContain("cd");
		expect(session.agent.state.tools.find((tool) => tool.name === "cd")).toBeDefined();
		session.dispose();
	});

	it("moves the session cwd when cd targets a directory inside the jail", async () => {
		const session = await createSession();
		expect(session.cwd).toBe(baseDir);

		const cdTool = session.agent.state.tools.find((tool) => tool.name === "cd")!;
		const res = await cdTool.execute("call", { path: "A" });

		expect(session.cwd).toBe(dirA);
		expect(res.content[0]).toMatchObject({ type: "text", text: `Changed directory to ${dirA}` });

		session.dispose();
	});

	it("moves the tool-execution cwd, not just the session cwd, after cd", async () => {
		const session = await createSession();
		expect(session.cwd).toBe(baseDir);

		const bashTool = session.agent.state.tools.find((tool) => tool.name === "bash")!;
		const pwdText = (res: { content: { type: string; text?: string }[] }) => {
			const text = res.content.find((c) => c.type === "text");
			return (text?.text ?? "").trim();
		};

		const before = await bashTool.execute("call", { command: "pwd" });
		expect(before.content[0]).toMatchObject({ type: "text" });
		expect(pwdText(before)).toContain(baseDir);

		session.setCwd(dirA);
		expect(session.cwd).toBe(dirA);

		const after = await bashTool.execute("call", { command: "pwd" });
		expect(after.content[0]).toMatchObject({ type: "text" });
		expect(pwdText(after)).toContain(dirA);

		session.dispose();
	});

	it("leaves the session cwd unchanged when cd targets a directory outside the jail", async () => {
		const session = await createSession();
		expect(session.cwd).toBe(baseDir);

		const cdTool = session.agent.state.tools.find((tool) => tool.name === "cd")!;
		const res = await cdTool.execute("call", { path: outsideDir });

		// The target is outside the jail, so the cd tool soft-rejects: it reports
		// the rejection and does not call setCwd, leaving the cwd untouched.
		expect(session.cwd).toBe(baseDir);
		expect(res.content[0]).toMatchObject({ type: "text" });
		expect(res.content[0]).toMatchObject({ text: expect.stringContaining("path is outside the jail root") });

		session.dispose();
	});
});
