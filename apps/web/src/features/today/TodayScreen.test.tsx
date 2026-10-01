import type { MemberDto, SuggestionDto, TaskDto } from "@tagteam/core";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
	suggestedBy: null,
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

	it("completes with a pointer tap", async () => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		await userEvent.click(
			await screen.findByRole("button", { name: "Complete Brush teeth" }),
		);
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({ type: "task.complete" }),
		);
	});

	it("reports a failed completion without celebrating and allows retry", async () => {
		await store.tasks.put(brushTeeth);
		const engine = fakeEngine();
		engine.enqueue.mockRejectedValueOnce(new Error("disk full"));
		renderWithSession(<TodayScreen />, { store, engine });
		const button = await screen.findByRole("button", {
			name: "Complete Brush teeth",
		});
		await userEvent.click(button);
		expect(
			await screen.findByText("Could not change task. Try again."),
		).toBeInTheDocument();
		expect(fireScreenConfettiCannon).not.toHaveBeenCalled();
		await userEvent.click(button);
		expect(engine.enqueue).toHaveBeenCalledTimes(2);
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
			"bg-accent-soft",
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

const jo: MemberDto = {
	groupId: "g1",
	userId: "u2",
	displayName: "Jo",
	avatarColor: "green",
	role: "member",
	joinedAt: 0,
	leftAt: null,
};
const suggestion = (patch: Partial<SuggestionDto> = {}): SuggestionDto => ({
	id: "s1",
	groupId: "g1",
	fromUserId: "u2",
	toUserId: "u1",
	title: "Wash dishes",
	notes: null,
	startDate: iso(today),
	dueTime: null,
	rule: { freq: "day", interval: 1 },
	status: "pending",
	taskId: null,
	createdAt: 0,
	resolvedAt: null,
	...patch,
});
const daysFromNow = (days: number) =>
	iso(new Date(Date.now() + days * 86_400_000));

describe("TodayScreen suggestions", () => {
	it("shows a suggestion for me in an empty group without the add-first-task prompt", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		renderWithSession(<TodayScreen />, { store });
		expect(await screen.findByText("Jo suggests")).toBeInTheDocument();
		expect(screen.getByText("Wash dishes")).toBeInTheDocument();
		expect(screen.getByText("Daily")).toBeInTheDocument();
		expect(screen.queryByText("Add your first task")).not.toBeInTheDocument();
	});

	it("still invites adding a first task when only my own suggestions are waiting", async () => {
		await store.members.put(jo);
		await store.suggestions.put(
			suggestion({ fromUserId: "u1", toUserId: "u2" }),
		);
		renderWithSession(<TodayScreen />, { store });
		expect(await screen.findByText("Suggested by you")).toBeInTheDocument();
		expect(screen.getByText("Add your first task")).toBeInTheDocument();
	});

	it("brings the add-first-task prompt back once the last incoming card is answered", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		await screen.findByText("Jo suggests");
		expect(screen.queryByText("Add your first task")).not.toBeInTheDocument();
		await store.suggestions.update("s1", { status: "declined" });
		expect(await screen.findByText("Add your first task")).toBeInTheDocument();
	});

	it("puts the cards before the task list", async () => {
		await store.members.put(jo);
		await store.tasks.put(brushTeeth);
		await store.suggestions.put(suggestion());
		renderWithSession(<TodayScreen />, { store });
		const card = await screen.findByText("Jo suggests");
		const row = await screen.findByText("Brush teeth");
		expect(
			card.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("does not show other people's suggestions or answered ones as cards", async () => {
		await store.members.put(jo);
		await store.tasks.put(brushTeeth);
		await store.suggestions.bulkPut([
			suggestion({ id: "a", toUserId: "u3", title: "For Kim" }),
			suggestion({ id: "b", status: "declined", title: "Old one" }),
		]);
		renderWithSession(<TodayScreen />, { store });
		await screen.findByRole("button", { name: "Complete Brush teeth" });
		expect(screen.queryByText("For Kim")).not.toBeInTheDocument();
		expect(screen.queryByText("Old one")).not.toBeInTheDocument();
		expect(screen.queryByText(/suggests/)).not.toBeInTheDocument();
	});

	it.each([
		{
			name: "a past start moves to today",
			start: daysFromNow(-2),
			expected: iso(today),
		},
		{ name: "today stays today", start: iso(today), expected: iso(today) },
		{
			name: "a future start is kept",
			start: daysFromNow(3),
			expected: daysFromNow(3),
		},
	])(
		"accepts with the recipient's timezone and start date: $name",
		async ({ start, expected }) => {
			await store.members.put(jo);
			await store.suggestions.put(suggestion({ startDate: start }));
			const engine = fakeEngine();
			renderWithSession(<TodayScreen />, { store, engine });
			await userEvent.click(
				await screen.findByRole("button", { name: "Accept Wash dishes" }),
			);
			expect(engine.enqueue).toHaveBeenCalledTimes(1);
			expect(engine.enqueue).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "suggestion.accept",
					suggestionId: "s1",
					taskId: expect.any(String),
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					startDate: expected,
				}),
			);
		},
	);

	it("declines a suggestion", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		await userEvent.click(
			await screen.findByRole("button", { name: "Decline Wash dishes" }),
		);
		expect(engine.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "suggestion.decline",
				suggestionId: "s1",
			}),
		);
	});

	it("ignores a second tap while the first answer is still being written", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		const engine = fakeEngine();
		let finish: () => void = () => {};
		engine.enqueue.mockImplementationOnce(
			() => new Promise<void>((resolve) => (finish = resolve)),
		);
		renderWithSession(<TodayScreen />, { store, engine });
		const accept = await screen.findByRole("button", {
			name: "Accept Wash dishes",
		});
		await userEvent.click(accept);
		await userEvent.click(accept);
		await userEvent.click(
			screen.getByRole("button", { name: "Decline Wash dishes" }),
		);
		expect(engine.enqueue).toHaveBeenCalledTimes(1);
		finish();
		await screen.findByText("Added · Wash dishes");
	});

	it("reports a failed answer and allows another try", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		const engine = fakeEngine();
		engine.enqueue.mockRejectedValueOnce(new Error("disk full"));
		renderWithSession(<TodayScreen />, { store, engine });
		const accept = await screen.findByRole("button", {
			name: "Accept Wash dishes",
		});
		await userEvent.click(accept);
		expect(
			await screen.findByText("Could not update suggestion. Try again."),
		).toBeInTheDocument();
		await userEvent.click(accept);
		expect(engine.enqueue).toHaveBeenCalledTimes(2);
	});

	it("lists what I suggested: Withdraw while waiting, Clear once declined", async () => {
		await store.members.put(jo);
		const mine = { fromUserId: "u1", toUserId: "u2" };
		await store.suggestions.bulkPut([
			suggestion({ id: "s1", title: "Bins", status: "pending", ...mine }),
			suggestion({ id: "s2", title: "Plants", status: "declined", ...mine }),
			suggestion({ id: "s3", title: "Took it", status: "accepted", ...mine }),
			suggestion({ id: "s4", title: "Gone", status: "withdrawn", ...mine }),
		]);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		expect(await screen.findByText("Suggested by you")).toBeInTheDocument();
		expect(screen.getByText("Waiting for Jo")).toBeInTheDocument();
		expect(screen.getByText("Jo declined")).toBeInTheDocument();
		expect(screen.queryByText("Took it")).not.toBeInTheDocument();
		expect(screen.queryByText("Gone")).not.toBeInTheDocument();

		await userEvent.click(
			screen.getByRole("button", { name: "Withdraw Bins" }),
		);
		expect(engine.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: "suggestion.withdraw",
				suggestionId: "s1",
			}),
		);
		await userEvent.click(screen.getByRole("button", { name: "Clear Plants" }));
		expect(engine.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: "suggestion.withdraw",
				suggestionId: "s2",
			}),
		);
	});

	it("shows no 'Suggested by you' section when there is nothing to show", async () => {
		await store.members.put(jo);
		await store.tasks.put(brushTeeth);
		await store.suggestions.put(
			suggestion({ fromUserId: "u1", toUserId: "u2", status: "accepted" }),
		);
		renderWithSession(<TodayScreen />, { store });
		await screen.findByRole("button", { name: "Complete Brush teeth" });
		expect(screen.queryByText("Suggested by you")).not.toBeInTheDocument();
	});
});
