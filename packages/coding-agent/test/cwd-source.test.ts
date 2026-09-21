import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import {
	type BashToolInput,
	createBashTool,
	createReadTool,
	createReadToolDefinition,
	type ReadToolInput,
} from "../src/core/tools/index.ts";

let currentCwd: string;
let dirA: string;
let dirB: string;
let bashTool: ReturnType<typeof createBashTool>;
let readTool: ReturnType<typeof createReadTool>;
let readDef: ReturnType<typeof createReadToolDefinition>;

function makeTempDir(prefix: string): string {
	const raw = mkdtempSync(join(tmpdir(), prefix));
	return realpathSync(raw);
}

function textOf(res: { content: { type: string; text?: string }[] }): string {
	return res.content[0].text ?? "";
}

beforeEach(() => {
	dirA = makeTempDir("cwd-src-a-");
	dirB = makeTempDir("cwd-src-b-");
	writeFileSync(join(dirA, "file.txt"), "content-A");
	writeFileSync(join(dirB, "file.txt"), "content-B");
	currentCwd = dirA;
	bashTool = createBashTool(() => currentCwd);
	readTool = createReadTool(() => currentCwd);
	readDef = createReadToolDefinition(() => currentCwd);
});

afterEach(() => {
	rmSync(dirA, { recursive: true, force: true });
	rmSync(dirB, { recursive: true, force: true });
});

describe("CwdSource", () => {
	it("a string source resolves to itself", async () => {
		const t = createBashTool(dirA);
		const res = await t.execute("call-1", { command: "pwd" } as BashToolInput);
		expect(textOf(res).trim()).toBe(dirA);
	});

	it("a live source redirects every subsequent call to the current value", async () => {
		expect(textOf(await bashTool.execute("call-1", { command: "pwd" } as BashToolInput)).trim()).toBe(dirA);
		expect(textOf(await readTool.execute("call-1", { path: "file.txt" } as ReadToolInput)).trim()).toBe("content-A");
		currentCwd = dirB;
		expect(textOf(await bashTool.execute("call-2", { command: "pwd" } as BashToolInput)).trim()).toBe(dirB);
		expect(textOf(await readTool.execute("call-2", { path: "file.txt" } as ReadToolInput)).trim()).toBe("content-B");
	});

	it("a per-call cwd override still wins over the live source", async () => {
		const ctx = { cwd: dirB } as ExtensionContext;
		const res = await readDef.execute("call-1", { path: "file.txt" } as ReadToolInput, undefined, undefined, ctx);
		expect(textOf(res).trim()).toBe("content-B");
	});
});
