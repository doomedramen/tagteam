import type { MemberDto, SuggestionDto, TaskDto } from "@tagteam/core";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
	emoji: null,
	color: null,
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

	it("paints the date, progress and hint in the app-colour page header", async () => {
		await store.tasks.put(brushTeeth);
		renderWithSession(<TodayScreen />, { store });
		const heading = await screen.findByRole("heading", { level: 1 });
		const header = heading.closest('[data-slot="page-header"]');
		expect(header).toHaveClass("bg-header", "rounded-none");
		expect(within(header as HTMLElement).getByText(/done today/)).toBeTruthy();
		expect(
			within(header as HTMLElement).getByRole("progressbar", {
				name: "Done today",
			}),
		).toBeTruthy();
		expect(
			within(header as HTMLElement).getByText(/Tap a circle to complete/),
		).toBeTruthy();
	});

	it("shows each task as its own rounded tile with a gap and no divider or card", async () => {
		await store.tasks.bulkPut([
			brushTeeth,
			{ ...brushTeeth, id: "t2", title: "Floss" },
		]);
		renderWithSession(<TodayScreen />, { store });
		await screen.findByRole("button", { name: "Complete Brush teeth" });
		const contents = Array.from(
			document.querySelectorAll<HTMLElement>("[data-swipe-content]"),
		);
		expect(contents).toHaveLength(2);
		const [first, second] = contents.map((content) => content.parentElement);
		expect(first).toHaveClass("rounded-[22px]", "overflow-hidden");
		expect(second).toHaveClass("rounded-[22px]", "overflow-hidden");
		expect(first?.nextElementSibling).toBe(second);
		expect(first?.parentElement).toHaveClass("gap-2.5");
		expect(first?.closest('[data-slot="card"]')).toBeNull();
		for (const content of contents) {
			expect(content.className).not.toMatch(/\bborder/);
		}
	});

	it("fills a coloured tile with its sheet (card in dark mode) and a colourless one with the neutral card", async () => {
		await store.tasks.bulkPut([
			{ ...brushTeeth, color: "teal", title: "Water plants" },
			{ ...brushTeeth, id: "t2", title: "Floss" },
		]);
		renderWithSession(<TodayScreen />, { store });
		await screen.findByRole("button", { name: "Complete Water plants" });
		const tileOf = (name: string) => {
			const tile = screen
				.getByRole("button", { name })
				.closest<HTMLElement>("li");
			if (!tile) throw new Error("tile not found");
			return tile;
		};
		const teal = tileOf("Complete Water plants");
		expect(teal).toHaveAttribute("data-task-color", "teal");
		expect(teal.querySelector("[data-swipe-content]")).toHaveClass(
			"bg-task-sheet",
			"dark:bg-task-card",
		);
		const plain = tileOf("Complete Floss");
		expect(plain).not.toHaveAttribute("data-task-color");
		const plainContent = plain.querySelector("[data-swipe-content]");
		expect(plainContent).toHaveClass("bg-card");
		expect(plainContent).not.toHaveClass("bg-task-sheet");
	});

	it("keeps the swipe reveal inside the tile and the padding on the moving content", async () => {
		await store.tasks.put(brushTeeth);
		renderWithSession(<TodayScreen />, { store });
		await screen.findByRole("button", { name: "Complete Brush teeth" });
		const content = document.querySelector("[data-swipe-content]");
		const tile = content?.parentElement;
		expect(tile).toHaveClass("relative", "overflow-hidden", "rounded-[22px]");
		expect(tile?.querySelector("[data-swipe-action]")).not.toBeNull();
		expect(content).toHaveClass("px-4");
	});

	it("sets task titles in semibold and the meta line in medium weight", async () => {
		await store.tasks.put(brushTeeth);
		renderWithSession(<TodayScreen />, { store });
		const title = await screen.findByText("Brush teeth");
		expect(title).toHaveClass("font-semibold");
		const meta = title.nextElementSibling;
		expect(meta).toBeTruthy();
		expect(meta).toHaveClass("font-medium");
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
	emoji: null,
	color: null,
	...patch,
});
const daysFromNow = (days: number) =>
	iso(new Date(Date.now() + days * 86_400_000));

