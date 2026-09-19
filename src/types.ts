export type ModelRef = {
	provider: string;
	id: string;
	name?: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
};

export interface SessionManagerLike {
	getBranch?(): unknown[];
}

export interface RoomState {
	visible: ModelRef;
	peer: ModelRef;
	previousPeerOverride?: string;
	previousThinking?: string;
	closing?: boolean;
	peerMayExist?: boolean;
}

export interface CommandContext {
	sessionManager: SessionManagerLike;
	model?: ModelRef;
	/** False in print/RPC mode, where a triggered turn would collide with the next queued prompt. */
	hasUI?: boolean;
	models: {
		list(): ModelRef[];
		current(): ModelRef | undefined;
		resolve(selector: string): ModelRef | undefined;
	};
	ui: {
		select(
			title: string,
			options: Array<string | { label: string; description?: string }>,
		): Promise<string | undefined>;
		notify(message: string, level?: "info" | "warning" | "error"): void;
		setStatus(key: string, value: string | undefined): void;
		setWidget?(key: string, content: string[] | undefined, options?: unknown): void;
	};
}

export interface PromptEvent {
	systemPrompt?: string | string[];
}

export interface ToolCallEvent {
	toolName: string;
	toolCallId: string;
	input: Record<string, unknown>;
}

export interface ToolResultEvent {
	toolName: string;
	toolCallId: string;
	isError: boolean;
	details?: unknown;
}

export interface OmpExtensionApi {
	/** Native OMP model selection; false when authentication is unavailable. */
	setModel?(model: ModelRef): Promise<boolean>;
	on(
		event: "before_agent_start",
		handler: (event: PromptEvent, context: CommandContext) => { systemPrompt: string[] } | undefined | Promise<{ systemPrompt: string[] } | undefined>,
	): void;
	on(
		event: "session_start" | "session_switch" | "session_branch" | "session_shutdown",
		handler: (event: unknown, context: CommandContext) => void | Promise<void>,
	): void;
	on(
		event: "tool_call",
		handler: (
			event: ToolCallEvent,
			context: CommandContext,
		) => { block?: boolean; reason?: string; input?: Record<string, unknown> } | undefined,
	): void;
	on(event: "tool_result", handler: (event: ToolResultEvent, context: CommandContext) => void | Promise<void>): void;
	on(
		event: "message_end",
		handler: (event: { message: unknown }, context: CommandContext) => void,
	): void;
	registerCommand(
		name: string,
		options: {
			description: string;
			getArgumentCompletions(prefix: string): Array<{ value: string; label: string }> | null;
			handler(args: string, context: CommandContext): Promise<void>;
		},
	): void;
	setThinkingLevel(level: string): void;
	getThinkingLevel?(): string | undefined;
	sendMessage<T = unknown>(
		message: {
			customType: string;
			content: string;
			display: boolean;
			details?: T;
			attribution?: "agent" | "user";
		},
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): void;
	/** Persist a custom entry in the session file; not sent to the LLM. */
	appendEntry<T = unknown>(customType: string, data?: T): void;
}

export interface TodoTask {
	content: string;
	status: string;
	blocker?: string;
}

export interface TodoPhase {
	name: string;
	tasks: TodoTask[];
}

/** Live per-session picture of what each room member is doing, for the team board. */
export interface RoomProgress {
	visibleTask?: string;
	peerTask?: string;
}
