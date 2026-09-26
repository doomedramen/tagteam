import { type Vibration, WebHaptics } from "web-haptics";

const PULSE_COUNT = 5;
const PULSE_DURATION_MS = 20;

let haptics: WebHaptics | null = null;

function getHaptics() {
	haptics ??= new WebHaptics();
	return haptics;
}

export function startTaskHoldHapticRamp(
	action: "complete" | "undo",
	durationMs: number,
) {
	const intervalMs = (durationMs * 0.9) / (PULSE_COUNT - 1);
	const intensities =
		action === "complete"
			? [0.2, 0.35, 0.5, 0.7, 0.9]
			: [0.9, 0.7, 0.5, 0.35, 0.2];
	const pattern: Vibration[] = intensities.map((intensity, index) => ({
		...(index > 0 ? { delay: intervalMs - PULSE_DURATION_MS } : {}),
		duration: PULSE_DURATION_MS,
		intensity,
	}));

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
