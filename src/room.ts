import { boardKey, roomMessageType, roomStateEntryType, statusKey } from "./identity";
import { modelLabel, modelSelector } from "./models";
import { renderBoard } from "./board";
import { restorePeerModelOverride } from "./settings";
import type { CommandContext, ModelRef, OmpExtensionApi, RoomProgress, RoomState } from "./types";
import { describeError, isRecord } from "./util";

export const roomStates = new WeakMap<object, RoomState>();
export const roomProgress = new WeakMap<object, RoomProgress>();
export const pendingTaskCalls = new WeakMap<object, Set<string>>();
export const spawnedSessions = new WeakSet<object>();
const seenPeerMessages = new WeakMap<object, Set<string>>();
/** Sessions whose AGREE exchange already produced the mechanical agreement note. */
export const notedAgreements = new WeakSet<object>();

interface PendingQuestion {
	side: "visible" | "peer";
	summary: string;
}
const pendingQuestions = new WeakMap<object, Map<string, PendingQuestion>>();

/** Room protocol questions asked but not yet answered: id → who asked and what. */
export function questionTracker(context: CommandContext): Map<string, PendingQuestion> {
	let tracker = pendingQuestions.get(context.sessionManager);
	if (!tracker) {
		tracker = new Map<string, PendingQuestion>();
		pendingQuestions.set(context.sessionManager, tracker);
	}
	return tracker;
}

/** One-line pending questions for the board and the turn-start reminder. */
export function pendingQuestionLines(context: CommandContext): string[] {
	const lines: string[] = [];
	for (const [id, question] of questionTracker(context)) {
		lines.push(id + " (from " + (question.side === "visible" ? "you" : "peer") + "): " + question.summary);
	}
	return lines;
}

export function roomStateOf(context: CommandContext): RoomState | undefined {
	return roomStates.get(context.sessionManager);
}

export function progressOf(context: CommandContext): RoomProgress {
	let progress = roomProgress.get(context.sessionManager);
	if (!progress) {
		progress = {};
		roomProgress.set(context.sessionManager, progress);
	}
	return progress;
}

/** Peer irc message ids already surfaced, created lazily per session. */
export function seenPeerMessageIds(context: CommandContext): Set<string> {
	let seen = seenPeerMessages.get(context.sessionManager);
	if (!seen) {
		seen = new Set<string>();
		seenPeerMessages.set(context.sessionManager, seen);
	}
	return seen;
}

export function roomMessage(
	api: OmpExtensionApi,
	content: string,
	details: Record<string, unknown>,
	options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
): void {
	api.sendMessage(
		{
			customType: roomMessageType,
			content,
			display: true,
			details,
			attribution: "agent",
		},
		options,
	);
}

export function renderStatus(context: CommandContext, state: RoomState | undefined): void {
	if (!state) {
		context.ui.setStatus(statusKey, undefined);
		return;
	}
	context.ui.setStatus(statusKey, "duo: " + modelLabel(state.visible) + " + " + modelLabel(state.peer));
}

export function renderRoomBoard(context: CommandContext, state: RoomState | undefined): void {
	if (!state) {
		context.ui.setWidget?.(boardKey, undefined);
		return;
	}
	const ids = [...questionTracker(context).keys()];
	context.ui.setWidget?.(boardKey, renderBoard(state, progressOf(context), ids.length > 0 ? ids : undefined));
}

/** Persist the room into the session file so a restart can rebuild it. */
export function persistRoomState(
	api: OmpExtensionApi,
	state: RoomState,
	options?: { closed?: boolean },
): void {
	api.appendEntry(roomStateEntryType, {
		visible: state.visible,
		peer: state.peer,
		previousPeerOverride: state.previousPeerOverride,
		previousThinking: state.previousThinking,
		closing: state.closing,
		peerMayExist: state.peerMayExist,
		closed: options?.closed === true,
	});
}

/** Latest persisted room for this branch, or undefined when none or closed. */
export function persistedRoomFromBranch(entries: unknown[]): RoomState | undefined {
	let persisted: RoomState | undefined;
	for (const entry of entries) {
		if (!isRecord(entry)) continue;
		if ((entry.type !== "custom" && entry.type !== "custom_message") || entry.customType !== roomStateEntryType) {
			continue;
		}
		const data = isRecord(entry.data) ? entry.data : isRecord(entry.details) ? entry.details : undefined;
		if (!data) continue;
		if (data.closed === true) {
			persisted = undefined;
			continue;
		}
		const visible = asModelRef(data.visible);
		const peer = asModelRef(data.peer);
		if (!visible || !peer) continue;
		persisted = {
			visible,
			peer,
			previousPeerOverride: typeof data.previousPeerOverride === "string" ? data.previousPeerOverride : undefined,
			previousThinking: typeof data.previousThinking === "string" ? data.previousThinking : undefined,
			closing: data.closing === true,
			// Older rooms did not record admission, so check cancellation on close.
			peerMayExist: data.peerMayExist !== false,
		};
	}
	return persisted;
}

function asModelRef(value: unknown): ModelRef | undefined {
	if (!isRecord(value) || typeof value.provider !== "string" || typeof value.id !== "string") return undefined;
	return {
		provider: value.provider,
		id: value.id,
		name: typeof value.name === "string" ? value.name : undefined,
		contextWindow: typeof value.contextWindow === "number" ? value.contextWindow : undefined,
	};
}

export async function teardownRoom(
	api: OmpExtensionApi,
	context: CommandContext,
	state: RoomState | undefined,
): Promise<void> {
	// Lifecycle events also fire for sessions that never had a room; touching
	// their UI or the global override would clobber another session's live room.
	if (!state) return;
	await restorePeerModelOverride(state.previousPeerOverride).catch(error => {
		context.ui.notify("Duo could not restore the model override: " + describeError(error), "warning");
	});
	if (state.previousThinking !== undefined) api.setThinkingLevel(state.previousThinking);
	roomStates.delete(context.sessionManager);
	roomProgress.delete(context.sessionManager);
	seenPeerMessages.delete(context.sessionManager);
	notedAgreements.delete(context.sessionManager);
	pendingQuestions.delete(context.sessionManager);
	pendingTaskCalls.delete(context.sessionManager);
	spawnedSessions.delete(context.sessionManager);
	renderStatus(context, undefined);
	renderRoomBoard(context, undefined);
}
