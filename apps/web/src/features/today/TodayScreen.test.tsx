import type { TaskDto } from "@tagteam/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagTeamDb } from "../../store/db";
import { fakeEngine, ME, renderWithSession } from "../../test/fakes";
import { fireScreenConfettiCannon } from "../../ui/confetti";
import { TodayScreen } from "./TodayScreen";

vi.mock("../../ui/confetti", () => ({
	fireScreenConfettiCannon: vi.fn(),
}));

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

		fireEvent.click(
			await screen.findByRole("button", { name: "Complete Brush teeth" }),
			{ detail: 0 },
		);
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "task.complete",
				taskId: "t1",
				occurrenceKey: iso(today),
			}),
		);
		const completionId = engine.enqueue.mock.calls[0]?.[0].id;
		await waitFor(() =>
			expect(fireScreenConfettiCannon).toHaveBeenCalledTimes(1),
		);

		await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
		expect(engine.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: "task.uncomplete",
				taskId: "t1",
				refEventId: completionId,
			}),
		);
		expect(fireScreenConfettiCannon).toHaveBeenCalledTimes(1);
	});

	it("fires the screen cannon for a routine task completion", async () => {
		await store.tasks.bulkPut([
			brushTeeth,
			{ ...brushTeeth, id: "t2", title: "Water plants" },
		]);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });

		fireEvent.click(
			await screen.findByRole("button", { name: "Complete Brush teeth" }),
			{ detail: 0 },
		);
		await waitFor(() => expect(engine.enqueue).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(fireScreenConfettiCannon).toHaveBeenCalledTimes(1),
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Complete Water plants" }),
			{ detail: 0 },
		);
		await waitFor(() => expect(engine.enqueue).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(fireScreenConfettiCannon).toHaveBeenCalledTimes(2),
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

	it.each(["touch", "mouse"])(
		"completes on right swipe release with %s",
		async (pointerType) => {
			await store.tasks.put(brushTeeth);
			const engine = fakeEngine();
			renderWithSession(<TodayScreen />, { store, engine });
			const button = await screen.findByRole("button", {
				name: "Complete Brush teeth",
			});
			const row = button.closest("li") as HTMLElement;
			const pointer = {
				pointerId: 1,
				isPrimary: true,
				pointerType,
				button: 0,
				clientY: 20,
			};
			fireEvent.pointerDown(button, { ...pointer, clientX: 20 });
			fireEvent.pointerMove(row, { ...pointer, clientX: 70 });
			expect(row.querySelector("[data-swipe-content]")).toHaveStyle({
				transform: "translateX(50px)",
			});
			expect(row.querySelector("[data-swipe-action]")).toHaveAttribute(
				"data-ready",
				"false",
			);
			// Touch browsers release the child's implicit capture when the row captures.
			fireEvent.lostPointerCapture(button, pointer);
			fireEvent.pointerMove(row, { ...pointer, clientX: 120 });
			expect(row.querySelector("[data-swipe-action]")).toHaveAttribute(
				"data-ready",
				"true",
			);
			expect(engine.enqueue).not.toHaveBeenCalled();
			fireEvent.pointerUp(row, { ...pointer, clientX: 120 });
			fireEvent.click(button, { detail: 1 });
			await waitFor(() => expect(engine.enqueue).toHaveBeenCalledTimes(1));
			expect(engine.enqueue).toHaveBeenCalledWith(
				expect.objectContaining({ type: "task.complete", taskId: "t1" }),
			);
		},
	);

	it.each([
		["short swipe", 50, 0, "pointerUp"],
		["left swipe", -100, 0, "pointerUp"],
		["vertical scroll", 20, 100, "pointerUp"],
		["cancelled swipe", 100, 0, "pointerCancel"],
		["lost capture", 100, 0, "lostPointerCapture"],
	] as const)("does not toggle after %s", async (_name, dx, dy, endEvent) => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		const button = await screen.findByRole("button", {
			name: "Complete Brush teeth",
		});
		const row = button.closest("li") as HTMLElement;
		const pointer = {
			pointerId: 1,
			isPrimary: true,
			pointerType: "touch",
			button: 0,
		};
		fireEvent.pointerDown(row, { ...pointer, clientX: 120, clientY: 20 });
		fireEvent.pointerMove(row, {
			...pointer,
			clientX: 120 + dx,
			clientY: 20 + dy,
		});
		fireEvent[endEvent](row, {
			...pointer,
			clientX: 120 + dx,
			clientY: 20 + dy,
		});
		fireEvent.click(button, { detail: 1 });
		expect(engine.enqueue).not.toHaveBeenCalled();
		expect(row.querySelector("[data-swipe-content]")).toHaveStyle({
			transform: "translateX(0px)",
		});
	});

	it("cancels when dragged back before release and ignores other pointers", async () => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		const row = (
			await screen.findByRole("button", { name: "Complete Brush teeth" })
		).closest("li") as HTMLElement;
		const pointer = {
			pointerId: 1,
			isPrimary: true,
			pointerType: "touch",
			button: 0,
			clientY: 20,
		};
		fireEvent.pointerDown(row, { ...pointer, clientX: 20 });
		fireEvent.pointerMove(row, { ...pointer, clientX: 140 });
		fireEvent.pointerUp(row, { ...pointer, pointerId: 2, clientX: 140 });
		fireEvent.pointerCancel(row, { ...pointer, pointerId: 2 });
		expect(engine.enqueue).not.toHaveBeenCalled();
		expect(row.querySelector("[data-swipe-action]")).toHaveAttribute(
			"data-ready",
			"true",
		);
		fireEvent.pointerMove(row, { ...pointer, clientX: 50 });
		fireEvent.pointerUp(row, { ...pointer, clientX: 50 });
		expect(engine.enqueue).not.toHaveBeenCalled();
	});

	it("does not toggle on a tap or long hold", async () => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		const button = await screen.findByRole("button", {
			name: "Complete Brush teeth",
		});
		await userEvent.click(button);
		vi.useFakeTimers();
		try {
			const pointer = {
				pointerId: 1,
				isPrimary: true,
				pointerType: "touch",
				button: 0,
				clientX: 20,
				clientY: 20,
			};
			fireEvent.pointerDown(button, pointer);
			await act(async () => vi.advanceTimersByTime(3000));
			fireEvent.pointerUp(button, pointer);
			fireEvent.click(button, { detail: 1 });
			expect(engine.enqueue).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("allows keyboard completion with Space", async () => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		const button = await screen.findByRole("button", {
			name: "Complete Brush teeth",
		});
		button.focus();
		await userEvent.keyboard(" ");
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({ type: "task.complete" }),
		);
	});

	it("swipes right from the title to undo without opening task details", async () => {
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
		const row = button.closest("li") as HTMLElement;
		const link = row.querySelector("a") as HTMLElement;
		const pointer = {
			pointerId: 1,
			isPrimary: true,
			pointerType: "touch",
			button: 0,
			clientY: 20,
		};
		fireEvent.pointerDown(link, { ...pointer, clientX: 60 });
		fireEvent.pointerMove(link, { ...pointer, clientX: 160 });
		expect(row.querySelector("[data-swipe-action]")).toHaveClass(
			"bg-danger-soft",
		);
		fireEvent.pointerUp(link, { ...pointer, clientX: 160 });
		expect(fireEvent.click(link, { detail: 1 })).toBe(false);
		await waitFor(() => expect(engine.enqueue).toHaveBeenCalledTimes(1));
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "task.uncomplete",
				taskId: "t1",
				refEventId: "e1",
			}),
		);
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
