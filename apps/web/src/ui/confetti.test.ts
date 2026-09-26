import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

import confetti from "canvas-confetti";
import { fireScreenConfettiCannon } from "./confetti";

beforeEach(() => vi.clearAllMocks());

describe("fireScreenConfettiCannon", () => {
	it("fires two confetti bursts", () => {
		fireScreenConfettiCannon();

		expect(confetti).toHaveBeenCalledTimes(2);
	});
});
