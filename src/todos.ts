import type { TodoPhase } from "./types";
import { isRecord } from "./util";

function validPhases(value: unknown): value is TodoPhase[] {
	return (
		Array.isArray(value) &&
		value.every(
			phase =>
				isRecord(phase) &&
				typeof phase.name === "string" &&
				Array.isArray(phase.tasks) &&
				phase.tasks.every(task => isRecord(task) && typeof task.content === "string" && typeof task.status === "string"),
		)
	);
}

/** Newest canonical OMP todo snapshot: the last todo tool result or user edit, whichever is later. */
export function latestTodos(entries: unknown[]): TodoPhase[] {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!isRecord(entry)) continue;

		if (entry.type === "custom" && entry.customType === "user_todo_edit" && isRecord(entry.data)) {
			if (validPhases(entry.data.phases)) return entry.data.phases;
			continue;
		}

		if (entry.type !== "message" || !isRecord(entry.message)) continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== "todo" || message.isError === true) continue;
		if (isRecord(message.details) && validPhases(message.details.phases)) return message.details.phases;
	}
	return [];
}

export function formatTodos(phases: TodoPhase[]): string {
	if (phases.length === 0) return "No canonical OMP todo list exists yet.";
	const lines: string[] = [];
	for (const phase of phases) {
		lines.push(phase.name + ":");
		for (const task of phase.tasks) {
			const blocker = task.blocker ? "; blocker: " + task.blocker : "";
			lines.push("- [" + task.status + "] " + task.content + blocker);
		}
	}
	return lines.join("\n");
}
