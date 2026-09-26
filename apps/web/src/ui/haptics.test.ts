import { beforeEach, describe, expect, it, vi } from "vitest";

const haptics = vi.hoisted(() => ({
	trigger: vi.fn(async () => {}),
	cancel: vi.fn(),
}));

vi.mock("web-haptics", () => ({
	WebHaptics: class {
		trigger = haptics.trigger;
		cancel = haptics.cancel;
	},
}));

import {
	cancelTaskHoldHaptics,
	fireTaskSuccessHaptic,
	startTaskHoldHapticRamp,
} from "./haptics";

beforeEach(() => {
	haptics.trigger.mockClear();
	haptics.cancel.mockClear();
});

describe("task haptics", () => {
	it("ramps haptics up during completion", () => {
		startTaskHoldHapticRamp("complete", 2000);

		expect(haptics.trigger).toHaveBeenCalledWith([
			{ duration: 20, intensity: 0.2 },
			{ delay: 430, duration: 20, intensity: 0.35 },
			{ delay: 430, duration: 20, intensity: 0.5 },
			{ delay: 430, duration: 20, intensity: 0.7 },
			{ delay: 430, duration: 20, intensity: 0.9 },
		]);
	});

	it("ramps haptics down during uncompletion and can cancel the pattern", () => {
		startTaskHoldHapticRamp("undo", 5000);

		expect(haptics.trigger).toHaveBeenCalledWith([
			{ duration: 20, intensity: 0.9 },
			{ delay: 1105, duration: 20, intensity: 0.7 },
			{ delay: 1105, duration: 20, intensity: 0.5 },
			{ delay: 1105, duration: 20, intensity: 0.35 },
			{ delay: 1105, duration: 20, intensity: 0.2 },
		]);

		cancelTaskHoldHaptics();
		expect(haptics.cancel).toHaveBeenCalledOnce();
	});

	it("uses a separate success pattern for the confetti confirmation", () => {
		fireTaskSuccessHaptic();
		expect(haptics.trigger).toHaveBeenCalledWith("success");
	});
});
