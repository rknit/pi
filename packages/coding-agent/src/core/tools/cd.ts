import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { resolveWithinJail } from "./jail.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const cdSchema = Type.Object({
	path: Type.String({ description: "Directory to change to (relative or absolute)" }),
});

export const cdToolSystemPromptContribution = {
	snippet: "Change working directory",
	guidelines: [
		"Use cd to change the working directory. It is confined to the jail root and cannot escape it.",
		"Use the cd tool to change the working directory; a bash cd only affects that single command.",
	],
} as const;

export type CdToolInput = Static<typeof cdSchema>;

export interface CdToolOptions {
	/** Read the current working directory. */
	getCwd: () => string;
	/** Change the working directory to an accepted directory. */
	setCwd: (dir: string) => void;
	/** Jail root the working directory must stay within. */
	jailRoot: string;
}

export function createCdToolDefinition(options: CdToolOptions): ToolDefinition<typeof cdSchema, undefined> {
	return {
		name: "cd",
		label: "cd",
		description:
			"Change the working directory to the given path, confined to the jail root. Rejects paths that do not exist, that are not directories, or whose real location resolves outside the jail root (including through symlinks).",
		promptSnippet: cdToolSystemPromptContribution.snippet,
		promptGuidelines: [...cdToolSystemPromptContribution.guidelines],
		parameters: cdSchema,
		async execute(_toolCallId, { path }: CdToolInput, _signal?: AbortSignal, _onUpdate?, _ctx?: ExtensionContext) {
			const decision = await resolveWithinJail(options.jailRoot, options.getCwd(), path);
			if (decision.status === "ok") {
				options.setCwd(decision.dir);
				return { content: [{ type: "text", text: `Changed directory to ${decision.dir}` }], details: undefined };
			}
			return {
				content: [{ type: "text", text: `cd rejected: ${decision.reason} (jail root: ${options.jailRoot})` }],
				details: undefined,
			};
		},
	};
}

export function createCdTool(options: CdToolOptions): AgentTool<typeof cdSchema> {
	return wrapToolDefinition(createCdToolDefinition(options));
}
