import { isRecord } from "./util";

export interface PeerMessage {
	id: string;
	body: string;
}

/**
 * Collect every peer hub message the session has already received, so the room
 * can surface it. Extensions cannot subscribe to irc events directly, so the
 * branch is scanned at each turn boundary — the same walk done for todos. Two
 * entry shapes carry peer traffic:
 *
 * - `custom_message` entries (`irc:incoming`) for messages delivered while no
 *   hub call was waiting; `details` holds `{id, from, message}`.
 * - `hub` tool results whose text contains `[<id>] DuoPeer: <body>` lines for
 *   messages consumed by `wait`/`inbox`/`send await:true`.
 *
 * Both share the irc message id, so one id-space dedupes across the two paths.
 */
export function peerMessagesFromEntries(entries: unknown[], peerId: string): PeerMessage[] {
	const messages: PeerMessage[] = [];
	const collected = new Set<string>();
	const push = (id: string, body: string): void => {
		if (collected.has(id)) return;
		collected.add(id);
		messages.push({ id, body });
	};
	for (const entry of entries) {
		if (!isRecord(entry)) continue;

		if ((entry.type === "custom_message" || entry.type === "custom") && entry.customType === "irc:incoming") {
			const data = isRecord(entry.details) ? entry.details : isRecord(entry.data) ? entry.data : undefined;
			const id = typeof data?.id === "string" ? data.id : undefined;
			const from = typeof data?.from === "string" ? data.from : "";
			const body = typeof data?.message === "string" ? data.message : "";
			if (id && from === peerId && body.length > 0) push(id, body);
			continue;
		}

		if (entry.type !== "message" || !isRecord(entry.message)) continue;
		const message = entry.message;
		if (message.role !== "toolResult" || message.toolName !== "hub" || message.isError === true) continue;
		for (const reply of peerMessagesFromHubDetails(message.details, peerId)) push(reply.id, reply.body);
		const content = Array.isArray(message.content) ? message.content : [];
		for (const block of content) {
			if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") continue;
			// A delivered body may span lines; each `[<id>] DuoPeer:` start runs
			// until the next delivery marker, not just to end of line.
			for (const delivered of peerMessagesFromHubText(block.text, peerId)) {
				push(delivered.id, delivered.body);
			}
		}
	}
	return messages;
}

/** Native send-await replies have a stable id in details, even when the rendered text does not. */
export function peerMessagesFromHubDetails(details: unknown, peerId: string): PeerMessage[] {
	if (!isRecord(details) || !isRecord(details.waited)) return [];
	const reply = details.waited;
	if (reply.from !== peerId || typeof reply.id !== "string" || reply.id.length === 0 ||
		typeof reply.body !== "string" || reply.body.length === 0) return [];
	return [{ id: reply.id, body: reply.body }];
}

/**
 * Peer messages inside one hub tool-result text. The host renders deliveries as
 * `[<id>] DuoPeer: <body>`, and replies as `[<id>] DuoPeer (reply to <id>): <body>`.
 * `inbox` results list each delivery as a `- ` bullet; `wait` results do not.
 */
export function peerMessagesFromHubText(text: string, peerId: string): PeerMessage[] {
	// Every sender terminates the previous body; filter only after framing.
	const marker = /^(?:- )?\[([a-z0-9_-]+)\] ([^\s:]+)(?: \(reply to [a-z0-9_-]+\))?: ?/gim;
	const matches = [...text.matchAll(marker)];
	const messages: PeerMessage[] = [];
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		if (match[2] !== peerId) continue;
		const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
		const body = text.slice(match.index + match[0].length, end).trim();
		if (body.length > 0) messages.push({ id: match[1], body });
	}
	return messages;
}

/** Messages not yet surfaced, tracked by id. */
export function unseenPeerMessages(messages: PeerMessage[], seen: Set<string>): PeerMessage[] {
	return messages.filter(message => !seen.has(message.id));
}
