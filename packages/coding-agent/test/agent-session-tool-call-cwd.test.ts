import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("tool_call event cwd", () => {
	let harness: Harness;
	let cwdSeen: string[];

	const echoTool: AgentTool = {
		name: "echo",
		label: "Echo",
		description: "Echo text back",
		parameters: Type.Object({ text: Type.String() }),
		execute: async () => ({
			content: [{ type: "text", text: "ok" }],
			details: {},
		}),
	};

	beforeEach(async () => {
		cwdSeen = [];
		harness = await createHarness({
			tools: [echoTool],
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", (event) => {
						cwdSeen.push(event.cwd);
					});
				},
			],
		});
	});

	afterEach(() => {
		harness.cleanup();
	});

	it("reflects the live session cwd on tool_call events after setCwd", async () => {
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
		]);
		await harness.session.prompt("hi");
		expect(cwdSeen).toEqual([harness.tempDir]);

		const dirB = join(harness.tempDir, "B");
		mkdirSync(dirB, { recursive: true });
		harness.session.setCwd(dirB);
		expect(harness.session.cwd).toBe(dirB);

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "again" })], { stopReason: "toolUse" }),
		]);
		await harness.session.prompt("hi");
		expect(cwdSeen).toEqual([harness.tempDir, dirB]);
	});
});
