import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TASK_COLORS } from "@tagteam/core";
import { describe, expect, it } from "vitest";

const script = join(
	import.meta.dirname,
	"../../../scripts/check-task-palette.mjs",
);
const css = readFileSync(join(import.meta.dirname, "../../index.css"), "utf8");
const ROLES = ["sheet", "card", "swatch", "ring", "fg"] as const;

describe("task palette", () => {
	it("passes the contrast script", () => {
		const output = execFileSync(process.execPath, [script], {
			encoding: "utf8",
		});
		expect(output).toContain("task palette ok");
	});

	it("defines every hue and role for light and dark", () => {
		for (const hue of TASK_COLORS)
			for (const role of ROLES) {
				const definitions = css.match(
					new RegExp(`--task-${hue}-${role}:\\s*#[0-9a-fA-F]{6};`, "g"),
				);
				expect(definitions, `--task-${hue}-${role}`).toHaveLength(2);
			}
	});

	it("maps each hue onto the generic variables", () => {
		for (const hue of TASK_COLORS) {
			expect(css).toContain(`[data-task-color="${hue}"]`);
			for (const role of ROLES)
				expect(css).toContain(`--task-${role}: var(--task-${hue}-${role});`);
		}
	});

	it("falls back to the neutral tokens when a task has no color", () => {
		for (const [role, neutral] of [
			["sheet", "bg"],
			["card", "surface"],
			["swatch", "surface-2"],
			["ring", "text-3"],
			["fg", "text"],
		]) {
			expect(css).toContain(`--task-${role}: var(--${neutral});`);
		}
	});

	it("exposes the generic variables as Tailwind colors", () => {
		for (const role of ROLES)
			expect(css).toContain(`--color-task-${role}: var(--task-${role});`);
	});
});
