import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("./haptics", () => ({ fireTaskSuccessHaptic: vi.fn() }));

import confetti from "canvas-confetti";
import { fireScreenConfettiCannon } from "./confetti";
import { fireTaskSuccessHaptic } from "./haptics";

beforeEach(() => vi.clearAllMocks());

describe("fireScreenConfettiCannon", () => {
	it("fires a success haptic with the two confetti bursts", () => {
		fireScreenConfettiCannon();

		expect(fireTaskSuccessHaptic).toHaveBeenCalledOnce();
		expect(confetti).toHaveBeenCalledTimes(2);
	});
});
