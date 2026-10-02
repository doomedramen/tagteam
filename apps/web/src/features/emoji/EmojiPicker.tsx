import { DEFAULT_EMOJI, isEmoji } from "@tagteam/core";
import {
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { Input } from "@/components/ui/input";
import { cx } from "../../lib/cx";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import {
	type EmojiEntry,
	emojiKey,
	groupEntries,
	groupLabel,
	loadCatalog,
	searchEmoji,
} from "./catalog";
import { useEmojiEngine } from "./engine";

const COLUMNS = 7;
const CELL_PX = 44;
const MAX_SUGGESTED = 3;
const MIN_TITLE_FOR_SUGGESTIONS = 3;
const MIN_QUERY_FOR_MEANING = 2;
const NEAR_MARGIN = "600px 0px";

function EmojiButton({
	emoji,
	name,
	selected,
	onPick,
}: {
	emoji: string;
	name: string;
	selected: boolean;
	onPick: (emoji: string) => void;
}) {
	return (
		<button
			type="button"
			aria-label={name}
			aria-pressed={selected}
			onClick={() => onPick(emoji)}
			className={cx(
				"flex size-11 items-center justify-center rounded-full text-[26px] leading-none active:bg-surface-2",
				selected && "bg-accent-soft ring-2 ring-accent",
			)}
		>
			{emoji}
		</button>
	);
}

/** A category. Until it is near the viewport it renders only its heading and a spacer of the right height. */
function LazyGroup({
	name,
	entries,
	isSelected,
	onPick,
}: {
	name: string;
	entries: EmojiEntry[];
	isSelected: (emoji: string) => boolean;
	onPick: (emoji: string) => void;
}) {
	const headingId = useId();
	const ref = useRef<HTMLElement>(null);
	const [near, setNear] = useState(
		() => typeof IntersectionObserver === "undefined",
	);
	useEffect(() => {
		if (near) return;
		const node = ref.current;
		if (!node) return;
		const observer = new IntersectionObserver(
			(records) => {
				if (records.some((record) => record.isIntersecting)) {
					setNear(true);
					observer.disconnect();
				}
			},
			// The scrolling element is the sheet body, so it must be the observer's root for the margin to count.
			{
				root: node.closest<HTMLElement>('[data-slot="sheet-body"]'),
				rootMargin: NEAR_MARGIN,
			},
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [near]);
	return (
		<section
			ref={ref}
			aria-labelledby={headingId}
			style={
				near
					? undefined
					: { minHeight: 28 + Math.ceil(entries.length / COLUMNS) * CELL_PX }
			}
		>
			<h3 id={headingId} className="mb-1 text-[13px] font-medium text-text-2">
				{groupLabel(name)}
			</h3>
			{near ? (
				<div className="grid grid-cols-7 justify-items-center">
					{entries.map((entry) => (
						<EmojiButton
							key={entry.e}
							emoji={entry.e}
							name={entry.n}
							selected={isSelected(entry.e)}
							onPick={onPick}
						/>
					))}
				</div>
			) : null}
		</section>
	);
}

export function EmojiPicker({
	open,
	onClose,
	value,
	title,
	onPick,
	load = loadCatalog,
}: {
	open: boolean;
	onClose: () => void;
	value: string | null;
	title: string;
	onPick: (emoji: string) => void;
	load?: () => Promise<EmojiEntry[]>;
}) {
	const engine = useEmojiEngine();
	const ready = engine.status === "ready";
	const typedId = useId();
	const typedErrorId = useId();
	const [catalog, setCatalog] = useState<EmojiEntry[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [query, setQuery] = useState("");
	const [typed, setTyped] = useState("");
	const [typedInvalid, setTypedInvalid] = useState(false);
	const [suggested, setSuggested] = useState<string[]>([]);
	const [meaning, setMeaning] = useState<string[]>([]);
	const q = query.trim();
	const cleanTitle = title.trim();

	useEffect(() => {
		if (!open || catalog || failed) return;
		let current = true;
		load()
			.then((entries) => {
				if (current) setCatalog(entries);
			})
			.catch(() => {
				if (current) setFailed(true);
			});
		return () => {
			current = false;
		};
	}, [open, catalog, failed, load]);

	useEffect(() => {
		if (open) return;
		setQuery("");
		setTyped("");
		setTypedInvalid(false);
	}, [open]);

	useEffect(() => {
		if (!open || !ready || cleanTitle.length < MIN_TITLE_FOR_SUGGESTIONS) {
			setSuggested([]);
			return;
		}
		let current = true;
		engine
			.suggest(cleanTitle)
			.then((list) => {
				if (current) setSuggested(list.slice(0, MAX_SUGGESTED));
			})
			.catch(() => {
				if (current) setSuggested([]);
			});
		return () => {
			current = false;
		};
	}, [open, ready, engine, cleanTitle]);

	useEffect(() => {
		if (!open || !ready || q.length < MIN_QUERY_FOR_MEANING) {
			setMeaning([]);
			return;
		}
		let current = true;
		engine
			.search(q)
			.then((list) => {
				if (current) setMeaning(list);
			})
			.catch(() => {
				if (current) setMeaning([]);
			});
		return () => {
			current = false;
		};
	}, [open, ready, engine, q]);

	const byKey = useMemo(
		() => new Map((catalog ?? []).map((entry) => [emojiKey(entry.e), entry])),
		[catalog],
	);
	const nameOf = (emoji: string) => byKey.get(emojiKey(emoji))?.n ?? emoji;
	const current = value === null ? null : emojiKey(value);
	const isSelected = (emoji: string) => emojiKey(emoji) === current;
	const choose = (emoji: string) => {
		onPick(emoji);
		onClose();
	};

	const results = useMemo(() => {
		if (!catalog || q === "") return [];
		const keyword = searchEmoji(catalog, q);
		const seen = new Set(keyword.map((entry) => emojiKey(entry.e)));
		const extra = meaning
			.map((emoji) => byKey.get(emojiKey(emoji)))
			.filter((entry): entry is EmojiEntry => {
				if (!entry || seen.has(emojiKey(entry.e))) return false;
				seen.add(emojiKey(entry.e));
				return true;
			});
		return [...keyword, ...extra];
	}, [catalog, q, meaning, byKey]);
	const groups = useMemo(
		() => (catalog ? groupEntries(catalog) : []),
		[catalog],
	);

	let body: ReactNode = null;
	if (!catalog && !failed) {
		body = (
			<p role="status" className="text-[13px] text-text-2">
				Loading emoji
			</p>
		);
	} else if (catalog && q !== "") {
		body =
			results.length > 0 ? (
				<div className="grid grid-cols-7 justify-items-center">
					{results.map((entry) => (
						<EmojiButton
							key={entry.e}
							emoji={entry.e}
							name={entry.n}
							selected={isSelected(entry.e)}
							onPick={choose}
						/>
					))}
				</div>
			) : (
				<p className="text-[14px] text-text-2">No emoji match "{q}".</p>
			);
	} else if (catalog) {
		body = (
			<div className="flex flex-col gap-3">
				{groups.map((group) => (
					<LazyGroup
						key={group.name}
						name={group.name}
						entries={group.entries}
						isSelected={isSelected}
						onPick={choose}
					/>
				))}
			</div>
		);
	}

	return (
		<Sheet open={open} onClose={onClose} label="Choose emoji" showTitle>
			<div className="flex flex-col gap-4 pb-4">
				{catalog ? (
					<Input
						type="search"
						aria-label="Search emoji"
						placeholder="Search by name or keyword"
						autoComplete="off"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				) : null}

				<div className="flex items-end gap-2">
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<label
							htmlFor={typedId}
							className="text-[13px] font-medium text-text-2"
						>
							Type or paste an emoji
						</label>
						<Input
							id={typedId}
							autoComplete="off"
							value={typed}
							aria-invalid={typedInvalid || undefined}
							aria-describedby={typedInvalid ? typedErrorId : undefined}
							onChange={(e) => {
								const next = e.target.value;
								setTyped(next);
								const trimmed = next.trim();
								if (trimmed === "") {
									setTypedInvalid(false);
								} else if (isEmoji(trimmed)) {
									setTypedInvalid(false);
									choose(trimmed);
								} else {
									setTypedInvalid(true);
								}
							}}
						/>
					</div>
					<Button className="shrink-0" onClick={() => choose(DEFAULT_EMOJI)}>
						Use default
					</Button>
				</div>
				{typedInvalid ? (
					<p id={typedErrorId} className="-mt-2 text-[13px] text-danger">
						Enter one emoji.
					</p>
				) : null}

				{ready && suggested.length > 0 ? (
					<section aria-labelledby={`${typedId}-suggested`}>
						<h3
							id={`${typedId}-suggested`}
							className="mb-1 text-[13px] font-medium text-text-2"
						>
							Suggested
						</h3>
						<div className="flex gap-1">
							{suggested.map((emoji) => (
								<EmojiButton
									key={emoji}
									emoji={emoji}
									name={nameOf(emoji)}
									selected={isSelected(emoji)}
									onPick={choose}
								/>
							))}
						</div>
					</section>
				) : null}

				{body}
			</div>
		</Sheet>
	);
}
