import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { buildRoomPrompt } from "../src/prompt";
import { formatTodos, latestTodos } from "../src/todos";
import { modelSelector, peerChoices } from "../src/models";
import { peerSpawnIntent, preparePeerTask } from "../src/task-guard";
import { cleanPeerBody, parseProtocolMessage, renderBoard, taskLine } from "../src/board";
import { peerMessagesFromEntries, unseenPeerMessages } from "../src/irc-watch";
import type { RoomState } from "../src/types";

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

describe("local duo units", () => {
	test("offers every configured model as a peer, including the current one", () => {
		const choices = peerChoices([visible, peer, peer]);
		expect(choices).toEqual([peer, visible].sort((a, b) => modelSelector(a).localeCompare(modelSelector(b))));
		expect(modelSelector(choices[1])).toBe("example-b/model-b");
	});

	test("extracts the newest native todo snapshot", () => {
		const oldPhases = [{ name: "Build", tasks: [{ content: "Old task", status: "completed" }] }];
		const newPhases = [{ name: "Build", tasks: [{ content: "Implement parser", status: "in_progress" }] }];
		const entries = [
			{ type: "message", message: { role: "toolResult", toolName: "todo", details: { phases: oldPhases } } },
			{ type: "message", message: { role: "toolResult", toolName: "todo", details: { phases: newPhases } } },
		];
		expect(latestTodos(entries)).toEqual(newPhases);
		expect(formatTodos(newPhases)).toContain("[in_progress] Implement parser");
	});

	test("makes both models equal and keeps their work visible", () => {
		const state: RoomState = { visible, peer };
		const prompt = buildRoomPrompt(state, "Build:\n- [pending] Implement parser");
		expect(prompt).toContain("equal member in a hidden OMP harness");
		expect(prompt).toContain("Neither member is the other's lead");
		expect(prompt).toContain("negotiate the split");
		expect(prompt).toContain("recorder, not the decision maker");
		expect(prompt).toContain("[Duo] Model B is working on <task>");
		expect(prompt).toContain("[Duo] Model A is working on <task>");
		expect(prompt).toContain("room board stays current");
		expect(prompt).toContain("do not acknowledge an AGREE");
		expect(prompt).toContain("[pending] Implement parser");
	});

	test("gives the hidden peer shared-workspace coordination without recursive spawning", async () => {
		const definition = await readFile(new URL("../agents/duo-peer.md", import.meta.url), "utf8");
		expect(definition).toContain("tools: read, write, edit, bash, grep, glob, lsp, ast_grep, ast_edit, hub");
		expect(definition).toContain("peer, not your lead or manager");
		expect(definition).toContain("same repository and working directory");
		expect(definition).toContain("PROPOSE <split and reason>");
		expect(definition).toContain("AGREE <exact task and owned paths>");
		expect(definition).toContain("do not acknowledge it");
		expect(definition).toContain("readable in the main chat");
		expect(definition).toContain("Do not spawn another agent");
	});

	test("enforces one named non-isolated hidden harness", () => {
		const prepared = preparePeerTask({
			context: "shared",
			tasks: [{ name: "Wrong", agent: "duo-peer", task: "Discuss the split", isolated: true }],
		});
		expect(prepared.reason).toBeUndefined();
		expect(prepared.input).toEqual({
			context: "shared",
			tasks: [{ name: "DuoPeer", agent: "duo-peer", task: "Discuss the split" }],
		});
		expect(preparePeerTask({ context: "shared", tasks: [{ task: "one" }, { task: "two" }] }).reason).toContain(
			"exactly one hidden room member",
		);
	});

	test("classifies which task spawns belong to the room", () => {
		expect(peerSpawnIntent({ agent: "research", task: "Explore" })).toBe("other");
		expect(peerSpawnIntent({ agent: "task", task: "Explore" })).toBe("other");
		expect(peerSpawnIntent({ agent: "duo-peer", task: "Join" })).toBe("peer");
		expect(peerSpawnIntent({ name: "DuoPeer", task: "Join" })).toBe("peer");
		// Admit attempts that only mention the peer in the framing, without agent/name fields.
		expect(
			peerSpawnIntent({ context: "DuoPeer joins the room and proposes", i: "admit DuoPeer", tasks: [{ task: "Join" }] }),
		).toBe("peer");
		// Ordinary work that mentions the peer stays untouched.
		expect(peerSpawnIntent({ task: "Explore the parser DuoPeer wrote" })).toBe("other");
		expect(
			peerSpawnIntent({ context: "review the duo room output", tasks: [{ agent: "research", task: "a" }] }),
		).toBe("other");
		expect(
			peerSpawnIntent({ context: "shared", tasks: [{ agent: "research", task: "a" }, { agent: "scout", task: "b" }] }),
		).toBe("other");
		expect(
			peerSpawnIntent({ context: "shared", tasks: [{ agent: "duo-peer", task: "a" }, { agent: "scout", task: "b" }] }),
		).toBe("mixed");
	});
});

