import { DEFAULT_EMOJI } from "@tagteam/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmojiEntry } from "./catalog";
import { EmojiPicker } from "./EmojiPicker";
import { type EmojiEngine, EmojiEngineProvider } from "./engine";

const DOG_FACE = "\u{1F436}";
const DOG = "\u{1F415}";
const BASKET = "\u{1F9FA}";
const PLANT = "\u{1FAB4}";

const fixture: EmojiEntry[] = [
	{
		e: DOG_FACE,
		n: "dog face",
		t: ["dog", "pet", "puppy"],
		g: "animals & nature",
	},
	{ e: DOG, n: "dog", t: ["pet"], g: "animals & nature" },
	{
		e: PLANT,
		n: "potted plant",
		t: ["grow", "house", "plant"],
		g: "animals & nature",
	},
	{ e: BASKET, n: "basket", t: ["farming", "laundry", "picnic"], g: "objects" },
];
const load = () => Promise.resolve(fixture);

function setup(
	props: Partial<Parameters<typeof EmojiPicker>[0]> = {},
	engine?: EmojiEngine,
) {
	const onPick = vi.fn();
	const onClose = vi.fn();
	const picker = (
		<EmojiPicker
			open
			onClose={onClose}
			onPick={onPick}
			value={null}
			title=""
			load={load}
			{...props}
		/>
	);
	const wrap = (children: ReactNode) =>
		engine ? (
			<EmojiEngineProvider value={engine}>{children}</EmojiEngineProvider>
		) : (
			children
		);
	render(wrap(picker));
	return { onPick, onClose };
}

