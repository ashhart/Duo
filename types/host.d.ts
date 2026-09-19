/**
 * Minimal typing for the host import in src/settings.ts. At runtime the OMP
 * loader remaps this bare specifier onto the running host, so the plugin has
 * no dependency to install; this shim only serves `bun run typecheck`.
 */
declare module "@oh-my-pi/pi-coding-agent" {
	export const Settings: {
		readonly instance: {
			get(path: string): unknown;
			override(path: string, value: unknown): void;
		};
	};
}
