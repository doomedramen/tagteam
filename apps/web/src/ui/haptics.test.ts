import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vibration } from "web-haptics";

const haptics = vi.hoisted(() => ({
	trigger: vi.fn(async (_input: Vibration[] | string) => {}),
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
	fireTaskUndoHaptic,
	startTaskHoldHapticRamp,
} from "./haptics";

beforeEach(() => {
	haptics.trigger.mockClear();
	haptics.cancel.mockClear();
});

describe("task haptics", () => {
	it("ramps haptics up during completion", () => {
		startTaskHoldHapticRamp("complete", 2000);

		const pattern = haptics.trigger.mock.calls[0]?.[0] as Vibration[];
		expect(pattern).toHaveLength(16);
		expect(pattern[0]).toEqual({ duration: 35, intensity: 0.3 });
		expect(pattern.at(-1)).toEqual({ delay: 90, duration: 35, intensity: 1 });
	});

	it("ramps haptics down during uncompletion and can cancel the pattern", () => {
		startTaskHoldHapticRamp("undo", 5000);

		const pattern = haptics.trigger.mock.calls[0]?.[0] as Vibration[];
		expect(pattern).toHaveLength(25);
		expect(pattern[0]).toEqual({ duration: 35, intensity: 1 });
		expect(pattern.at(-1)).toEqual({
			delay: 165,
			duration: 35,
			intensity: expect.closeTo(0.3),
		});

		cancelTaskHoldHaptics();
		expect(haptics.cancel).toHaveBeenCalledOnce();
	});

	it("uses a separate success pattern for the confetti confirmation", () => {
		fireTaskSuccessHaptic();
		expect(haptics.trigger).toHaveBeenCalledWith("success");
	});

	it("uses a light confirmation when a task is uncompleted", () => {
		fireTaskUndoHaptic();
		expect(haptics.trigger).toHaveBeenCalledWith("light");
	});
});
