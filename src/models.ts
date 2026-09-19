import type { ModelRef } from "./types";

export function modelSelector(model: ModelRef): string {
	return model.provider + "/" + model.id;
}

export function modelLabel(model: ModelRef): string {
	return model.name?.trim() || model.id;
}

function formatContextWindow(value: number | undefined): string {
	return typeof value === "number" && Number.isFinite(value)
		? value.toLocaleString("en-US") + " context"
		: "context unknown";
}

/**
 * Every configured model is a valid peer candidate, including the one currently
 * visible: the room then runs two concurrent connections to the same model.
 */
export function peerChoices(models: ModelRef[]): ModelRef[] {
	const seen = new Set<string>();
	return models
		.filter(model => {
			const selector = modelSelector(model);
			if (seen.has(selector)) return false;
			seen.add(selector);
			return true;
		})
		.sort((left, right) => modelSelector(left).localeCompare(modelSelector(right)));
}

export function peerChoiceDescription(model: ModelRef, current: ModelRef | undefined): string {
	const currentNote =
		current && modelSelector(model) === modelSelector(current) ? " · current model, second connection" : "";
	return modelLabel(model) + " · " + formatContextWindow(model.contextWindow) + currentNote;
}
