import { isRecord } from "./util";

export interface RuntimeSettings {
	get(path: string): unknown;
	override(path: string, value: unknown): void;
}

async function loadHostRuntimeSettings(): Promise<RuntimeSettings> {
	const runtime = (await import("@oh-my-pi/pi-coding-agent")) as unknown as {
		Settings: { instance: RuntimeSettings };
	};
	return runtime.Settings.instance;
}

let loadRuntimeSettings: () => Promise<RuntimeSettings> = loadHostRuntimeSettings;

/** Swap the settings source in tests; pass undefined to restore the host loader. */
export function setSettingsLoaderForTests(loader: (() => Promise<RuntimeSettings>) | undefined): void {
	loadRuntimeSettings = loader ?? loadHostRuntimeSettings;
}

/** Point the duo-peer agent at the selected model, remembering what to restore. */
export async function installPeerModelOverride(
	peerSelector: string,
	existing?: { previousPeerOverride?: string },
): Promise<string | undefined> {
	const settings = await loadRuntimeSettings();
	const current = settings.get("task.agentModelOverrides");
	const overrides = isRecord(current) ? { ...current } : {};
	const previous =
		existing ? existing.previousPeerOverride : (typeof overrides["duo-peer"] === "string" ? (overrides["duo-peer"] as string) : undefined);
	overrides["duo-peer"] = peerSelector;
	settings.override("task.agentModelOverrides", overrides);
	return previous;
}

/** Restore what the override was before the room opened; call only for a real room. */
export async function restorePeerModelOverride(previous: string | undefined): Promise<void> {
	const settings = await loadRuntimeSettings();
	const current = settings.get("task.agentModelOverrides");
	const overrides = isRecord(current) ? { ...current } : {};
	if (previous) {
		overrides["duo-peer"] = previous;
	} else {
		delete overrides["duo-peer"];
	}
	settings.override("task.agentModelOverrides", overrides);
}

/**
 * Re-assert the room's peer override. The override lives in process-global
 * runtime settings, so a lifecycle event from another session or a host reload
 * can drop it; the room re-installs it at each turn boundary.
 */
export async function ensurePeerOverride(selector: string): Promise<void> {
	const settings = await loadRuntimeSettings();
	const current = settings.get("task.agentModelOverrides");
	if (isRecord(current) && current["duo-peer"] === selector) return;
	const overrides = isRecord(current) ? { ...current } : {};
	overrides["duo-peer"] = selector;
	settings.override("task.agentModelOverrides", overrides);
}
