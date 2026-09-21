import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { resolveToCwd } from "./path-utils.ts";

export type JailDecision = { status: "ok"; dir: string } | { status: "reject"; reason: string };

/**
 * Resolve `requestedPath` against `currentCwd`, follow symlinks to the real
 * target, and accept only when that target is `jailRoot` or nested directly
 * under it. Symlinks are resolved before the boundary check, so a link that
 * points outside the jail is rejected.
 */
export async function resolveWithinJail(
	jailRoot: string,
	currentCwd: string,
	requestedPath: string,
): Promise<JailDecision> {
	const resolved = resolveToCwd(requestedPath, currentCwd);

	let realTarget: string;
	try {
		realTarget = await realpath(resolved);
	} catch {
		return { status: "reject", reason: "target does not exist" };
	}

	const jailReal = await realpath(jailRoot);
	if (realTarget === jailReal) {
		return { status: "ok", dir: realTarget };
	}

	const stats = await stat(realTarget);
	if (!stats.isDirectory()) {
		return { status: "reject", reason: "target is not a directory" };
	}

	const root = jailReal.endsWith(path.sep) ? jailReal : `${jailReal}${path.sep}`;
	if (!realTarget.startsWith(root)) {
		return { status: "reject", reason: "path is outside the jail root" };
	}

	return { status: "ok", dir: realTarget };
}
