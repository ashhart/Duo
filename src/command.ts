import { controlMessageType, peerAgent, peerId } from "./identity";
import { modelLabel, modelSelector, peerChoiceDescription, peerChoices } from "./models";
import {
	pendingTaskCalls,
	persistRoomState,
	progressOf,
	renderRoomBoard,
	renderStatus,
	roomMessage,
	roomStateOf,
	roomStates,
	spawnedSessions,
	teardownRoom,
} from "./room";
import { installPeerModelOverride } from "./settings";
import type { CommandContext, ModelRef, OmpExtensionApi, RoomState } from "./types";
import { describeError } from "./util";

async function choosePeer(spec: string, context: CommandContext, visible: ModelRef): Promise<ModelRef | undefined> {
	const direct = spec.trim();
	if (direct && direct !== "enable" && direct !== "on") {
		const resolved = context.models.resolve(direct);
		if (!resolved) context.ui.notify("Duo could not resolve model " + direct + ".", "error");
		return resolved;
	}

	const choices = peerChoices(context.models.list());
	if (choices.length === 0) {
		context.ui.notify("Duo found no authenticated models in the OMP catalog.", "warning");
		return undefined;
	}
	const selected = await context.ui.select(
		"Choose the second Duo model",
		choices.map(model => ({
			label: modelSelector(model),
			description: peerChoiceDescription(model, visible),
		})),
	);
	return choices.find(model => modelSelector(model) === selected);
}

export function registerDuoCommand(api: OmpExtensionApi): void {
	api.registerCommand("duo", {
		description: "Open a two-model room and choose its second model from OMP",
		getArgumentCompletions: prefix => {
			const actions = ["status", "disable", "enable"];
			const query = prefix.trim().toLowerCase();
			const matches = actions.filter(action => action.startsWith(query));
			return matches.length > 0 ? matches.map(action => ({ value: action, label: action })) : null;
		},
		handler: async (args, context) => {
			const action = args.trim();
			const lower = action.toLowerCase();
			if (lower === "disable" || lower === "off" || lower === "leave") {
				await closeRoom(api, context);
				return;
			}

			if (lower === "status") {
				const state = roomStateOf(context);
				if (!state) {
					context.ui.notify("Duo is disabled.", "warning");
					return;
				}
				renderRoomBoard(context, state);
				const presence = state.closing ? "cancellation pending" : spawnedSessions.has(context.sessionManager)
					? "present" : state.peerMayExist ? "presence unverified" : "not yet admitted";
				context.ui.notify(
					"Duo room: visible " +
						modelSelector(state.visible) +
						", hidden " +
						modelSelector(state.peer) +
						" (" +
						presence +
						").",
					"info",
				);
				return;
			}

			if (roomStateOf(context)?.closing || roomStateOf(context)?.peerMayExist || spawnedSessions.has(context.sessionManager) || pendingTaskCalls.get(context.sessionManager)?.size) {
				const live = roomStateOf(context);
				context.ui.notify(
					"A Duo peer is already in the room" +
						(live ? " (" + modelLabel(live.peer) + ")" : "") +
						". Run /duo disable before opening another room.",
					"error",
				);
				return;
			}

			const visible = context.models.current() ?? context.model;
			if (!visible) {
				context.ui.notify("Choose the visible OMP model before opening Duo.", "error");
				return;
			}
			const peer = await choosePeer(action, context, visible);
			if (!peer) return;

			const existing = roomStateOf(context);
			let previousPeerOverride: string | undefined;
			try {
				previousPeerOverride = await installPeerModelOverride(modelSelector(peer), existing);
			} catch (error) {
				context.ui.notify("Duo could not set the peer model override: " + describeError(error), "error");
				return;
			}

			const previousThinking = existing ? existing.previousThinking : api.getThinkingLevel?.();
			const state: RoomState = { visible, peer, previousPeerOverride, previousThinking, peerMayExist: false };
			roomStates.set(context.sessionManager, state);
			persistRoomState(api, state);
			progressOf(context).visibleTask = "waiting for the goal";
			progressOf(context).peerTask = "joining the room";
			pendingTaskCalls.delete(context.sessionManager);
			spawnedSessions.delete(context.sessionManager);
			api.setThinkingLevel("high");
			renderStatus(context, state);
			renderRoomBoard(context, state);
			roomMessage(
				api,
				"[Duo] Room opened. " +
					modelLabel(visible) +
					" is visible and " +
					modelLabel(peer) +
					" is joining in a hidden OMP harness" +
					(modelSelector(peer) === modelSelector(visible) ? " as a second concurrent connection" : "") +
					".",
				{ kind: "opened", visible: modelSelector(visible), peer: modelSelector(peer) },
			);
			api.sendMessage(
				{
					customType: controlMessageType,
					content:
						"Do not narrate the setup. Immediately view the current todo list and spawn the " +
						peerAgent +
						" task agent once with stable name " +
						peerId +
						" and no isolated field. Ask it only to join the room, inspect the goal and todo snapshot, introduce its strengths through one PROPOSE Hub message, and wait for one AGREE that closes negotiation; acknowledgments to AGREE are forbidden. Do not assign it work yet. After dispatch, show only a concise [Duo] room-status update.",
					display: false,
					details: { kind: "admit-peer", peer: modelSelector(peer) },
					attribution: "agent",
				},
				// In print/RPC mode the next queued prompt starts the turn that
				// consumes this message; triggering one now collides with it
				// (AgentBusyError) because headless prompts cannot steer.
				{ deliverAs: "nextTurn", triggerTurn: context.hasUI !== false },
			);
			context.ui.notify(modelLabel(peer) + " is entering the Duo room.", "info");
		},
	});
}

async function closeRoom(api: OmpExtensionApi, context: CommandContext): Promise<void> {
	const state = roomStateOf(context);
	const hadLivePeer = state?.closing || state?.peerMayExist || spawnedSessions.has(context.sessionManager) || Boolean(pendingTaskCalls.get(context.sessionManager)?.size);
	if (state && hadLivePeer) {
		state.closing = true;
		persistRoomState(api, state);
		progressOf(context).peerTask = "cancellation pending";
		renderRoomBoard(context, state);
		roomMessage(api, "[Duo] Closing the room; waiting for peer cancellation.", { kind: "closing" });
		api.sendMessage(
			{
				customType: controlMessageType,
				content:
					'The Duo room is closing. Cancel its agent using hub {"op":"cancel","ids":["DuoPeer"]}. This is an agent, not a managed process. Check the cancellation result before reporting it stopped. If cancellation fails, report the failure and do not start new work or wake the peer.',
				display: false,
				details: { kind: "stop-peer", peer: modelSelector(state.peer) },
				attribution: "agent",
			},
			{ deliverAs: "nextTurn", triggerTurn: context.hasUI !== false },
		);
		context.ui.notify(context.hasUI === false ? "Duo cancellation is queued for the next model turn." : "Duo is waiting for peer cancellation.", "info");
		return;
	}
	if (state) persistRoomState(api, state, { closed: true });
	await teardownRoom(api, context, state);
	if (state) roomMessage(api, "[Duo] The room closed.", { kind: "closed" });
	context.ui.notify("Duo disabled for this session.", "info");
}
