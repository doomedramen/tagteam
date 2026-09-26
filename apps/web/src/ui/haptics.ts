import { type Vibration, WebHaptics } from "web-haptics";

const COMPLETE_PULSE_INTERVAL_MS = 125;
const UNDO_PULSE_INTERVAL_MS = 200;
const PULSE_DURATION_MS = 35;

let haptics: WebHaptics | null = null;

function getHaptics() {
	haptics ??= new WebHaptics();
	return haptics;
}

export function startTaskHoldHapticRamp(
	action: "complete" | "undo",
	durationMs: number,
) {
	const intervalMs =
		action === "complete" ? COMPLETE_PULSE_INTERVAL_MS : UNDO_PULSE_INTERVAL_MS;
	const count = Math.max(2, Math.floor(durationMs / intervalMs));
	const pattern: Vibration[] = Array.from({ length: count }, (_, index) => {
		const progress = index / (count - 1);
		return {
			...(index > 0 ? { delay: intervalMs - PULSE_DURATION_MS } : {}),
			duration: PULSE_DURATION_MS,
			intensity:
				action === "complete" ? 0.3 + progress * 0.7 : 1 - progress * 0.7,
		};
	});

	void getHaptics()
		.trigger(pattern)
		.catch(() => {});
}

export function cancelTaskHoldHaptics() {
	haptics?.cancel();
}

export function fireTaskSuccessHaptic() {
	void getHaptics()
		.trigger("success")
		.catch(() => {});
}

export function fireTaskUndoHaptic() {
	void getHaptics()
		.trigger("light")
		.catch(() => {});
}
