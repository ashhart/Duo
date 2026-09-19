// Run with: omp --no-session --no-title --no-extensions -e ./scripts/host-smoke.ts -p /duo-smoke
// Uses the installed OMP runtime without making an inference request.
import assert from "node:assert/strict";
import localDuo from "../src/omp";
import { roomStateOf } from "../src/room";
import { modelSelector } from "../src/models";
import type { CommandContext, OmpExtensionApi } from "../src/types";

export default function hostSmoke(api: OmpExtensionApi): void {
	let duo: { handler(args: string, context: CommandContext): Promise<void> };
	const proxy = new Proxy(api, {
		get(target, key) {
			if (key === "registerCommand") return (name: string, command: typeof duo) => {
				if (name === "duo") duo = command;
			};
			const value = Reflect.get(target, key, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	localDuo(proxy);
	api.registerCommand("duo-smoke", {
		description: "Verify Duo against the installed OMP runtime without inference",
		getArgumentCompletions: () => null,
		handler: async (_args, context) => {
			const visible = context.models.current();
			assert.ok(visible, "OMP must have a current model");
			const thinking = api.getThinkingLevel?.();
			await duo.handler(modelSelector(visible), context);
			assert.ok(roomStateOf(context), "Room should open");
			await duo.handler("disable", context);
			assert.equal(roomStateOf(context), undefined, "Unadmitted room should close");
			assert.equal(api.getThinkingLevel?.(), thinking, "Thinking should restore");
			console.log("PASS: installed OMP loaded Duo, opened/closed the room, and restored thinking without inference");
		},
	});
}
