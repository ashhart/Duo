import { cleanPeerBody, taskLine } from "./board";
import { registerDuoCommand } from "./command";
import { notesPath, peerAgent, peerId } from "./identity";
import { peerMessagesFromEntries, peerMessagesFromHubDetails, peerMessagesFromHubText, unseenPeerMessages, type PeerMessage } from "./irc-watch";
import { modelLabel, modelSelector } from "./models";
import { withRoomPrompt } from "./prompt";
import { parseProtocolMessage } from "./board";
import {
	notedAgreements,
	pendingQuestionLines,
	pendingTaskCalls,
	persistRoomState,
	persistedRoomFromBranch,
	progressOf,
	questionTracker,
	renderRoomBoard,
	renderStatus,
	roomMessage,
	roomStateOf,
	roomStates,
	seenPeerMessageIds,
	spawnedSessions,
	teardownRoom,
} from "./room";
import { peerSpawnIntent, preparePeerTask } from "./task-guard";
import { ensurePeerOverride } from "./settings";
import { formatTodos, latestTodos } from "./todos";
import type { CommandContext, OmpExtensionApi } from "./types";
import { isRecord } from "./util";

/**
 * Mechanically track the room protocol: agreement, blockers, and completions
 * become chat lines and board state from real traffic, not prompt compliance.
 */
function noteProtocolEvent(
	api: OmpExtensionApi,
	context: CommandContext,
	side: "visible" | "peer",
	body: string,
): void {
	const state = roomStateOf(context);
	if (!state) return;
	const parsed = parseProtocolMessage(body);
	if (!parsed) return;
	const label = modelLabel(side === "visible" ? state.visible : state.peer);
	if (parsed.verb === "AGREE" && !notedAgreements.has(context.sessionManager)) {
		notedAgreements.add(context.sessionManager);
		progressOf(context).visibleTask = "agreed: " + parsed.summary;
		progressOf(context).peerTask = "agreed: " + parsed.summary;
		roomMessage(
			api,
			"[Duo] Agreement recorded — " + parsed.summary + ". Both members start their own sides.",
			{ kind: "agreed", summary: parsed.summary },
		);
	} else if (parsed.verb === "ASK" && parsed.refId) {
		questionTracker(context).set(parsed.refId, { side, summary: parsed.summary });
		progressOf(context)[side === "visible" ? "visibleTask" : "peerTask"] =
			"asking " + parsed.refId + ": " + parsed.summary;
		roomMessage(api, "[Duo] " + label + " asks (" + parsed.refId + "): " + parsed.summary, {
			kind: "ask",
			side,
			refId: parsed.refId,
			summary: parsed.summary,
		});
	} else if (parsed.verb === "ANSWER" && parsed.refId) {
		const resolved = questionTracker(context).delete(parsed.refId);
		roomMessage(
			api,
			"[Duo] " + label + " answered (" + parsed.refId + "): " + parsed.summary,
			{ kind: "answered", side, refId: parsed.refId, summary: parsed.summary, resolved },
		);
	} else if (parsed.verb === "BLOCKED") {
		progressOf(context)[side === "visible" ? "visibleTask" : "peerTask"] = "blocked: " + parsed.summary;
		roomMessage(api, "[Duo] " + label + " is blocked: " + parsed.summary, {
			kind: "blocked",
			side,
			summary: parsed.summary,
		});
	} else if (parsed.verb === "DONE") {
		progressOf(context)[side === "visible" ? "visibleTask" : "peerTask"] = "done: " + parsed.summary;
		roomMessage(api, "[Duo] " + label + " finished: " + parsed.summary, {
			kind: "member-done",
			side,
			summary: parsed.summary,
		});
	}
}

/** Surface peer messages as readable chat lines and board updates. */
function echoPeerMessages(api: OmpExtensionApi, context: CommandContext, messages: PeerMessage[]): void {
	const state = roomStateOf(context);
	if (!state) return;
	const seen = seenPeerMessageIds(context);
	let changed = false;
	for (const message of unseenPeerMessages(messages, seen)) {
		seen.add(message.id);
		changed = true;
		const body = cleanPeerBody(message.body);
		noteProtocolEvent(api, context, "peer", body);
		const task = taskLine(body);
		if (task) progressOf(context).peerTask = task;
		roomMessage(
			api,
			"[Duo · " + modelLabel(state.peer) + "] " + body.replace(/\s+/g, " ").slice(0, 400),
			{ kind: "peer-message", from: modelSelector(state.peer), ircId: message.id },
		);
	}
	if (changed) renderRoomBoard(context, state);
}

