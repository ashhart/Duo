import { peerAgent, peerId } from "./identity";
import { isRecord } from "./util";

export type PeerSpawnIntent = "peer" | "other" | "mixed";

function targetsPeerItem(value: unknown): boolean {
	return isRecord(value) && (value.agent === peerAgent || value.name === peerId);
}

function explicitlyOtherAgent(value: unknown): boolean {
	return isRecord(value) && typeof value.agent === "string" && value.agent !== peerAgent;
}

/**
 * Models sometimes admit the peer without agent/name fields. Then the framing
 * fields (`context`, `i`) still say so; task bodies are not scanned, so ordinary
 * work that merely mentions the peer stays untouched.
 */
function admitsPeerByFraming(input: Record<string, unknown>): boolean {
	const framing = [input.context, input.i].filter((value): value is string => typeof value === "string");
	if (framing.length === 0) return false;
	const joined = framing.join(" ").toLowerCase();
	return joined.includes(peerAgent) || joined.includes(peerId.toLowerCase());
}

/**
 * Classifies a task-tool call: "peer" admits the hidden member, "mixed" tries to
 * smuggle it into a batch, and "other" is ordinary subagent work the room must
 * leave alone.
 */
export function peerSpawnIntent(input: unknown): PeerSpawnIntent {
	if (isRecord(input) && Array.isArray(input.tasks)) {
		const hits = input.tasks.filter(targetsPeerItem).length;
		if (hits > 0) return input.tasks.length === 1 ? "peer" : "mixed";
		if (explicitlyOtherAgent(input) || input.tasks.some(explicitlyOtherAgent)) return "other";
		return admitsPeerByFraming(input) ? "peer" : "other";
	}
	if (!isRecord(input)) return "other";
	if (targetsPeerItem(input)) return "peer";
	if (explicitlyOtherAgent(input)) return "other";
	return admitsPeerByFraming(input) ? "peer" : "other";
}

/** Normalize a peer-targeting spawn: stable name, the duo-peer agent, never isolated. */
export function preparePeerTask(input: Record<string, unknown>): { input?: Record<string, unknown>; reason?: string } {
	const prepareItem = (value: unknown): Record<string, unknown> | undefined => {
		if (!isRecord(value)) return undefined;
		const { isolated: _isolated, ...rest } = value;
		return { ...rest, agent: peerAgent, name: peerId };
	};

	if (Array.isArray(input.tasks)) {
		if (input.tasks.length !== 1) {
			return { reason: "Duo permits exactly one hidden room member." };
		}
		const item = prepareItem(input.tasks[0]);
		if (!item) return { reason: "Duo received an invalid peer task." };
		const { isolated: _isolated, ...rest } = input;
		return { input: { ...rest, tasks: [item] } };
	}

	const next = prepareItem(input);
	return next ? { input: next } : { reason: "Duo received an invalid peer task." };
}
