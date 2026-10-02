import { describe, expect, it } from "vitest";
import { AUTO_PICK_EXCLUSION, isAutoPickExcluded } from "./auto-pick";
import catalog from "./catalog.json";

const entries = catalog as { e: string; n: string; g: string }[];
const named = (name: string) => {
	const entry = entries.find((candidate) => candidate.n === name);
	if (!entry) throw new Error(`no emoji named ${name}`);
	return entry;
};

describe("isAutoPickExcluded", () => {
	it("excludes every flag and every symbol", () => {
		const flags = entries.filter((entry) => entry.g === "flags");
		const symbols = entries.filter((entry) => entry.g === "symbols");
		expect(flags.length).toBeGreaterThan(200);
		expect(symbols.length).toBeGreaterThan(200);
		expect([...flags, ...symbols].every(isAutoPickExcluded)).toBe(true);
	});

	it("excludes the 24 clock faces and nothing else near them", () => {
		const excluded = entries
			.filter((entry) => entry.g === "travel & places")
			.filter(isAutoPickExcluded);
		expect(excluded).toHaveLength(24);
		expect(excluded.map((entry) => entry.n)).toContain("six o’clock");
		expect(excluded.map((entry) => entry.n)).toContain("twelve-thirty");
		for (const name of ["alarm clock", "watch", "stopwatch", "hourglass done"])
			expect(isAutoPickExcluded(named(name)), name).toBe(false);
	});

	it("keeps ordinary emoji", () => {
		for (const name of ["potted plant", "dog", "wastebasket", "shower", "bed"])
			expect(isAutoPickExcluded(named(name)), name).toBe(false);
	});

	it("excludes only flags, symbols and clock faces", () => {
		const excluded = entries.filter(isAutoPickExcluded);
		expect(
			excluded.every((entry) =>
				["flags", "symbols", "travel & places"].includes(entry.g),
			),
		).toBe(true);
	});
});

describe("AUTO_PICK_EXCLUSION", () => {
	it("ships off", () => {
		// Flip it only when `pnpm --filter @tagteam/web emoji:eval` prints ADOPT (its last line says so).
		expect(AUTO_PICK_EXCLUSION).toBe(false);
	});
});
