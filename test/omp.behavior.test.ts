import { beforeEach, describe, expect, test } from "bun:test";
import localDuo from "../src/omp";
import { setSettingsLoaderForTests } from "../src/settings";

const visible = {
	provider: "example-b",
	id: "model-b",
	name: "Model B",
	contextWindow: 262144,
};
const peer = {
	provider: "example-a",
	id: "model-a",
	name: "Model A",
	contextWindow: 850000,
};
const other = {
	provider: "example-a",
	id: "model-c",
	name: "Model C",
	contextWindow: 131072,
};

type SentMessage = {
	message: {
		customType: string;
		content: string;
		display: boolean;
		details?: Record<string, unknown>;
		attribution?: string;
	};
	options?: { triggerTurn?: boolean; deliverAs?: string };
};

function fakeSettings(initial: Record<string, unknown> = {}) {
	const store = new Map<string, unknown>(Object.entries(initial));
	return {
		store,
		get: (path: string) => store.get(path),
		override: (path: string, value: unknown) => {
			store.set(path, value);
		},
	};
}

type Settings = ReturnType<typeof fakeSettings>;

function createHarness(sessionModels = [visible, peer, other]) {
	const handlers = new Map<string, Array<(event: never, context: never) => unknown>>();
	const commands: Record<string, { handler: (args: string, context: unknown) => Promise<void> }> = {};
	const sent: SentMessage[] = [];
	const notifications: Array<{ message: string; level?: string }> = [];
	const status = new Map<string, string | undefined>();
	const widgets = new Map<string, string[] | undefined>();
	const sessionManager = {
		branch: [] as unknown[],
		getBranch: () => sessionManager.branch,
	};
	const state = {
		thinkingLevel: "medium" as string | undefined,
		currentModel: visible,
		allowModelSwitch: true,
		modelSwitches: [] as string[],
		selectAnswer: undefined as string | undefined,
	};

	const api = {
		setModel: async (model: typeof visible) => {
			state.modelSwitches.push(model.provider + "/" + model.id);
			if (!state.allowModelSwitch) return false;
			state.currentModel = model;
			return true;
		},
		on: (event: string, handler: (event: never, context: never) => unknown) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand: (name: string, definition: { handler: (args: string, context: unknown) => Promise<void> }) => {
			commands[name] = definition;
		},
		getThinkingLevel: () => state.thinkingLevel,
		setThinkingLevel: (level: string) => {
			state.thinkingLevel = level;
		},
		sendMessage: (message: SentMessage["message"], options?: SentMessage["options"]) => {
			sent.push({ message, options });
		},
		appendEntry: (customType: string, data?: unknown) => {
			sessionManager.branch.push({ type: "custom", customType, data });
		},
	};

	const makeContext = () => ({
		sessionManager,
		models: {
			list: () => sessionModels,
			current: () => state.currentModel,
			resolve: (selector: string) =>
				sessionModels.find(model => model.provider + "/" + model.id === selector),
		},
		ui: {
			select: async (_title: string, options: Array<{ label: string }>) => {
				if (!state.selectAnswer) return undefined;
				return options.some(option => option.label === state.selectAnswer) ? state.selectAnswer : undefined;
			},
			notify: (message: string, level?: string) => {
				notifications.push({ message, level });
			},
			setStatus: (key: string, value: string | undefined) => {
				if (value === undefined) status.delete(key);
				else status.set(key, value);
			},
			setWidget: (key: string, content: string[] | undefined) => {
				if (content === undefined) widgets.delete(key);
				else widgets.set(key, content);
			},
		},
	});

	localDuo(api as never);
	const context = makeContext();

	const emitToolCall = (toolName: string, input: Record<string, unknown>, toolCallId = "call-1") => {
		let result: { block?: boolean; reason?: string; input?: Record<string, unknown> } | undefined;
		for (const handler of handlers.get("tool_call") ?? []) {
			const next = (handler as unknown as (event: unknown, ctx: unknown) => typeof result)(
				{ toolName, toolCallId, input },
				context,
			);
			if (next !== undefined && next !== null) result = next;
		}
		return result;
	};

	const emitToolResult = async (toolName: string, toolCallId: string, isError: boolean, details?: unknown) => {
		for (const handler of handlers.get("tool_result") ?? []) {
			await (handler as unknown as (event: unknown, ctx: unknown) => unknown)(
				{ toolName, toolCallId, isError, details },
				context,
			);
		}
	};

	const emitBeforeAgentStart = async (systemPrompt: string[] = []) => {
		let result: { systemPrompt: string[] } | undefined;
		for (const handler of handlers.get("before_agent_start") ?? []) {
			const next = await (handler as unknown as (event: unknown, ctx: unknown) => typeof result)(
				{ systemPrompt },
				context,
			);
			if (next !== undefined && next !== null) result = next;
		}
		return result;
	};

	const emitMessageEnd = (message: Record<string, unknown>) => {
		for (const handler of handlers.get("message_end") ?? []) {
			(handler as unknown as (event: unknown, ctx: unknown) => void)({ message }, context);
		}
	};

	const fireSessionEvent = async (event: string, target: unknown = context) => {
		for (const handler of handlers.get(event) ?? []) {
			await (handler as unknown as (event: unknown, ctx: unknown) => Promise<void> | void)({}, target);
		}
	};

	const runCommand = (args: string) => commands.duo.handler(args, context);

	const openRoom = async (selector = "example-a/model-a") => {
		await runCommand(selector);
	};

	const admitPeer = () => {
		const accepted = emitToolCall("task", { agent: "duo-peer", task: "Join the room" }, "spawn-1");
		emitToolResult("task", "spawn-1", false);
		return accepted;
	};

	const roomMessages = (kind: string) =>
		sent.filter(entry => entry.message.customType === "local-duo-room" && entry.message.details?.kind === kind);
	const controlMessages = (kind: string) =>
		sent.filter(entry => entry.message.customType === "local-duo-control" && entry.message.details?.kind === kind);

	return {
		api,
		context,
		state,
		sent,
		notifications,
		status,
		widgets,
		sessionManager,
		emitToolCall,
		emitToolResult,
		emitBeforeAgentStart,
		emitMessageEnd,
		fireSessionEvent,
		runCommand,
		openRoom,
		admitPeer,
		roomMessages,
		controlMessages,
	};
}

