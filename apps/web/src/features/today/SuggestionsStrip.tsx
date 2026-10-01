import { ChevronRight, Inbox } from "lucide-react";
import { cx } from "../../lib/cx";
import { suggestionsStripText } from "../suggestions/model";

/** One row summarising suggestions; hidden when there is nothing to show. Opens the suggestions sheet. */
export function SuggestionsStrip({
	incoming,
	waiting,
	declined,
	onOpen,
}: {
	incoming: number;
	waiting: number;
	declined: number;
	onOpen: () => void;
}) {
	const text = suggestionsStripText(incoming, waiting, declined);
	if (!text) return null;
	return (
		<button
			type="button"
			onClick={onOpen}
			className={cx(
				"mt-4 flex min-h-11 w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left ring-1 ring-line focus-visible:outline-2 focus-visible:outline-accent active:opacity-90",
				incoming > 0 ? "bg-accent-soft" : "bg-surface",
			)}
		>
			<Inbox aria-hidden className="size-5 shrink-0 text-accent" />
			<span className="min-w-0 flex-1">
				<span className="block text-[15px] font-medium">{text.title}</span>
				{text.detail ? (
					<span className="block text-[13px] text-text-2">{text.detail}</span>
				) : null}
			</span>
			<ChevronRight aria-hidden className="size-4 shrink-0 text-text-3" />
		</button>
	);
}
