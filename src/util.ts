export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