describe("TodayScreen suggestions", () => {
	const mine = { fromUserId: "u1", toUserId: "u2" };
	const openSheet = async (name: RegExp) => {
		await userEvent.click(await screen.findByRole("button", { name }));
		return screen.findByRole("dialog", { name: "Suggestions" });
	};

	it("shows no strip without suggestions", async () => {
		await store.tasks.put(brushTeeth);
		renderWithSession(<TodayScreen />, { store });
		await screen.findByRole("button", { name: "Complete Brush teeth" });
		expect(screen.queryByText(/for you$/)).not.toBeInTheDocument();
		expect(screen.queryByText("Sent by you")).not.toBeInTheDocument();
	});

	it("summarises an incoming suggestion in a strip and keeps the card off Today", async () => {
		await store.members.put(jo);
		await store.tasks.put(brushTeeth);
		await store.suggestions.put(suggestion());
		renderWithSession(<TodayScreen />, { store });
		const strip = await screen.findByRole("button", {
			name: /1 suggestion for you/,
		});
		expect(strip).toBeInTheDocument();
		expect(screen.queryByText("Jo suggests")).not.toBeInTheDocument();
		expect(screen.queryByText("Wash dishes")).not.toBeInTheDocument();
		// The strip sits above the task sections.
		expect(
			strip.compareDocumentPosition(screen.getByText("Brush teeth")) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("opens the card in a sheet from the strip", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		renderWithSession(<TodayScreen />, { store });
		const sheet = await openSheet(/1 suggestion for you/);
		expect(within(sheet).getByText("Jo suggests")).toBeInTheDocument();
		expect(within(sheet).getByText("Wash dishes")).toBeInTheDocument();
		expect(within(sheet).getByText("Daily")).toBeInTheDocument();
		expect(
			within(sheet).getByRole("heading", { name: "For you" }),
		).toBeInTheDocument();
		expect(
			within(sheet).queryByRole("heading", { name: "Sent by you" }),
		).not.toBeInTheDocument();
	});

	it("shows the strip and the add-first-task prompt together when there are no tasks", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		renderWithSession(<TodayScreen />, { store });
		expect(
			await screen.findByRole("button", { name: /1 suggestion for you/ }),
		).toBeInTheDocument();
		expect(screen.getByText("Add your first task")).toBeInTheDocument();
	});

	it("does not count other people's suggestions or answered ones", async () => {
		await store.members.put(jo);
		await store.tasks.put(brushTeeth);
		await store.suggestions.bulkPut([
			suggestion({ id: "a", toUserId: "u3", title: "For Kim" }),
			suggestion({ id: "b", status: "declined", title: "Old one" }),
			suggestion({ id: "c", groupId: "g2", title: "Elsewhere" }),
			suggestion({ id: "d", ...mine, status: "accepted" }),
			suggestion({ id: "e", ...mine, status: "withdrawn" }),
			suggestion({ id: "f", ...mine, groupId: "g2" }),
		]);
		renderWithSession(<TodayScreen />, { store });
		await screen.findByRole("button", { name: "Complete Brush teeth" });
		expect(screen.queryByText(/for you$/)).not.toBeInTheDocument();
		expect(screen.queryByText("Sent by you")).not.toBeInTheDocument();
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
		"accepts from the sheet with the recipient's timezone and start date: $name",
		async ({ start, expected }) => {
			await store.members.put(jo);
			await store.suggestions.put(suggestion({ startDate: start }));
			const engine = fakeEngine();
			renderWithSession(<TodayScreen />, { store, engine });
			const sheet = await openSheet(/1 suggestion for you/);
			await userEvent.click(
				within(sheet).getByRole("button", { name: "Accept Wash dishes" }),
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

	it("confirms an accept and closes the sheet once nothing is left", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		renderWithSession(<TodayScreen />, { store, engine: fakeEngine() });
		const sheet = await openSheet(/1 suggestion for you/);
		await userEvent.click(
			within(sheet).getByRole("button", { name: "Accept Wash dishes" }),
		);
		expect(await screen.findByText("Added · Wash dishes")).toBeInTheDocument();
		// The fake engine writes nothing, so answer it the way the sync engine would.
		await store.suggestions.update("s1", { status: "accepted" });
		await waitFor(() =>
			expect(
				screen.queryByRole("dialog", { name: "Suggestions" }),
			).not.toBeInTheDocument(),
		);
		expect(screen.queryByText(/for you$/)).not.toBeInTheDocument();
	});

	it("keeps the answer toast exposed to assistive technology while the sheet is open", async () => {
		await store.members.put(jo);
		await store.suggestions.bulkPut([
			suggestion(),
			suggestion({ id: "s2", title: "Bins", ...mine }),
		]);
		renderWithSession(<TodayScreen />, { store, engine: fakeEngine() });
		const sheet = await openSheet(/1 suggestion for you/);
		await userEvent.click(
			within(sheet).getByRole("button", { name: "Accept Wash dishes" }),
		);
		const toastText = await screen.findByText("Added · Wash dishes");
		expect(screen.getByRole("dialog", { name: "Suggestions" })).toBeVisible();
		expect(toastText.closest('[aria-hidden="true"], [inert]')).toBeNull();
	});

	it("keeps showing the answered cards, inert, while the sheet slides out", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		const sheet = await openSheet(/1 suggestion for you/);
		await userEvent.click(
			within(sheet).getByRole("button", { name: "Accept Wash dishes" }),
		);
		// Hold the exit animation open so the closing sheet can be inspected.
		const original = Object.getOwnPropertyDescriptor(
			Element.prototype,
			"getAnimations",
		);
		Element.prototype.getAnimations = () =>
			[{ finished: new Promise(() => {}) }] as unknown as Animation[];
		try {
			await store.suggestions.update("s1", { status: "accepted" });
			await waitFor(() =>
				expect(screen.queryByText(/for you$/)).not.toBeInTheDocument(),
			);
			const closing = screen.getByRole("dialog", { name: "Suggestions" });
			expect(within(closing).getByText("Wash dishes")).toBeInTheDocument();
			const accept = within(closing).getByRole("button", {
				name: "Accept Wash dishes",
			});
			expect(accept.closest("[inert]")).not.toBeNull();
			expect(
				within(closing)
					.getByRole("button", { name: "Decline Wash dishes" })
					.closest("[inert]"),
			).not.toBeNull();
			expect(engine.enqueue).toHaveBeenCalledTimes(1);
		} finally {
			if (original)
				Object.defineProperty(Element.prototype, "getAnimations", original);
			else
				delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
		}
	});

	it("moves focus to the next card after one is answered", async () => {
		await store.members.put(jo);
		await store.suggestions.bulkPut([
			suggestion({ id: "s1", title: "Wash dishes", createdAt: 1 }),
			suggestion({ id: "s2", title: "Water plants", createdAt: 2 }),
		]);
		renderWithSession(<TodayScreen />, { store, engine: fakeEngine() });
		const sheet = await openSheet(/2 suggestions for you/);
		await userEvent.click(
			within(sheet).getByRole("button", { name: "Accept Wash dishes" }),
		);
		await store.suggestions.update("s1", { status: "accepted" });
		await waitFor(() =>
			expect(
				within(sheet).getByRole("button", { name: "Decline Water plants" }),
			).toHaveFocus(),
		);
	});

	it("moves focus to the previous row when the last row is answered", async () => {
		await store.members.put(jo);
		await store.suggestions.bulkPut([
			suggestion({ id: "s1", title: "Wash dishes" }),
			suggestion({ id: "s2", title: "Bins", ...mine }),
		]);
		renderWithSession(<TodayScreen />, { store, engine: fakeEngine() });
		const sheet = await openSheet(/1 suggestion for you/);
		await userEvent.click(
			within(sheet).getByRole("button", { name: "Withdraw Bins" }),
		);
		await store.suggestions.update("s2", { status: "withdrawn" });
		await waitFor(() =>
			expect(
				within(sheet).getByRole("button", { name: "Decline Wash dishes" }),
			).toHaveFocus(),
		);
	});

	it("declines a suggestion from the sheet", async () => {
		await store.members.put(jo);
		await store.suggestions.put(suggestion());
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		const sheet = await openSheet(/1 suggestion for you/);
		await userEvent.click(
			within(sheet).getByRole("button", { name: "Decline Wash dishes" }),
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
		const sheet = await openSheet(/1 suggestion for you/);
		const accept = within(sheet).getByRole("button", {
			name: "Accept Wash dishes",
		});
		await userEvent.click(accept);
		await userEvent.click(accept);
		await userEvent.click(
			within(sheet).getByRole("button", { name: "Decline Wash dishes" }),
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
		const sheet = await openSheet(/1 suggestion for you/);
		const accept = within(sheet).getByRole("button", {
			name: "Accept Wash dishes",
		});
		await userEvent.click(accept);
		expect(
			await screen.findByText("Could not update suggestion. Try again."),
		).toBeInTheDocument();
		await userEvent.click(accept);
		expect(engine.enqueue).toHaveBeenCalledTimes(2);
	});

	it("summarises what I sent, then lists it: Withdraw while waiting, Clear once declined", async () => {
		await store.members.put(jo);
		await store.suggestions.bulkPut([
			suggestion({ id: "s1", title: "Bins", status: "pending", ...mine }),
			suggestion({ id: "s2", title: "Plants", status: "declined", ...mine }),
			suggestion({ id: "s3", title: "Took it", status: "accepted", ...mine }),
			suggestion({ id: "s4", title: "Gone", status: "withdrawn", ...mine }),
		]);
		const engine = fakeEngine();
		renderWithSession(<TodayScreen />, { store, engine });
		const strip = await screen.findByRole("button", {
			name: /Sent by you.*1 waiting, 1 declined/,
		});
		expect(strip).toHaveTextContent("1 waiting, 1 declined");
		expect(screen.queryByText("Waiting for Jo")).not.toBeInTheDocument();

		const sheet = await openSheet(/Sent by you/);
		expect(
			within(sheet).getByRole("heading", { name: "Sent by you" }),
		).toBeInTheDocument();
		expect(
			within(sheet).queryByRole("heading", { name: "For you" }),
		).not.toBeInTheDocument();
		expect(within(sheet).getByText("Waiting for Jo")).toBeInTheDocument();
		expect(within(sheet).getByText("Jo declined")).toBeInTheDocument();
		expect(within(sheet).queryByText("Took it")).not.toBeInTheDocument();
		expect(within(sheet).queryByText("Gone")).not.toBeInTheDocument();

		await userEvent.click(
			within(sheet).getByRole("button", { name: "Withdraw Bins" }),
		);
		expect(engine.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: "suggestion.withdraw",
				suggestionId: "s1",
			}),
		);
		await userEvent.click(
			within(sheet).getByRole("button", { name: "Clear Plants" }),
		);
		expect(engine.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: "suggestion.withdraw",
				suggestionId: "s2",
			}),
		);
	});

	it("shows both sections and the combined strip when I have incoming and outgoing", async () => {
		await store.members.put(jo);
		await store.suggestions.bulkPut([
			suggestion(),
			suggestion({ id: "s2", title: "Bins", ...mine }),
		]);
		renderWithSession(<TodayScreen />, { store });
		const strip = await screen.findByRole("button", {
			name: /1 suggestion for you/,
		});
		expect(strip).toHaveTextContent("Sent by you: 1 waiting");
		const sheet = await openSheet(/1 suggestion for you/);
		expect(
			within(sheet).getByRole("heading", { name: "For you" }),
		).toBeInTheDocument();
		expect(
			within(sheet).getByRole("heading", { name: "Sent by you" }),
		).toBeInTheDocument();
		// Sections are named by their visible heading, not a duplicate label.
		for (const name of ["For you", "Sent by you"]) {
			const region = within(sheet).getByRole("region", { name });
			expect(region).not.toHaveAttribute("aria-label");
			expect(region).toHaveAttribute("aria-labelledby");
		}
	});
});

describe("TodayScreen look", () => {
	it("shows the bare emoji first and the completion button last, the default emoji when none is stored", async () => {
		await store.tasks.bulkPut([
			{
				...brushTeeth,
				emoji: "\u{1FAB4}",
				color: "teal",
				title: "Water plants",
			},
			{ ...brushTeeth, id: "t2", title: "Floss" },
		]);
		renderWithSession(<TodayScreen />, { store });
		await screen.findByRole("button", { name: "Complete Water plants" });
		const emojis = Array.from(
			document.querySelectorAll<HTMLElement>('[data-slot="task-emoji"]'),
		);
		expect(emojis.map((emoji) => emoji.textContent).sort()).toEqual(
			["\u{1F4CB}", "\u{1FAB4}"].sort(),
		);
		for (const emoji of emojis) {
			expect(emoji).toHaveAttribute("aria-hidden", "true");
			expect(emoji).not.toHaveAttribute("data-task-color");
			expect(emoji).not.toHaveClass("rounded-full");
			expect(emoji.className).not.toMatch(/\b(bg-|border)/);
			expect(emoji.closest("button, a")).toBeNull();
		}
		const plants = emojis.find((e) => e.textContent === "\u{1FAB4}");
		const content = plants?.closest("[data-swipe-content]") as HTMLElement;
		const kids = Array.from(content.children);
		const link = within(content).getByRole("link", { name: /Water plants/ });
		const complete = within(content).getByRole("button", {
			name: "Complete Water plants",
		});
		expect(kids.indexOf(plants as HTMLElement)).toBe(0);
		expect(kids.indexOf(link)).toBe(1);
		expect(kids.indexOf(complete)).toBe(kids.length - 1);
	});

	it("puts the repeat icon between the title and the completion button", async () => {
		await store.tasks.put(brushTeeth);
		renderWithSession(<TodayScreen />, { store });
		await screen.findByRole("button", { name: "Complete Brush teeth" });
		const content = document.querySelector(
			"[data-swipe-content]",
		) as HTMLElement;
		const kids = Array.from(content.children);
		const repeats = within(content).getByRole("img", { name: "Repeats" });
		expect(kids.indexOf(repeats as unknown as Element)).toBe(kids.length - 2);
	});
});
