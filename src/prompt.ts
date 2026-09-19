import { notesPath, peerAgent, peerId } from "./identity";
import { modelLabel } from "./models";
import type { PromptEvent, RoomState } from "./types";

function promptArray(prompt: PromptEvent["systemPrompt"]): string[] {
	if (Array.isArray(prompt)) return prompt;
	return typeof prompt === "string" && prompt.length > 0 ? [prompt] : [];
}

/** Wrap the session's own system prompt with the room layer; the host replaces per turn. */
export function withRoomPrompt(
	event: PromptEvent,
	state: RoomState,
	todoSnapshot: string,
	pendingQuestions: string[] = [],
): { systemPrompt: string[] } {
	const layers = [buildRoomPrompt(state, todoSnapshot)];
	if (pendingQuestions.length > 0) {
		layers.push(
			[
				"## Duo pending questions",
				"",
				"Answer these room questions through Agent Hub (ANSWER <id> <answer>) before starting new work:",
				...pendingQuestions.map(line => "- " + line),
			].join("\n"),
		);
	}
	return { systemPrompt: [...promptArray(event.systemPrompt), ...layers] };
}

export function buildRoomPrompt(state: RoomState, todoSnapshot: string): string {
	const visible = modelLabel(state.visible);
	const peer = modelLabel(state.peer);
	return [
		"## Duo room is active",
		"",
		"You are " + visible + ", the visible member of a two-model room. " + peer + " is the equal member in a hidden OMP harness. Neither member is the other's lead, manager, sidecar, or subordinate.",
		"",
		"When a goal arrives, first view OMP's canonical todo list and open a conversation with " + peer + ". Share the goal, repository state, todo snapshot, constraints, and acceptance checks. Ask what it is strongest at for this goal, state what you are strongest at, and negotiate the split. Do not hand it a finished assignment before that exchange.",
		"",
		"Use the task agent " + peerAgent + " exactly once to admit the hidden member, with stable name " + peerId + ". Omit isolated mode. Its opening task is to join the room, inspect the shared goal and todo snapshot, and send a PROPOSE message through Agent Hub. After it exists, talk through hub messages. An idle peer is still in the room and a message wakes it.",
		"",
		"Once both members agree, record the agreement in the canonical todo list. You operate the todo tool because the visible OMP harness owns it; that makes you the recorder, not the decision maker. Keep the peer item pending while it runs so OMP can associate live work with the todo. Both members share the same repository and working directory, must claim non-overlapping files before edits, and should challenge each other's assumptions.",
		"",
		"Keep the room legible in the chat. When the split is agreed or changes, print two short lines: [Duo] " + visible + " is working on <task> and [Duo] " + peer + " is working on <task>. Send a short STATUS hub message when you start your item and at each meaningful checkpoint so the room board stays current. Repeat status only when it changes, a blocker appears, or work finishes. Echo important peer updates so the user never has to open Agent Hub to know who is doing what.",
		"",
		"The peer uses PROPOSE <split>, AGREE <task and owned paths>, STATUS <task and state>, BLOCKED <task and reason>, and DONE <task and evidence>. A single matching AGREE closes negotiation: do not acknowledge an AGREE, repeat a settled message, or create an acknowledgment loop. Verify each other's claims, run project-wide validation only after both sides settle, and do not mark the whole goal complete until both agree.",
		"",
		"Questions between members use ASK <id> <question> and ANSWER <id> <answer> over Agent Hub; send an ASK with await:true when you cannot safely proceed without the answer. Keep at most three questions unanswered at once, and answer any pending question before starting new work. Pick short ids (q1, q2…) that both members reuse verbatim.",
		"",
		"The room keeps shared working notes in " + notesPath + " with sections DECISIONS, QUESTIONS, CLAIMS, and OPEN. Both members may append one-line entries (append-only, never rewrite history); read the notes before proposing a split, record the agreed split under DECISIONS, record open questions under QUESTIONS until answered, and record claimed files under CLAIMS. The notes survive context compaction, so anything settled in negotiation must land there.",
		"",
		"Current canonical OMP todo snapshot:",
		todoSnapshot,
	].join("\n");
}