const emojiButtons = () =>
	screen
		.getAllByRole("button")
		.map((button) => button.getAttribute("aria-label"))
		.filter((name): name is string => name !== null && name !== "Close");

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("EmojiPicker", () => {
	it("is a dialog called Choose emoji with every emoji grouped by category", async () => {
		setup();
		expect(
			screen.getByRole("dialog", { name: "Choose emoji" }),
		).toBeInTheDocument();
		expect(
			await screen.findByRole("heading", { name: "Animals & nature" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "Objects" }),
		).toBeInTheDocument();
		expect(emojiButtons()).toEqual([
			"dog face",
			"dog",
			"potted plant",
			"basket",
		]);
	});

	it("hands the chosen emoji over and closes", async () => {
		const { onPick, onClose } = setup();
		await userEvent.click(
			await screen.findByRole("button", { name: "potted plant" }),
		);
		expect(onPick).toHaveBeenCalledWith(PLANT);
		expect(onClose).toHaveBeenCalled();
	});

	it("shows which emoji is current", async () => {
		setup({ value: PLANT });
		expect(
			await screen.findByRole("button", { name: "potted plant" }),
		).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: "basket" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	it("searches names and keywords as you type", async () => {
		setup();
		const search = await screen.findByRole("searchbox", {
			name: "Search emoji",
		});
		await userEvent.type(search, "laundry");
		expect(emojiButtons()).toEqual(["basket"]);
		expect(
			screen.queryByRole("heading", { name: "Objects" }),
		).not.toBeInTheDocument();
		await userEvent.clear(search);
		await userEvent.type(search, "dog");
		expect(emojiButtons()).toEqual(["dog", "dog face"]);
		await userEvent.clear(search);
		await userEvent.type(search, "zzz");
		expect(screen.getByText('No emoji match "zzz".')).toBeInTheDocument();
		expect(emojiButtons()).toEqual([]);
	});

	it("accepts one emoji typed or pasted from the system keyboard", async () => {
		const { onPick, onClose } = setup();
		const field = await screen.findByLabelText("Type or paste an emoji");
		await userEvent.type(field, "\u{1F436}");
		expect(onPick).toHaveBeenCalledWith("\u{1F436}");
		expect(onClose).toHaveBeenCalled();
	});

	it("says so when what was typed is not exactly one emoji", async () => {
		const { onPick } = setup();
		const field = await screen.findByLabelText("Type or paste an emoji");
		await userEvent.type(field, "ab");
		expect(screen.getByText("Enter one emoji.")).toBeInTheDocument();
		await userEvent.clear(field);
		expect(screen.queryByText("Enter one emoji.")).not.toBeInTheDocument();
		await userEvent.click(field);
		await userEvent.paste("\u{1F436}\u{1F436}");
		expect(screen.getByText("Enter one emoji.")).toBeInTheDocument();
		expect(onPick).not.toHaveBeenCalled();
	});

	it("stores the default emoji on request", async () => {
		const { onPick, onClose } = setup();
		await userEvent.click(
			await screen.findByRole("button", { name: "Use default" }),
		);
		expect(onPick).toHaveBeenCalledWith(DEFAULT_EMOJI);
		expect(onClose).toHaveBeenCalled();
	});

	it("keeps only the keyboard field and Use default when the catalog cannot load", async () => {
		const { onPick } = setup({
			load: () => Promise.reject(new Error("offline")),
		});
		expect(
			await screen.findByLabelText("Type or paste an emoji"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Use default" }),
		).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.queryByText("Loading emoji")).not.toBeInTheDocument(),
		);
		expect(
			screen.getByText(
				"Could not load the emoji list. You can still type one below.",
			),
		).toBeInTheDocument();
		expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("heading", { name: "Objects" }),
		).not.toBeInTheDocument();
		await userEvent.type(
			screen.getByLabelText("Type or paste an emoji"),
			"\u{1F9FA}",
		);
		expect(onPick).toHaveBeenCalledWith(BASKET);
	});

	it("retries the catalog when the picker is opened again after a failed load", async () => {
		const loader = vi
			.fn<() => Promise<EmojiEntry[]>>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(fixture);
		const element = (open: boolean) => (
			<EmojiPicker
				open={open}
				onClose={vi.fn()}
				onPick={vi.fn()}
				value={null}
				title=""
				load={loader}
			/>
		);
		const view = render(element(true));
		expect(
			await screen.findByText(
				"Could not load the emoji list. You can still type one below.",
			),
		).toBeInTheDocument();
		view.rerender(element(false));
		view.rerender(element(true));
		expect(
			await screen.findByRole("heading", { name: "Objects" }),
		).toBeInTheDocument();
		expect(
			screen.queryByText(
				"Could not load the emoji list. You can still type one below.",
			),
		).not.toBeInTheDocument();
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it("does not render a group's emoji until it is near the viewport", async () => {
		class FakeObserver {
			static all: FakeObserver[] = [];
			target: Element | null = null;
			constructor(
				readonly callback: IntersectionObserverCallback,
				readonly options?: IntersectionObserverInit,
			) {
				FakeObserver.all.push(this);
			}
			observe(target: Element) {
				this.target = target;
			}
			unobserve() {}
			disconnect() {}
			takeRecords() {
				return [];
			}
			fire(isIntersecting: boolean) {
				this.callback(
					[
						{
							isIntersecting,
							target: this.target,
						} as IntersectionObserverEntry,
					],
					this as unknown as IntersectionObserver,
				);
			}
		}
		vi.stubGlobal("IntersectionObserver", FakeObserver);
		setup();
		await screen.findByRole("heading", { name: "Objects" });
		expect(
			screen.getByRole("heading", { name: "Animals & nature" }),
		).toBeInTheDocument();
		expect(emojiButtons()).toEqual([]);
		// The observers are created in a passive effect, which can land after the heading is found.
		await waitFor(() => expect(FakeObserver.all).toHaveLength(2));
		expect(FakeObserver.all[0]?.options?.rootMargin).toBe("600px 0px");

		act(() => FakeObserver.all[0]?.fire(true));
		expect(emojiButtons()).toEqual(["dog face", "dog", "potted plant"]);
		act(() => FakeObserver.all[1]?.fire(true));
		expect(emojiButtons()).toEqual([
			"dog face",
			"dog",
			"potted plant",
			"basket",
		]);
	});

	describe("with an emoji engine", () => {
		const engine = (patch: Partial<EmojiEngine> = {}): EmojiEngine => ({
			status: "ready",
			suggest: async () => [BASKET, "\u{1F9FC}", PLANT, DOG],
			search: async () => [],
			...patch,
		});

		it("shows no Suggested row while the engine is not ready", async () => {
			for (const status of ["unavailable", "loading", "off"] as const) {
				const view = render(
					<EmojiEngineProvider value={engine({ status })}>
						<EmojiPicker
							open
							onClose={vi.fn()}
							onPick={vi.fn()}
							value={null}
							title="Wash the laundry"
							load={load}
						/>
					</EmojiEngineProvider>,
				);
				await screen.findByRole("heading", { name: "Objects" });
				expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
				view.unmount();
			}
		});

		it("shows up to three suggestions for the title once the engine is ready", async () => {
			const { onPick } = setup({ title: "Wash the laundry" }, engine());
			const row = await screen.findByRole("region", { name: "Suggested" });
			expect(
				Array.from(row.querySelectorAll("button")).map((b) =>
					b.getAttribute("aria-label"),
				),
			).toEqual(["basket", "\u{1F9FC}", "potted plant"]);
			await userEvent.click(row.querySelector("button") as HTMLElement);
			expect(onPick).toHaveBeenCalledWith(BASKET);
		});

		it("asks for no suggestions for a title shorter than three characters", async () => {
			const suggest = vi.fn(async () => [BASKET]);
			setup({ title: "Ab" }, engine({ suggest }));
			await screen.findByRole("heading", { name: "Objects" });
			expect(suggest).not.toHaveBeenCalled();
			expect(
				screen.queryByRole("region", { name: "Suggested" }),
			).not.toBeInTheDocument();
		});

		it("appends meaning-based matches after the keyword matches, without repeating any", async () => {
			setup({}, engine({ search: async () => [DOG, BASKET] }));
			const search = await screen.findByRole("searchbox", {
				name: "Search emoji",
			});
			await userEvent.type(search, "dog");
			await waitFor(() =>
				expect(emojiButtons()).toEqual(["dog", "dog face", "basket"]),
			);
		});

		describe("with a slow engine", () => {
			const deferred = <T,>() => {
				let resolve!: (value: T) => void;
				const promise = new Promise<T>((r) => {
					resolve = r;
				});
				return { promise, resolve };
			};
			const slowEngine = () => {
				const searches = new Map<
					string,
					ReturnType<typeof deferred<string[]>>
				>();
				const suggests = new Map<
					string,
					ReturnType<typeof deferred<string[]>>
				>();
				const engine: EmojiEngine = {
					status: "ready",
					suggest: (title) => {
						const d = deferred<string[]>();
						suggests.set(title, d);
						return d.promise;
					},
					search: (text) => {
						const d = deferred<string[]>();
						searches.set(text, d);
						return d.promise;
					},
				};
				return { engine, searches, suggests };
			};

			it("never shows meaning matches of a previous query", async () => {
				const { engine, searches } = slowEngine();
				setup({}, engine);
				const search = await screen.findByRole("searchbox", {
					name: "Search emoji",
				});
				await userEvent.type(search, "pe");
				await waitFor(() => expect(searches.has("pe")).toBe(true));
				await act(async () => searches.get("pe")?.resolve([BASKET]));
				expect(emojiButtons()).toEqual(["dog face", "dog", "basket"]);
				await userEvent.type(search, "t");
				expect(emojiButtons()).toEqual(["dog face", "dog"]);
				expect(searches.has("pet")).toBe(true);
			});

			it("shows only the latest query's matches when an earlier search resolves late", async () => {
				const { engine, searches } = slowEngine();
				setup({}, engine);
				const search = await screen.findByRole("searchbox", {
					name: "Search emoji",
				});
				await userEvent.type(search, "pe");
				await waitFor(() => expect(searches.has("pe")).toBe(true));
				await userEvent.type(search, "t");
				await waitFor(() => expect(searches.has("pet")).toBe(true));
				await act(async () => searches.get("pet")?.resolve([PLANT]));
				expect(emojiButtons()).toEqual(["dog face", "dog", "potted plant"]);
				await act(async () => searches.get("pe")?.resolve([BASKET]));
				expect(emojiButtons()).toEqual(["dog face", "dog", "potted plant"]);
			});

			it("never shows suggestions of a previous title", async () => {
				const { engine, suggests } = slowEngine();
				const props = {
					open: true,
					onClose: vi.fn(),
					onPick: vi.fn(),
					value: null,
					load,
				};
				const view = render(
					<EmojiEngineProvider value={engine}>
						<EmojiPicker {...props} title="Wash the laundry" />
					</EmojiEngineProvider>,
				);
				await waitFor(() =>
					expect(suggests.has("Wash the laundry")).toBe(true),
				);
				await act(async () =>
					suggests.get("Wash the laundry")?.resolve([BASKET]),
				);
				expect(
					await screen.findByRole("region", { name: "Suggested" }),
				).toBeInTheDocument();
				view.rerender(
					<EmojiEngineProvider value={engine}>
						<EmojiPicker {...props} title="Water the plants" />
					</EmojiEngineProvider>,
				);
				await waitFor(() =>
					expect(suggests.has("Water the plants")).toBe(true),
				);
				expect(
					screen.queryByRole("region", { name: "Suggested" }),
				).not.toBeInTheDocument();
				await act(async () =>
					suggests.get("Water the plants")?.resolve([PLANT]),
				);
				const row = await screen.findByRole("region", { name: "Suggested" });
				expect(row.querySelectorAll("button")).toHaveLength(1);
				expect(row.querySelector("button")).toHaveAttribute(
					"aria-label",
					"potted plant",
				);
			});

			it("waits for a ready engine before saying nothing matches", async () => {
				const { engine, searches } = slowEngine();
				setup({}, engine);
				const search = await screen.findByRole("searchbox", {
					name: "Search emoji",
				});
				await userEvent.type(search, "zzz");
				await waitFor(() => expect(searches.has("zzz")).toBe(true));
				expect(
					screen.queryByText('No emoji match "zzz".'),
				).not.toBeInTheDocument();
				await act(async () => searches.get("zzz")?.resolve([]));
				expect(screen.getByText('No emoji match "zzz".')).toBeInTheDocument();
			});
		});
	});
});
