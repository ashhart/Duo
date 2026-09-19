/** Deterministic providers, real OMP task admission and Hub delivery; no network inference. */
import assert from "node:assert/strict";
import { createAssistantMessageEventStream } from "@oh-my-pi/pi-ai";

export default function integration(api: any): void {
  let callId = 0;
  api.registerProvider("duo-check", {
    api: "duo-check-stream",
    baseUrl: "https://example.invalid",
    apiKey: "duo-test-placeholder",
    models: ["visible", "peer"].map(id => ({
      id, name: `Duo test ${id}`, reasoning: false, input: ["text"],
      contextWindow: 131072, maxTokens: 2048,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
    streamSimple(model: any, context: any) {
      const history = JSON.stringify(context.messages);
      const stream = createAssistantMessageEventStream();
      const tool = (name: string, args: object) => ({ type: "toolCall", id: `duo-check-${++callId}`, name, arguments: args });
      let content: any[];
      const previousCalls = context.messages.filter((m: any) => m.role === "assistant" && m.model === model.id)
        .flatMap((m: any) => m.content).filter((c: any) => c.type === "toolCall");
      assert.ok(previousCalls.length < 12, "Test exceeded bounded tool calls");
      if (model.id === "visible") {
        if (!previousCalls.some((c: any) => c.name === "task")) {
          content = [tool("task", { agent: "duo-peer", name: "DuoPeer", task: "Join the room and answer ASK q1 through Agent Hub." })];
        } else if (history.includes("ANSWER q1 DUO_PEER_RECEIVED")) {
          content = [{ type: "text", text: "DUO_INTEGRATION_PASSED: selected peer received ASK and returned ANSWER through native Agent Hub." }];
        } else if (!previousCalls.some((c: any) => c.name === "hub" && c.arguments.op === "send")) {
          content = [tool("hub", { op: "send", to: "DuoPeer", message: "ASK q1 What is the check result?", await: true })];
        } else content = [tool("hub", { op: "wait" })];
      } else {
        assert.equal(model.id, "peer");
        if (history.includes("ASK q1 What is the check result?") && !previousCalls.some((c: any) => c.name === "hub")) {
          content = [tool("hub", { op: "send", to: "Main", message: "ANSWER q1 DUO_PEER_RECEIVED" })];
        } else content = [{ type: "text", text: history.includes("ASK q1 What is the check result?") ? "ANSWER q1 DUO_PEER_RECEIVED" : "Peer joined; waiting for ASK q1." }];
      }
      const message: any = {
        role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: content[0]?.type === "toolCall" ? "toolUse" : "stop",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      setTimeout(() => {
      stream.push({ type: "start", partial: { ...message, content: [] } });
      for (const [contentIndex, part] of content.entries()) {
        if (part.type === "toolCall") {
          stream.push({ type: "toolcall_start", contentIndex, partial: message });
          stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(part.arguments), partial: message });
          stream.push({ type: "toolcall_end", contentIndex, toolCall: part, partial: message });
        } else {
          stream.push({ type: "text_start", contentIndex, partial: message });
          stream.push({ type: "text_delta", contentIndex, delta: part.text, partial: message });
          stream.push({ type: "text_end", contentIndex, content: part.text, partial: message });
        }
      }
      stream.push({ type: "done", reason: message.stopReason, message });
      }, 100);
      return stream;
    },
  });
}
