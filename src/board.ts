import type { RoomProgress, RoomState } from "./types";
import { modelLabel } from "./models";

const VERBS = ["PROPOSE", "AGREE", "STATUS", "BLOCKED", "DONE", "ASK", "ANSWER"] as const;
export type ProtocolVerb = (typeof VERBS)[number];

export interface ParsedProtocol {
	verb: ProtocolVerb;
	summary: string;
	/** Question id for ASK/ANSWER, e.g. `q1`; absent for other verbs. */
	refId?: string;
}

/** Strip the peer's mandated `[Duo · <model>]` prefix line, if present. */
export function cleanPeerBody(body: string): string {
	const cleaned = body.replace(/^\s*\[Duo\b[^\]]*\]\s*/i, "").trim();
	return cleaned.length > 0 ? cleaned : body.trim();
}

const VERB_PREFIX = new RegExp("^(" + VERBS.join("|") + ")(?:[\\s:—·*_-]|$)", "i");

/**
 * Parse a room protocol message into the verb plus a one-line task summary, so
 * the board can show "who is doing what" without the full message body.
 * Models vary the separator (space, colon, em dash, middle dot) and may wrap
 * the verb in markdown emphasis.
 */
export function parseProtocolMessage(text: string): ParsedProtocol | undefined {
	const cleaned = cleanPeerBody(text.replace(/\s+/g, " ").trim()).replace(/^[\s*_`>~]+/, "");
	const upper = cleaned.toUpperCase();
	for (const verb of VERBS) {
		if (!upper.startsWith(verb)) continue;
		if (!VERB_PREFIX.test(cleaned)) continue;
		let rest = cleaned.slice(verb.length).replace(/^[\s:—·*-]+/, "").trim();
		let refId: string | undefined;
		if (verb === "ASK" || verb === "ANSWER") {
			// Ids are short tokens with a digit (q1, q12, 3); "ASK who owns x" has no id.
			const match = /^([a-z]{0,3}-?\d{1,4})(?=\s)/i.exec(rest);
			if (match) {
				refId = match[1];
				rest = rest.slice(refId.length).replace(/^[\s:—·-]+/, "").trim();
			}
		}
		return { verb, summary: truncate(rest || verb.toLowerCase(), 72), refId };
	}
	return undefined;
}

/** Task line for the board: the verb-flavored summary when parseable, else the opening words. */
export function taskLine(text: string): string | undefined {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length === 0) return undefined;
	const parsed = parseProtocolMessage(flat);
	if (!parsed) return "update: " + truncate(flat, 64);
	const ref = parsed.refId ? " " + parsed.refId : "";
	return parsed.verb.toLowerCase() + ref + ": " + parsed.summary;
}

export function renderBoard(state: RoomState, progress: RoomProgress, pendingQuestions?: string[]): string[] {
	const visible = modelLabel(state.visible);
	const peer = modelLabel(state.peer);
	const sameConnection =
		state.visible.provider === state.peer.provider && state.visible.id === state.peer.id;
	const header = "duo room · " + visible + " + " + peer + (sameConnection ? " (second connection)" : "");
	const lines = [
		header,
		"you   ▸ " + (progress.visibleTask ?? "waiting for the goal"),
		"peer  ▸ " + (progress.peerTask ?? "joining the room"),
	];
	if (pendingQuestions && pendingQuestions.length > 0) {
		lines.push("?     ▸ unanswered: " + pendingQuestions.join(", "));
	}
	return lines;
}

function truncate(text: string, max: number): string {
	return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
