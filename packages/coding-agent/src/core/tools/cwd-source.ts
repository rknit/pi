export type CwdSource = string | (() => string);

export function resolveCwdSource(source: CwdSource): string {
	return typeof source === "function" ? source() : source;
}
