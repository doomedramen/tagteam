import type { TaskDto } from "@tagteam/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagTeamDb } from "../../store/db";
import { fakeEngine, ME, renderWithSession } from "../../test/fakes";
import { TodayScreen } from "./TodayScreen";

vi.mock("../../ui/confetti", () => ({
	fireScreenConfettiCannon: vi.fn(),
}));
vi.mock("../../ui/haptics", () => ({
	cancelTaskHoldHaptics: vi.fn(),
	startTaskHoldHapticRamp: vi.fn(),
	fireTaskSuccessHaptic: vi.fn(),
}));

import {
	cancelTaskHoldHaptics,
	startTaskHoldHapticRamp,
} from "../../ui/haptics";

const today = new Date();
const iso = (d: Date) => d.toLocaleDateString("en-CA");
const brushTeeth: TaskDto = {
	id: "t1",
	groupId: "g1",
	ownerId: "u1",
	title: "Brush teeth",
	notes: null,
	timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
	startDate: iso(today),
	rules: [
		{
			effectiveFrom: iso(today),
			rule: { freq: "day", interval: 1 },
			dueTime: "23:59",
		},
	],
	archivedAt: null,
	createdAt: 0,
};

let store: TagTeamDb;
beforeEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	localStorage.clear();
});

describe("TodayScreen", () => {
	it("invites adding a first task in an empty group", async () => {
		renderWithSession(<TodayScreen />, { store });
		expect(await screen.findByText("Add your first task")).toBeInTheDocument();
	});

	it("completes a task and offers undo", async () => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });

		await userEvent.click(
			await screen.findByRole("button", { name: "Complete Brush teeth" }),
		);
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "task.complete",
				taskId: "t1",
				occurrenceKey: iso(today),
			}),
		);
		const completionId = engine.enqueue.mock.calls[0]?.[0].id;

		await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
		expect(engine.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: "task.uncomplete",
				taskId: "t1",
				refEventId: completionId,
			}),
		);
	});

	it("ignores a second tap while the first completion is still in flight", async () => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });

		const button = await screen.findByRole("button", {
			name: "Complete Brush teeth",
		});
		fireEvent.click(button);
		fireEvent.click(button);

		await waitFor(() => expect(engine.enqueue).toHaveBeenCalled());
		expect(engine.enqueue).toHaveBeenCalledTimes(1);
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({ type: "task.complete", taskId: "t1" }),
		);
	});

	it("requires a 2-second touch hold and shows a rising wave fill", async () => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });

		const button = await screen.findByRole("button", {
			name: "Complete Brush teeth",
		});
		const fill = button.closest("li")?.querySelector("[data-hold-fill] path");
		expect(fill).not.toBeNull();

		vi.useFakeTimers();
		try {
			await act(async () => {
				fireEvent.pointerDown(button, {
					pointerId: 1,
					pointerType: "touch",
					button: 0,
					clientX: 12,
					clientY: 12,
				});
				vi.advanceTimersByTime(1000);
			});
			expect(fill).toHaveAttribute("d", expect.stringContaining("L 0 50"));
			expect(engine.enqueue).not.toHaveBeenCalled();
			expect(startTaskHoldHapticRamp).toHaveBeenCalledWith("complete", 2000);

			await act(async () => {
				vi.advanceTimersByTime(1000);
			});
			expect(engine.enqueue).toHaveBeenCalledTimes(1);
			expect(engine.enqueue).toHaveBeenCalledWith(
				expect.objectContaining({ type: "task.complete", taskId: "t1" }),
			);
			await act(async () => {
				fireEvent.pointerUp(button, {
					pointerId: 1,
					pointerType: "touch",
					button: 0,
					clientX: 12,
					clientY: 12,
				});
				fireEvent.click(button, { detail: 1 });
			});
			expect(engine.enqueue).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("cancels a touch hold when released or moved before completion", async () => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });

		const button = await screen.findByRole("button", {
			name: "Complete Brush teeth",
		});
		const fill = button.closest("li")?.querySelector("[data-hold-fill] path");
		vi.useFakeTimers();
		try {
			await act(async () => {
				fireEvent.pointerDown(button, {
					pointerId: 1,
					pointerType: "touch",
					button: 0,
					clientX: 12,
					clientY: 12,
				});
				vi.advanceTimersByTime(500);
				fireEvent.pointerUp(button, {
					pointerId: 1,
					pointerType: "touch",
					button: 0,
					clientX: 12,
					clientY: 12,
				});
				fireEvent.click(button, { detail: 1 });
			});
			expect(engine.enqueue).not.toHaveBeenCalled();
			expect(fill).toHaveAttribute("d", expect.stringContaining("L 0 100"));
			expect(cancelTaskHoldHaptics).toHaveBeenCalled();

			await act(async () => {
				fireEvent.pointerDown(button, {
					pointerId: 2,
					pointerType: "touch",
					button: 0,
					clientX: 12,
					clientY: 12,
				});
				fireEvent.pointerMove(button, {
					pointerId: 2,
					pointerType: "touch",
					clientX: 50,
					clientY: 12,
				});
				fireEvent.pointerUp(button, {
					pointerId: 2,
					pointerType: "touch",
					button: 0,
					clientX: 50,
					clientY: 12,
				});
				fireEvent.click(button, { detail: 1 });
			});
			expect(engine.enqueue).not.toHaveBeenCalled();

			await act(async () => {
				fireEvent.pointerDown(button, {
					pointerId: 3,
					pointerType: "touch",
					button: 0,
					clientX: 12,
					clientY: 12,
				});
				vi.advanceTimersByTime(500);
				fireEvent.pointerCancel(button, {
					pointerId: 3,
					pointerType: "touch",
				});
			});
			expect(engine.enqueue).not.toHaveBeenCalled();
			expect(fill).toHaveAttribute("d", expect.stringContaining("L 0 100"));
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not complete a task by swiping its row", async () => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });

		const button = await screen.findByRole("button", {
			name: "Complete Brush teeth",
		});
		const row = button.closest("li");
		expect(row).not.toBeNull();
		fireEvent.touchStart(row as HTMLElement, {
			touches: [{ identifier: 1, clientX: 12, clientY: 12 }],
		});
		fireEvent.touchMove(row as HTMLElement, {
			touches: [{ identifier: 1, clientX: 100, clientY: 12 }],
		});
		fireEvent.touchEnd(row as HTMLElement, {
			changedTouches: [{ identifier: 1, clientX: 100, clientY: 12 }],
		});
		expect(engine.enqueue).not.toHaveBeenCalled();
	});

	it("requires a 5-second hold and fades haptics to uncomplete", async () => {
		await store.tasks.put(brushTeeth);
		await store.events.put({
			id: "e1",
			taskId: "t1",
			userId: "u1",
			type: "completed",
			occurrenceKey: iso(today),
			refEventId: null,
			at: Date.now(),
		});
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });

		const button = await screen.findByRole("button", {
			name: "Undo Brush teeth",
		});
		const fill = button.closest("li")?.querySelector("[data-hold-fill] path");
		vi.useFakeTimers();
		try {
			await act(async () => {
				fireEvent.pointerDown(button, {
					pointerId: 1,
					pointerType: "touch",
					button: 0,
					clientX: 12,
					clientY: 12,
				});
			});
			expect(fill).toHaveAttribute(
				"class",
				expect.stringContaining("fill-danger/15"),
			);
			expect(fill).toHaveStyle({ opacity: "0" });
			expect(engine.enqueue).not.toHaveBeenCalled();
			expect(startTaskHoldHapticRamp).toHaveBeenCalledWith("undo", 5000);

			await act(async () => {
				vi.advanceTimersByTime(150);
			});
			expect(fill).toHaveStyle({ opacity: "1" });
			expect(fill).toHaveAttribute("d", expect.stringContaining("L 0 0"));

			await act(async () => {
				vi.advanceTimersByTime(2350);
			});
			const drainingPath = fill?.getAttribute("d");
			expect(drainingPath).not.toContain("L 0 0");
			expect(drainingPath).not.toContain("L 0 100");
			expect(engine.enqueue).not.toHaveBeenCalled();

			await act(async () => {
				vi.advanceTimersByTime(2500);
			});
			expect(engine.enqueue).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "task.uncomplete",
					taskId: "t1",
					refEventId: "e1",
				}),
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("hides upcoming until asked and remembers the choice", async () => {
		await store.tasks.put(brushTeeth);
		await store.events.put({
			id: "e1",
			taskId: "t1",
			userId: "u1",
			type: "completed",
			occurrenceKey: iso(today),
			refEventId: null,
			at: Date.now(),
		});
		renderWithSession(<TodayScreen />, { store });

		expect(await screen.findByText("All done for today")).toBeInTheDocument();
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"100",
		);
		const toggle = screen.getByRole("button", { name: "Show upcoming (1)" });
		await userEvent.click(toggle);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Hide upcoming" }),
			).toBeInTheDocument(),
		);
		expect(localStorage.getItem("tagteam.showUpcoming")).toBe("true");
		expect(ME.groups[0]?.name).toBe("Smiths");
	});
});