describe("team board", () => {
	test("parses room protocol verbs into task summaries", () => {
		expect(parseProtocolMessage("STATUS implementing src/cli.js stdin wiring")).toEqual({
			verb: "STATUS",
			summary: "implementing src/cli.js stdin wiring",
		});
		expect(parseProtocolMessage("[Duo · some/model-x]\nDONE — Avenue A complete")).toEqual({
			verb: "DONE",
			summary: "Avenue A complete",
		});
		// Models vary the separator: colon, em dash, markdown emphasis.
		expect(parseProtocolMessage("AGREE: split confirmed").verb).toBe("AGREE");
		expect(parseProtocolMessage("**DONE** all tests pass").verb).toBe("DONE");
		expect(parseProtocolMessage("STATUS · Avenue B done").verb).toBe("STATUS");
		expect(parseProtocolMessage("BLOCKED—fixture missing").verb).toBe("BLOCKED");
		expect(parseProtocolMessage("plain chatter without a verb")).toBeUndefined();
		expect(taskLine("BLOCKED tests: fixture missing")).toBe("blocked: tests: fixture missing");
		expect(taskLine("random update text")).toBe("update: random update text");
	});

	test("parses ASK and ANSWER with their question ids", () => {
		expect(parseProtocolMessage("ASK q1 who owns the parser?")).toEqual({
			verb: "ASK",
			refId: "q1",
			summary: "who owns the parser?",
		});
		expect(parseProtocolMessage("ANSWER q1 the visible side owns it").refId).toBe("q1");
		expect(parseProtocolMessage("ASK Q-2 which runner?")).toMatchObject({ refId: "Q-2", summary: "which runner?" });
		// An ASK without an id keeps its first word in the question instead of treating it as the id.
		expect(parseProtocolMessage("ASK who owns the parser?")).toEqual({ verb: "ASK", summary: "who owns the parser?" });
		expect(taskLine("ASK q2 which test runner?")).toBe("ask q2: which test runner?");
	});

	test("strips the peer's mandated prefix", () => {
		expect(cleanPeerBody("[Duo · model-a]\n\nPROPOSE split")).toBe("PROPOSE split");
		expect(cleanPeerBody("no prefix here")).toBe("no prefix here");
		expect(cleanPeerBody("[Duo - Model A] STATUS parser")).toBe("STATUS parser");
	});

	test("renders a two-line live board", () => {
		const state: RoomState = { visible, peer };
		expect(renderBoard(state, {})).toEqual([
			"duo room · Model B + Model A",
			"you   ▸ waiting for the goal",
			"peer  ▸ joining the room",
		]);
		expect(renderBoard(state, { visibleTask: "status: cli.js", peerTask: "done: count.js" })[1]).toContain(
			"status: cli.js",
		);
	});

	test("marks same-model rooms as second connections on the board", () => {
		const state: RoomState = { visible, peer: visible };
		expect(renderBoard(state, {})[0]).toBe("duo room · Model B + Model B (second connection)");
	});

	test("finds unseen peer irc messages in the session branch", () => {
		const entries = [
			// Async delivery: custom_message entry with details.
			{
				type: "custom_message",
				customType: "irc:incoming",
				details: { id: "a1", from: "DuoPeer", message: "PROPOSE split" },
			},
			{ type: "custom_message", customType: "irc:incoming", details: { id: "b2", from: "ScoutAgent", message: "hi" } },
			// Consumed by the visible member's hub wait: tool result lines, with a
			// multi-line body running until the next delivery marker.
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "hub",
					isError: false,
					content: [
						{
							type: "text",
							text: "1 peer(s) running:\n- DuoPeer [duo-peer · running]\n[c3] DuoPeer: [Duo · some/model]\n\nSTATUS count.js done\n[d4] ScoutAgent: noise",
						},
					],
				},
			},
			// Same message id again via async delivery — must dedupe.
			{ type: "custom_message", customType: "irc:incoming", details: { id: "c3", from: "DuoPeer", message: "STATUS count.js done" } },
		];
		const messages = peerMessagesFromEntries(entries, "DuoPeer");
		expect(messages.map(message => message.id)).toEqual(["a1", "c3"]);
		expect(messages[1].body).toContain("STATUS count.js done");
		expect(messages[1].body).not.toContain("ScoutAgent");
		const seen = new Set<string>(["a1"]);
		expect(unseenPeerMessages(messages, seen).map(message => message.id)).toEqual(["c3"]);
	});

	test("reads inbox results, where the host bullets each delivery", () => {
		const text = "2 unread message(s):\n- [i1] DuoPeer: STATUS parser wired\n- [i2] ScoutAgent: noise\n- [i3] DuoPeer (reply to q1): ANSWER q1 you own it";
		const messages = peerMessagesFromEntries(
			[{ type: "message", message: { role: "toolResult", toolName: "hub", isError: false, content: [{ type: "text", text }] } }],
			"DuoPeer",
		);
		expect(messages).toEqual([
			{ id: "i1", body: "STATUS parser wired" },
			{ id: "i3", body: "ANSWER q1 you own it" },
		]);
	});

	test("captures peer replies, which render with a reply tag", () => {
		const text = "waiting…\n[e5] DuoPeer (reply to q1): BLOCKED tests: fixture missing";
		const messages = peerMessagesFromEntries(
			[{ type: "message", message: { role: "toolResult", toolName: "hub", isError: false, content: [{ type: "text", text }] } }],
			"DuoPeer",
		);
		expect(messages).toHaveLength(1);
		expect(messages[0].id).toBe("e5");
		expect(messages[0].body).toContain("BLOCKED tests: fixture missing");
	});
});


test("recovers structured native Hub replies from history and ignores other senders", () => {
	const entry = (from: string, id: string, isError = false) => ({
		type: "message", message: { role: "toolResult", toolName: "hub", isError,
			content: [], details: { waited: { from, id, body: "ANSWER q1 confirmed" } } },
	});
	expect(peerMessagesFromEntries([
		entry("DuoPeer", "native-1"), entry("OtherPeer", "other-1"), entry("DuoPeer", "failed-1", true),
	], "DuoPeer")).toEqual([{ id: "native-1", body: "ANSWER q1 confirmed" }]);
});
