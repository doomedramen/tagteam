import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { syncLabel } from "./SyncChip";

describe("AppShell", () => {
	it("shows navigation with the current tab marked", () => {
		render(
			<MemoryRouter initialEntries={["/team"]}>
				<AppShell title="Smiths" onAdd={vi.fn()}>
					<p>content</p>
				</AppShell>
			</MemoryRouter>,
		);
		for (const name of ["Today", "Team", "History", "Me", "Add task"]) {
			expect(
				screen.getByRole(name === "Add task" ? "button" : "link", { name }),
			).toBeInTheDocument();
		}
		expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute(
			"aria-current",
		);
	});
});

describe("syncLabel", () => {
	it("is hidden when synced and explains offline or pending work", () => {
		expect(
			syncLabel({ state: "idle", pending: 0, lastSyncedAt: 1 }),
		).toBeNull();
		expect(syncLabel({ state: "offline", pending: 0, lastSyncedAt: 1 })).toBe(
			"Offline",
		);
		expect(syncLabel({ state: "offline", pending: 2, lastSyncedAt: 1 })).toBe(
			"Offline · 2 queued",
		);
		expect(syncLabel({ state: "syncing", pending: 3, lastSyncedAt: 1 })).toBe(
			"Syncing 3",
		);
	});
});