describe("local duo behavior", () => {
	let settings: Settings;

	beforeEach(() => {
		settings = fakeSettings();
		setSettingsLoaderForTests(async () => settings);
	});

	test("selects both models and retains the first after closing", async () => {
		const h = createHarness();
		await h.runCommand("example-a/model-c example-a/model-a");
		expect(h.state.currentModel).toEqual(other);
		expect(h.roomMessages("opened")[0].message.details).toMatchObject({ visible: "example-a/model-c", peer: "example-a/model-a" });
		await h.runCommand("stop");
		expect(h.roomMessages("closed")).toHaveLength(1);
		expect(h.state.currentModel).toEqual(other);
	});

	test("validates both model IDs before switching or opening", async () => {
		const h = createHarness();
		await h.runCommand("example-a/model-c missing/model");
		await h.runCommand("missing/model example-a/model-a");
		await h.runCommand("example-a/model-c example-a/model-a extra");
		expect(h.state.modelSwitches).toEqual([]);
		expect(h.roomMessages("opened")).toHaveLength(0);
		expect(h.notifications.every(n => n.level === "error")).toBe(true);
	});

	test("does not open or override the peer when model selection is refused", async () => {
		const h = createHarness();
		h.state.allowModelSwitch = false;
		await h.runCommand("example-a/model-c example-a/model-a");
		expect(h.state.currentModel).toEqual(visible);
		expect(h.roomMessages("opened")).toHaveLength(0);
		expect(settings.store.get("task.agentModelOverrides")).toBeUndefined();
	});

	test("restores the visible model when peer configuration fails", async () => {
		const h = createHarness();
		setSettingsLoaderForTests(async () => { throw new Error("settings unavailable"); });
		await h.runCommand("example-a/model-c example-a/model-a");
		expect(h.state.currentModel).toEqual(visible);
		expect(h.roomMessages("opened")).toHaveLength(0);
	});

	test("help and model discovery work without opening or changing a room", async () => {
		const h = createHarness();
		await h.runCommand("help");
		await h.runCommand("models");
		expect(h.notifications[0].message).toContain("/duo provider/model-a provider/model-b");
		expect(h.notifications[1].message).toContain("example-a/model-c");
		expect(h.sent).toHaveLength(0);
		expect(h.state.modelSwitches).toEqual([]);
		const empty = createHarness([]);
		await empty.runCommand("models");
		expect(empty.notifications[0].level).toBe("warning");
	});

	test("cannot switch a live room's visible model through the pair command", async () => {
		const h = createHarness();
		await h.openRoom();
		h.admitPeer();
		await h.runCommand("example-a/model-c example-a/model-a");
		expect(h.state.modelSwitches).toEqual([]);
		expect(h.roomMessages("opened")).toHaveLength(1);
		await h.runCommand("stop");
		expect(h.controlMessages("stop-peer")).toHaveLength(1);
		expect(h.roomMessages("closed")).toHaveLength(0);
	});

	test("opens a second concurrent connection to the current model", async () => {
		const h = createHarness();
		await h.runCommand("example-b/model-b");
		expect(h.roomMessages("opened")).toHaveLength(1);
		expect(h.roomMessages("opened")[0].message.content).toContain("second concurrent connection");
		expect(h.status.get("local-duo")).toContain("duo:");
		expect(settings.store.get("task.agentModelOverrides")).toEqual({
			"duo-peer": "example-b/model-b",
		});
	});

	test("leaves subagent spawns that do not target the duo peer untouched", async () => {
		const h = createHarness();
		await h.openRoom();
		const result = h.emitToolCall("task", { agent: "research", task: "Explore the parser" });
		expect(result).toBeUndefined();
		expect(h.roomMessages("negotiating")).toHaveLength(0);
	});

	test("keeps normal subagents usable after the peer joined", async () => {
		const h = createHarness();
		await h.openRoom();
		h.admitPeer();
		const result = h.emitToolCall("task", { agent: "research", task: "Explore the parser" }, "call-2");
		expect(result).toBeUndefined();
	});

	test("still blocks a second duo-peer spawn after the peer joined", async () => {
		const h = createHarness();
		await h.openRoom();
		h.admitPeer();
		const result = h.emitToolCall("task", { agent: "duo-peer", task: "Join again" }, "call-2");
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("Agent Hub");
	});

	test("refuses to open a second room while the peer is live", async () => {
		const h = createHarness();
		await h.openRoom();
		h.admitPeer();
		await h.runCommand("example-a/model-c");
		const errors = h.notifications.filter(entry => entry.level === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("disable");
		expect(h.roomMessages("opened")).toHaveLength(1);
	});

	test("disable waits for confirmed native agent cancellation before closing the room", async () => {
		const h = createHarness();
		await h.openRoom();
		h.admitPeer();
		await h.runCommand("disable");
		const stop = h.controlMessages("stop-peer");
		expect(stop).toHaveLength(1);
		expect(stop[0].message.content).toContain("DuoPeer");
		expect(stop[0].message.content).toContain('"cancel"');
		expect(stop[0].message.content).not.toContain('op "stop"');
		expect(stop[0].options?.triggerTurn).toBe(true);
		expect(h.roomMessages("closed")).toHaveLength(0);
		expect(h.emitToolCall("task", { agent: "duo-peer", task: "Join again" })?.block).toBe(true);
		expect(h.emitToolCall("hub", { op: "cancel", ids: ["DuoPeer"] })).toBeUndefined();
		await h.emitToolResult("hub", "cancel-1", false, { op: "cancel", cancelled: [{ id: "DuoPeer", status: "cancelled" }] });
		expect(h.roomMessages("closed")).toHaveLength(1);
		expect(h.status.get("local-duo")).toBeUndefined();
	});

	test("disable without a live peer sends no stop instruction", async () => {
		const h = createHarness();
		await h.openRoom();
		await h.runCommand("disable");
		expect(h.controlMessages("stop-peer")).toHaveLength(0);
	});

	test("restores the thinking level it changed on open", async () => {
		const h = createHarness();
		expect(h.state.thinkingLevel).toBe("medium");
		await h.openRoom();
		expect(h.state.thinkingLevel).toBe("high");
		await h.runCommand("disable");
		expect(h.state.thinkingLevel).toBe("medium");
	});

	test("surfaces a failed override restore instead of swallowing it", async () => {
		const h = createHarness();
		await h.openRoom();
		h.admitPeer();
		settings.override = () => {
			throw new Error("settings exploded");
		};
		await h.runCommand("disable");
		await h.emitToolResult("hub", "cancel-1", false, { op: "cancel", cancelled: [{ id: "DuoPeer", status: "cancelled" }] });
		const warnings = h.notifications.filter(entry => entry.message.includes("restore"));
		expect(warnings.length).toBeGreaterThan(0);
	});

	test("echoes only hub traffic addressed to the room", async () => {
		const h = createHarness();
		await h.openRoom();
		h.emitToolCall("hub", { op: "send", to: "DuoPeer", message: "PROPOSE split" });
		h.emitToolCall("hub", { op: "send", to: "all", message: "STATUS update" });
		h.emitToolCall("hub", { op: "send", to: "ScoutAgent", message: "unrelated" });
		const echoes = h.roomMessages("message");
		expect(echoes).toHaveLength(2);
		expect(echoes.every(entry => entry.message.details?.to !== "ScoutAgent")).toBe(true);
	});

	test("tracks each member's task on the live board", async () => {
		const h = createHarness();
		await h.openRoom();
		h.emitToolCall("hub", { op: "send", to: "DuoPeer", message: "STATUS wiring src/cli.js stdin" });
		const board = h.widgets.get("local-duo-board");
		expect(board?.join("\n")).toContain("status: wiring src/cli.js stdin");
		expect(board?.join("\n")).toContain("Model A");
	});

	test("surfaces peer hub messages as chat lines and board updates at turn start", async () => {
		const h = createHarness();
		await h.openRoom();
		h.admitPeer();
		h.sessionManager.branch.push({
			type: "custom_message",
			customType: "irc:incoming",
			details: { id: "irc-1", from: "DuoPeer", message: "[Duo · example-a/model-a]\nSTATUS src/count.js edge cases" },
		});
		const result = await h.emitBeforeAgentStart(["base prompt"]);
		expect(result?.systemPrompt[0]).toBe("base prompt");
		expect(result?.systemPrompt[1]).toContain("Duo room is active");
		const peerEchoes = h.roomMessages("peer-message");
		expect(peerEchoes).toHaveLength(1);
		expect(peerEchoes[0].message.content).toContain("[Duo · Model A] STATUS src/count.js edge cases");
		expect(h.widgets.get("local-duo-board")?.join("\n")).toContain("status: src/count.js edge cases");

		await h.emitBeforeAgentStart(["base prompt"]);
		expect(h.roomMessages("peer-message")).toHaveLength(1);
	});

	test("echoes peer messages the moment a hub result consumes them", async () => {
		const h = createHarness();
		await h.openRoom();
		h.admitPeer();
		h.emitMessageEnd({
			role: "toolResult",
			toolName: "hub",
			isError: false,
			content: [
				{
					type: "text",
					text: "1 peer(s) running:\n[abc123] DuoPeer: PROPOSE I take src/count.js, you take the CLI and tests\n[def456] ScoutAgent: noise",
				},
			],
		});
		const echoes = h.roomMessages("peer-message");
		expect(echoes).toHaveLength(1);
		expect(echoes[0].message.content).toContain("PROPOSE I take src/count.js");
		expect(h.widgets.get("local-duo-board")?.join("\n")).toContain("propose: I take src/count.js");

		// The same id arriving again via the branch scan must not double-echo.
		h.sessionManager.branch.push({
			type: "custom_message",
			customType: "irc:incoming",
			details: { id: "abc123", from: "DuoPeer", message: "PROPOSE I take src/count.js, you take the CLI and tests" },
		});
		await h.emitBeforeAgentStart(["base"]);
		expect(h.roomMessages("peer-message")).toHaveLength(1);
	});

	test("normalizes framing-only admit attempts to the named peer agent", async () => {
		const h = createHarness();
		await h.openRoom();
		const result = h.emitToolCall(
			"task",
			{
				i: "DuoPeer joins room, proposes split, waits for AGREE",
				context: "# Goal\nBuild the CLI. DuoPeer joins and proposes.",
				tasks: [{ task: "Join the room" }],
			},
			"call-9",
		);
		expect(result?.reason).toBeUndefined();
		expect(result?.input?.tasks).toEqual([{ agent: "duo-peer", name: "DuoPeer", task: "Join the room" }]);
		expect(h.roomMessages("negotiating")).toHaveLength(1);
	});

	test("a foreign session reset leaves the room's override alone", async () => {
		const h = createHarness();
		await h.openRoom();
		// session_switch fires with the *other* session's context: no room state,
		// but the room's override is still installed in process-global settings.
		const foreign = { sessionManager: { branch: [], getBranch: () => [] } };
		await h.fireSessionEvent("session_switch", foreign);
		expect(settings.store.get("task.agentModelOverrides")).toEqual({
			"duo-peer": "example-a/model-a",
		});
	});

	test("re-installs a lost peer override at turn start", async () => {
		const h = createHarness();
		await h.openRoom();
		settings.store.delete("task.agentModelOverrides");
		await h.emitBeforeAgentStart(["base"]);
		expect(settings.store.get("task.agentModelOverrides")).toEqual({
			"duo-peer": "example-a/model-a",
		});
	});

	test("rebuilds the room from a persisted state entry on session start", async () => {
		const h = createHarness();
		// A resumed session's branch carries the room-state entry from the run
		// that opened it; the new process has no live state.
		h.sessionManager.branch.push({
			type: "custom",
			customType: "local-duo-room-state",
			data: {
				visible: { provider: "example-b", id: "model-b", name: "Model B" },
				peer: { provider: "example-a", id: "model-a", name: "Model A" },
			},
		});
		await h.fireSessionEvent("session_start");
		expect(settings.store.get("task.agentModelOverrides")).toEqual({
			"duo-peer": "example-a/model-a",
		});
		expect(h.status.get("local-duo")).toContain("duo:");
		expect(h.roomMessages("resumed")).toHaveLength(1);
		// The rebuilt room still guards spawns.
		const result = h.emitToolCall("task", { agent: "duo-peer", task: "Rejoin" }, "call-1");
		expect(result?.input).toMatchObject({ agent: "duo-peer", name: "DuoPeer", task: "Rejoin" });
	});

	test("does not rebuild a room that was closed before the restart", async () => {
		const h = createHarness();
		h.sessionManager.branch.push(
			{
				type: "custom",
				customType: "local-duo-room-state",
				data: {
					visible: { provider: "example-b", id: "model-b" },
					peer: { provider: "example-a", id: "model-a" },
				},
			},
			{ type: "custom", customType: "local-duo-room-state", data: { closed: true } },
		);
		await h.fireSessionEvent("session_start");
		expect(settings.store.get("task.agentModelOverrides")).toBeUndefined();
		expect(h.roomMessages("resumed")).toHaveLength(0);
	});

	test("persisting on open writes a room-state entry", async () => {
		const h = createHarness();
		await h.openRoom();
		const entries = h.sessionManager.branch.filter(
			entry => (entry as { customType?: string }).customType === "local-duo-room-state",
		);
		expect(entries).toHaveLength(1);
	});

	test("tracks ASK/ANSWER as pending questions with board lines and turn reminders", async () => {
		const h = createHarness();
		await h.openRoom();
		h.emitToolCall("hub", { op: "send", to: "DuoPeer", message: "ASK q1 who owns the parser?" }, "q-1");
		const asks = h.roomMessages("ask");
		expect(asks).toHaveLength(1);
		expect(asks[0].message.content).toContain("asks (q1)");
		expect(h.widgets.get("local-duo-board")?.join("\n")).toContain("unanswered: q1");
		const prompt = await h.emitBeforeAgentStart(["base"]);
		expect(prompt?.systemPrompt.join("\n")).toContain("q1");

		h.emitMessageEnd({
			role: "toolResult",
			toolName: "hub",
			isError: false,
			content: [{ type: "text", text: "[a9] DuoPeer: ANSWER q1 you own the parser" }],
		});
		expect(h.roomMessages("answered")).toHaveLength(1);
		expect(h.widgets.get("local-duo-board")?.join("\n")).not.toContain("unanswered");
		const settled = await h.emitBeforeAgentStart(["base"]);
		expect(settled?.systemPrompt.join("\n")).not.toContain("Duo pending questions");
	});

	test("shows structured native Hub replies and clears the answered question once", async () => {
		const h = createHarness();
		await h.openRoom();
		h.emitToolCall("hub", { op: "send", to: "DuoPeer", message: "ASK q1 What is the check result?", await: true });
		const message = {
			role: "toolResult", toolName: "hub", isError: false,
			content: [{ type: "text", text: "Delivered to 1 peer(s):\n- DuoPeer: injected\n\nReply from DuoPeer:\nANSWER q1 confirmed" }],
			details: { op: "send", waited: { id: "native-reply-1", from: "DuoPeer", to: "Main", body: "ANSWER q1 confirmed" } },
		};
		h.emitMessageEnd(message);
		expect(h.roomMessages("answered")).toHaveLength(1);
		expect(h.roomMessages("peer-message")).toHaveLength(1);
		expect(h.widgets.get("local-duo-board")?.join("\n")).not.toContain("unanswered");
		h.sessionManager.branch.push({ type: "message", message });
		await h.emitBeforeAgentStart(["base"]);
		expect(h.roomMessages("answered")).toHaveLength(1);
	});

	test("echoes shared-notes updates into the room chat", async () => {
		const h = createHarness();
		await h.openRoom();
		h.emitToolCall("write", { path: ".omp/duo/notes.md", content: "## DECISIONS\n- split agreed" }, "n-1");
		const notes = h.roomMessages("notes");
		expect(notes).toHaveLength(1);
		expect(notes[0].message.content).toContain("shared notes");
		h.emitToolCall("write", { path: "src/other.js", content: "x" }, "n-2");
		expect(h.roomMessages("notes")).toHaveLength(1);
	});

	test("records the agreement mechanically from real AGREE traffic", async () => {
		const h = createHarness();
		await h.openRoom();
		h.emitToolCall("hub", { op: "send", to: "DuoPeer", message: "AGREE — I take count.js, you take cli.js + tests" }, "c1");
		const agreed = h.roomMessages("agreed");
		expect(agreed).toHaveLength(1);
		expect(agreed[0].message.content).toContain("Agreement recorded");
		expect(h.widgets.get("local-duo-board")?.join("\n")).toContain("agreed:");
		// A second AGREE (from the peer) must not duplicate the note.
		h.emitMessageEnd({
			role: "toolResult",
			toolName: "hub",
			isError: false,
			content: [{ type: "text", text: "[x9] DuoPeer: AGREE — confirmed split" }],
		});
		expect(h.roomMessages("agreed")).toHaveLength(1);
	});

	test("surfaces BLOCKED and DONE mechanically from peer traffic", async () => {
		const h = createHarness();
		await h.openRoom();
		h.emitMessageEnd({
			role: "toolResult",
			toolName: "hub",
			isError: false,
			content: [{ type: "text", text: "[b1] DuoPeer: BLOCKED tests: fixture missing\n[d1] DuoPeer: DONE count.js edge cases covered" }],
		});
		const blocked = h.roomMessages("blocked");
		expect(blocked).toHaveLength(1);
		expect(blocked[0].message.content).toContain("Model A is blocked");
		const finished = h.roomMessages("member-done");
		expect(finished).toHaveLength(1);
		expect(finished[0].message.content).toContain("Model A finished");
		expect(h.widgets.get("local-duo-board")?.join("\n")).toContain("done: count.js edge cases covered");
	});

	test("status reports peer presence and refreshes the board", async () => {
		const h = createHarness();
		await h.openRoom();
		await h.runCommand("status");
		expect(h.notifications.at(-1)?.message).toContain("not yet admitted");
		h.admitPeer();
		await h.runCommand("status");
		expect(h.notifications.at(-1)?.message).toContain("present");
		expect(h.widgets.get("local-duo-board")?.join("\n")).toContain("duo room");
	});

	test("disable restores the prior model override and preserves user overrides", async () => {
		settings = fakeSettings({ "task.agentModelOverrides": { scout: "acme/scout-xl" } });
		setSettingsLoaderForTests(async () => settings);
		const h = createHarness();
		await h.openRoom();
		expect(settings.store.get("task.agentModelOverrides")).toEqual({
			scout: "acme/scout-xl",
			"duo-peer": "example-a/model-a",
		});
		await h.runCommand("disable");
		expect(settings.store.get("task.agentModelOverrides")).toEqual({ scout: "acme/scout-xl" });
	});

	test("a chained re-open restores the very first override on disable", async () => {
		const h = createHarness();
		await h.openRoom("example-a/model-a");
		await h.openRoom("example-a/model-c");
		await h.runCommand("disable");
		expect(settings.store.get("task.agentModelOverrides")).toEqual({});
		expect(h.state.thinkingLevel).toBe("medium");
	});

	test("shutdown tears down without reopening the persisted room", async () => {
		const h = createHarness();
		await h.openRoom();
		await h.fireSessionEvent("session_shutdown");
		expect(h.roomMessages("resumed")).toHaveLength(0);
		expect(settings.store.get("task.agentModelOverrides")).toEqual({});
		expect(h.status.size).toBe(0);
		expect(h.widgets.size).toBe(0);
		await h.fireSessionEvent("session_start");
		expect(h.roomMessages("resumed")).toHaveLength(1);
	});

	test("incoming custom messages update the board without waiting for another turn", async () => {
		const h = createHarness();
		await h.openRoom();
		const message = { role: "custom", customType: "irc:incoming", details: {
			id: "live-1", from: "DuoPeer", message: "STATUS implementing parser",
		} };
		h.emitMessageEnd(message);
		expect(h.roomMessages("peer-message")).toHaveLength(1);
		expect(h.widgets.get("local-duo-board")?.join("\n")).toContain("implementing parser");
		h.emitMessageEnd(message);
		expect(h.roomMessages("peer-message")).toHaveLength(1);
	});

	test("a peer that already completed still closes the room on disable", async () => {
		const h = createHarness();
		await h.openRoom();
		h.admitPeer();
		await h.runCommand("disable");
		// The peer yielded on its own; hub cancel reports already_completed —
		// nothing is left to stop, so the room must close instead of hanging closing.
		await h.emitToolResult("hub", "cancel-1", false, {
			op: "cancel",
			cancelled: [{ id: "DuoPeer", status: "already_completed" }],
		});
		expect(h.roomMessages("closed")).toHaveLength(1);
		expect(settings.store.get("task.agentModelOverrides")).toEqual({});
		await h.runCommand("status");
		expect(h.notifications.at(-1)?.message).toContain("Duo is disabled");
	});

	test("failed cancellation cannot falsely close the room or admit a replacement", async () => {
		const h = createHarness();
		await h.openRoom();
		h.admitPeer();
		await h.runCommand("disable");
		await h.emitToolResult("hub", "cancel-1", true, { op: "cancel", cancelled: [] });
		expect(h.roomMessages("closed")).toHaveLength(0);
		await h.openRoom("example-a/model-c");
		expect(h.roomMessages("opened")).toHaveLength(1);
		expect(h.notifications.some(n => n.level === "warning")).toBe(true);
	});

	test("a resumed admitted peer is still cancelled on disable", async () => {
		const h = createHarness();
		await h.openRoom();
		h.admitPeer();
		await h.fireSessionEvent("session_shutdown");
		await h.fireSessionEvent("session_start");
		await h.runCommand("disable");
		expect(h.controlMessages("stop-peer")).toHaveLength(1);
		expect(h.roomMessages("closed")).toHaveLength(0);
		await h.emitToolResult("hub", "cancel-1", false, { op: "cancel", cancelled: [{ id: "DuoPeer", status: "not_found" }] });
		expect(h.roomMessages("closed")).toHaveLength(1);
	});

	test("task admission and peer messages always carry the canonical todo snapshot", async () => {
		const h = createHarness();
		await h.openRoom();
		h.sessionManager.branch.push({ type: "custom", customType: "user_todo_edit", data: { phases: [
			{ name: "Build", tasks: [{ content: "Parser", status: "pending" }] },
		] } });
		const task = h.emitToolCall("task", { agent: "duo-peer", task: "Join the room" });
		expect(task?.input?.context).toContain("[pending] Parser");
		const hub = h.emitToolCall("hub", { op: "send", to: "DuoPeer", message: "PROPOSE parser" });
		expect(hub?.input?.message).toContain("[pending] Parser");
		expect(h.roomMessages("message")[0].message.content).not.toContain("[pending] Parser");
	});

	test("a failed spawn leaves no peer, so the room re-opens and closes without cancellation", async () => {
		const h = createHarness();
		await h.openRoom();
		h.emitToolCall("task", { agent: "duo-peer", task: "Join" }, "spawn-x");
		await h.emitToolResult("task", "spawn-x", true);
		expect(h.roomMessages("failed")).toHaveLength(1);
		await h.openRoom("example-a/model-c");
		expect(h.roomMessages("opened")).toHaveLength(2);
		await h.runCommand("disable");
		expect(h.controlMessages("stop-peer")).toHaveLength(0);
		expect(h.roomMessages("closed")).toHaveLength(1);
	});

	test("a pending spawn blocks a replacement and is cancelled on disable", async () => {
		const h = createHarness();
		await h.openRoom();
		h.emitToolCall("task", { agent: "duo-peer", task: "Join" }, "pending-1");
		await h.openRoom("example-a/model-c");
		expect(h.roomMessages("opened")).toHaveLength(1);
		await h.runCommand("disable");
		expect(h.controlMessages("stop-peer")).toHaveLength(1);
	});

	test("triggers the admit turn only when a UI can absorb it", async () => {
		const h = createHarness();
		h.context.hasUI = true;
		await h.openRoom();
		expect(h.controlMessages("admit-peer")[0].options?.triggerTurn).toBe(true);

		const headless = createHarness();
		headless.context.hasUI = false;
		await headless.openRoom();
		expect(headless.controlMessages("admit-peer")[0].options?.triggerTurn).toBeFalsy();
	});

	test("normalizes a peer-targeting spawn and enforces one hidden member", async () => {
		const h = createHarness();
		await h.openRoom();
		const result = h.emitToolCall("task", {
			agent: "duo-peer",
			name: "Wrong",
			task: "Join the room",
			isolated: true,
		});
		expect(result?.reason).toBeUndefined();
		expect(result?.input).toMatchObject({ agent: "duo-peer", name: "DuoPeer", task: "Join the room" });
		expect(result?.input).not.toHaveProperty("isolated");
		h.emitToolResult("task", "call-1", true);
		const mixed = h.emitToolCall(
			"task",
			{
				context: "shared",
				tasks: [
					{ agent: "duo-peer", task: "Join" },
					{ agent: "research", task: "Explore" },
				],
			},
			"call-2",
		);
		expect(mixed?.block).toBe(true);
		expect(mixed?.reason).toContain("exactly one hidden room member");
	});
});
