import { describe, expect, it } from "vitest";
import { formatWhen, localDate } from "./time";

const tz = "Europe/London";
const opts = { tz, locale: "en-GB" };
const at = (iso: string) => Date.parse(iso);
const now = at("2026-09-24T11:00:00Z"); // Thu 12:00 BST

describe("time helpers", () => {
	it("gives the local date in a timezone", () => {
		expect(localDate(at("2026-09-23T23:30:00Z"), tz)).toBe("2026-09-24");
	});

	it("formats relative days, weekdays and dates", () => {
		expect(
			formatWhen(at("2026-09-24T17:00:00Z"), now, { ...opts, time: true }),
		).toBe("18:00");
		expect(formatWhen(at("2026-09-24T17:00:00Z"), now, opts)).toBe("Today");
		expect(
			formatWhen(at("2026-09-25T07:00:00Z"), now, { ...opts, time: true }),
		).toBe("Tomorrow 08:00");
		expect(formatWhen(at("2026-09-23T07:00:00Z"), now, opts)).toBe("Yesterday");
		expect(
			formatWhen(at("2026-09-21T07:00:00Z"), now, { ...opts, time: true }),
		).toBe("Mon 08:00");
		expect(formatWhen(at("2026-10-04T07:00:00Z"), now, opts)).toBe("4 Oct");
	});
});
