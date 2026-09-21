import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentToolResult } from "../src/core/extensions/types.ts";
import { createCdTool } from "../src/core/tools/cd.ts";
import { resolveWithinJail } from "../src/core/tools/jail.ts";

let baseDir: string;
let jailRoot: string;
let subDir: string;
let filePath: string;
let linkPath: string;
let outsideDir: string;

beforeEach(() => {
	baseDir = realpathSync(mkdtempSync(join(tmpdir(), "cd-jail-")));
	jailRoot = join(baseDir, "jail");
	subDir = join(jailRoot, "sub");
	outsideDir = join(baseDir, "outside");
	linkPath = join(jailRoot, "link");
	filePath = join(jailRoot, "file.txt");
	mkdirSync(jailRoot, { recursive: true });
	mkdirSync(subDir, { recursive: true });
	mkdirSync(outsideDir, { recursive: true });
	writeFileSync(filePath, "data");
	// A directory symlink whose target points outside the jail.
	symlinkSync(outsideDir, linkPath, "dir");
});

afterEach(() => {
	rmSync(baseDir, { recursive: true, force: true });
});

function textOf(res: { content: { type: string; text?: string }[] }): string {
	return res.content[0].text ?? "";
}

type CdTool = ReturnType<typeof createCdTool>;

interface CdHarness {
	tool: CdTool;
	setCalls: string[];
	getCwd: () => string;
}

function makeCdHarness(cwd: string, jailRoot: string): CdHarness {
	const setCalls: string[] = [];
	const getCwd = () => cwd;
	const tool = createCdTool({ getCwd, setCwd: (dir) => setCalls.push(dir), jailRoot });
	return { tool, setCalls, getCwd };
}

function runCd(harness: CdHarness, path: string): Promise<AgentToolResult<undefined>> {
	return harness.tool.execute("call", { path });
}

describe("resolveWithinJail", () => {
	it("accepts a relative child directory", async () => {
		await expect(resolveWithinJail(jailRoot, jailRoot, "sub")).resolves.toEqual({ status: "ok", dir: subDir });
	});

	it("accepts '.' as the jail root itself", async () => {
		await expect(resolveWithinJail(jailRoot, jailRoot, ".")).resolves.toEqual({ status: "ok", dir: jailRoot });
	});

	it("accepts '..' from a subdirectory back to the jail root", async () => {
		await expect(resolveWithinJail(jailRoot, subDir, "..")).resolves.toEqual({ status: "ok", dir: jailRoot });
	});

	it("rejects '..' that would leave the jail root", async () => {
		await expect(resolveWithinJail(jailRoot, jailRoot, "..")).resolves.toEqual({
			status: "reject",
			reason: "path is outside the jail root",
		});
	});

	it("accepts an absolute path inside the jail root", async () => {
		await expect(resolveWithinJail(jailRoot, jailRoot, subDir)).resolves.toEqual({ status: "ok", dir: subDir });
	});

	it("rejects an absolute path outside the jail root", async () => {
		await expect(resolveWithinJail(jailRoot, jailRoot, outsideDir)).resolves.toEqual({
			status: "reject",
			reason: "path is outside the jail root",
		});
	});

	it("rejects a symlink whose target is outside the jail root", async () => {
		await expect(resolveWithinJail(jailRoot, jailRoot, "link")).resolves.toEqual({
			status: "reject",
			reason: "path is outside the jail root",
		});
	});

	it("rejects a non-existent path", async () => {
		await expect(resolveWithinJail(jailRoot, jailRoot, "nope")).resolves.toEqual({
			status: "reject",
			reason: "target does not exist",
		});
	});

	it("rejects a file that is not a directory", async () => {
		await expect(resolveWithinJail(jailRoot, jailRoot, "file.txt")).resolves.toEqual({
			status: "reject",
			reason: "target is not a directory",
		});
	});
});

describe("cd tool", () => {
	it("cd into a child directory: accepted, setCwd called with that directory", async () => {
		const harness = makeCdHarness(jailRoot, jailRoot);
		const res = await runCd(harness, "sub");
		expect(textOf(res)).toBe(`Changed directory to ${subDir}`);
		expect(harness.setCalls).toEqual([subDir]);
	});

	it("cd '.': accepted, cwd unchanged", async () => {
		const harness = makeCdHarness(jailRoot, jailRoot);
		const res = await runCd(harness, ".");
		expect(textOf(res)).toBe(`Changed directory to ${jailRoot}`);
		expect(harness.setCalls).toEqual([jailRoot]);
	});

	it("cd '..' from a subdirectory back to the jail root: accepted", async () => {
		const harness = makeCdHarness(subDir, jailRoot);
		const res = await runCd(harness, "..");
		expect(textOf(res)).toBe(`Changed directory to ${jailRoot}`);
		expect(harness.setCalls).toEqual([jailRoot]);
	});

	it("cd '..' that would leave the jail root: rejected, setCwd not called, error names the jail root", async () => {
		const harness = makeCdHarness(jailRoot, jailRoot);
		const res = await runCd(harness, "..");
		expect(textOf(res)).toContain(jailRoot);
		expect(harness.setCalls).toEqual([]);
	});

	it("cd to an absolute path inside the jail root: accepted, setCwd called", async () => {
		const harness = makeCdHarness(jailRoot, jailRoot);
		const res = await runCd(harness, subDir);
		expect(textOf(res)).toBe(`Changed directory to ${subDir}`);
		expect(harness.setCalls).toEqual([subDir]);
	});

	it("cd to an absolute path outside the jail root: rejected, setCwd not called", async () => {
		const harness = makeCdHarness(jailRoot, jailRoot);
		const res = await runCd(harness, outsideDir);
		expect(textOf(res)).toContain(jailRoot);
		expect(harness.setCalls).toEqual([]);
	});

	it("cd through a symlink whose target is outside the jail root: rejected, setCwd not called", async () => {
		const harness = makeCdHarness(jailRoot, jailRoot);
		const res = await runCd(harness, "link");
		expect(textOf(res)).toContain(jailRoot);
		expect(harness.setCalls).toEqual([]);
	});

	it("cd to a non-existent path: rejected, setCwd not called", async () => {
		const harness = makeCdHarness(jailRoot, jailRoot);
		const res = await runCd(harness, "nope");
		expect(textOf(res)).toContain(jailRoot);
		expect(harness.setCalls).toEqual([]);
	});

	it("cd to a file (not a directory): rejected, setCwd not called", async () => {
		const harness = makeCdHarness(jailRoot, jailRoot);
		const res = await runCd(harness, "file.txt");
		expect(textOf(res)).toContain(jailRoot);
		expect(harness.setCalls).toEqual([]);
	});
});