/** Restore a room persisted by a previous process for this session branch. */
async function rebuildPersistedRoom(api: OmpExtensionApi, context: CommandContext): Promise<void> {
	if (roomStateOf(context)) return;
	const entries = context.sessionManager.getBranch?.() ?? [];
	const state = persistedRoomFromBranch(entries);
	if (!state) return;
	await ensurePeerOverride(modelSelector(state.peer));
	roomStates.set(context.sessionManager, state);
	renderStatus(context, state);
	renderRoomBoard(context, state);
	roomMessage(
		api,
		"[Duo] Room resumed: " +
			modelLabel(state.visible) +
			" + " +
			modelLabel(state.peer) +
			". The hidden member may be parked — wake it with a hub message, or admit it once more if it is gone.",
		{ kind: "resumed", visible: modelSelector(state.visible), peer: modelSelector(state.peer) },
	);
}

export default function localDuoExtension(api: OmpExtensionApi): void {
	const reset = async (_event: unknown, context: CommandContext): Promise<void> => {
		await teardownRoom(api, context, roomStateOf(context));
		// A resumed session carries its room in the branch; bring it back.
		await rebuildPersistedRoom(api, context);
	};

	api.on("session_start", reset);
	api.on("session_switch", reset);
	api.on("session_branch", reset);
	api.on("session_shutdown", async (_event, context) => {
		await teardownRoom(api, context, roomStateOf(context));
	});

	api.on("before_agent_start", async (event, context) => {
		const state = roomStateOf(context);
		if (!state) return undefined;
		if (state.closing) return { systemPrompt: [
			...(Array.isArray(event.systemPrompt) ? event.systemPrompt : event.systemPrompt ? [event.systemPrompt] : []),
			'Duo is closing: call hub {"op":"cancel","ids":["DuoPeer"]}; do not admit or wake a peer or begin new work.',
		] };
		// The override lives in process-global runtime settings; re-assert it in
		// case another session's lifecycle event dropped it.
		await ensurePeerOverride(modelSelector(state.peer));
		const entries = context.sessionManager.getBranch?.() ?? [];
		// Async peer deliveries land as irc entries between turns; echo any the
		// live message_end hook below could not have seen yet.
		echoPeerMessages(api, context, peerMessagesFromEntries(entries, peerId));
		return withRoomPrompt(event, state, formatTodos(latestTodos(entries)), pendingQuestionLines(context));
	});

	api.on("message_end", (event, context) => {
		const message = (event as { message?: unknown }).message;
		if (isRecord(message) && message.role === "custom" && message.customType === "irc:incoming") {
			echoPeerMessages(api, context, peerMessagesFromEntries([{ ...message, type: "custom_message" }], peerId));
			return;
		}
		if (!isRecord(message) || message.role !== "toolResult" || message.toolName !== "hub") return;
		if (message.isError === true) return;
		const content = Array.isArray(message.content) ? message.content : [];
		const messages: PeerMessage[] = peerMessagesFromHubDetails(message.details, peerId);
		for (const block of content) {
			if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
				messages.push(...peerMessagesFromHubText(block.text, peerId));
			}
		}
		echoPeerMessages(api, context, messages);
	});

	api.on("tool_call", (event, context) => {
		const state = roomStateOf(context);
		if (!state) return undefined;
		if (state.closing) {
			if (event.toolName === "hub" && event.input.op === "cancel" &&
				Array.isArray(event.input.ids) && event.input.ids.length === 1 && event.input.ids[0] === peerId) return;
			return { block: true, reason: 'Duo is closing; first call hub {"op":"cancel","ids":["DuoPeer"]}.' };
		}

		if (event.toolName === "hub" && event.input.op === "send" && typeof event.input.message === "string") {
			const to = event.input.to;
			if (to === peerId || to === peerAgent || to === "all") {
				const body = event.input.message;
				noteProtocolEvent(api, context, "visible", body);
				const task = taskLine(body);
				if (task) progressOf(context).visibleTask = task;
				renderRoomBoard(context, state);
				roomMessage(api, "[Duo · " + modelLabel(state.visible) + "] " + body, {
					kind: "message",
					from: modelSelector(state.visible),
					to,
				});
				if (to !== "all") {
					const todos = formatTodos(latestTodos(context.sessionManager.getBranch?.() ?? []));
					return { input: { ...event.input, message: body + "\n\nCurrent canonical OMP todo snapshot:\n" + todos } };
				}
			}
			return undefined;
		}

		if ((event.toolName === "write" || event.toolName === "edit") && typeof event.input.path === "string"
			&& event.input.path.endsWith(notesPath)) {
			roomMessage(
				api,
				"[Duo] " + modelLabel(state.visible) + " updated the shared notes (DECISIONS/QUESTIONS/CLAIMS/OPEN).",
				{ kind: "notes", path: event.input.path },
			);
			return undefined;
		}

		if (event.toolName !== "task") return undefined;
		if (peerSpawnIntent(event.input) === "other") return undefined;
		if (spawnedSessions.has(context.sessionManager)) {
			return {
				block: true,
				reason: "The second Duo member already has a hidden harness. Use Agent Hub to wake and talk to it.",
			};
		}
		const pending = pendingTaskCalls.get(context.sessionManager);
		if (pending && pending.size > 0) {
			return { block: true, reason: "Duo is already opening the hidden harness." };
		}

		const prepared = preparePeerTask(event.input);
		if (prepared.reason) return { block: true, reason: prepared.reason };
		if (prepared.input) {
			const todos = formatTodos(latestTodos(context.sessionManager.getBranch?.() ?? []));
			prepared.input.context = (typeof prepared.input.context === "string" ? prepared.input.context + "\n\n" : "") +
				"Current canonical OMP todo snapshot:\n" + todos;
		}
		pendingTaskCalls.set(context.sessionManager, new Set([event.toolCallId]));
		state.peerMayExist = true;
		persistRoomState(api, state);
		progressOf(context).peerTask = "negotiating the split";
		renderRoomBoard(context, state);
		roomMessage(
			api,
			"[Duo] " + modelLabel(state.visible) + " and " + modelLabel(state.peer) + " are discussing who should take what.",
			{ kind: "negotiating", visible: modelSelector(state.visible), peer: modelSelector(state.peer) },
		);
		return { input: prepared.input };
	});

	api.on("tool_result", async (event, context) => {
		const closing = roomStateOf(context);
		if (closing?.closing && event.toolName === "hub" && isRecord(event.details) && event.details.op === "cancel") {
			const outcomes = event.details.cancelled;
			const outcome = Array.isArray(outcomes) ? outcomes.find(value => isRecord(value) && value.id === peerId) : undefined;
			// already_completed means the peer yielded on its own — nothing to stop.
			const closable =
				isRecord(outcome) &&
				(outcome.status === "cancelled" || outcome.status === "not_found" || outcome.status === "already_completed");
			if (!event.isError && closable) {
				persistRoomState(api, closing, { closed: true });
				await teardownRoom(api, context, closing);
				roomMessage(api, "[Duo] Peer cancellation confirmed; the room is closed.", { kind: "closed" });
			} else {
				context.ui.notify("Duo could not confirm peer cancellation; the room remains closing.", "warning");
			}
			return;
		}
		if (event.toolName !== "task") return;
		const pending = pendingTaskCalls.get(context.sessionManager);
		if (!pending?.delete(event.toolCallId)) return;
		if (pending.size === 0) pendingTaskCalls.delete(context.sessionManager);
		const state = roomStateOf(context);
		if (!state) return;
		if (state.closing) return;
		if (event.isError) {
			// No agent came to exist, so disable and re-open need no cancellation.
			state.peerMayExist = false;
			persistRoomState(api, state);
		} else {
			spawnedSessions.add(context.sessionManager);
		}
		progressOf(context).peerTask = event.isError ? "failed to open its harness" : "present in the hidden harness";
		renderRoomBoard(context, state);
		roomMessage(
			api,
			event.isError
				? "[Duo] " + modelLabel(state.peer) + " could not open its hidden harness."
				: "[Duo] " + modelLabel(state.peer) + " is now present in the hidden harness.",
			{ kind: event.isError ? "failed" : "present", peer: modelSelector(state.peer) },
		);
	});

	registerDuoCommand(api);
}
