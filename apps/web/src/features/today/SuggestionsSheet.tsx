import type { LocalDate, MemberDto, SuggestionDto } from "@tagteam/core";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Sheet } from "../../ui/Sheet";
import { IncomingSuggestions, OutgoingSuggestions } from "./Suggestions";

/** Everything suggestion-related: cards for me, and what I sent. Closes itself once both are empty. */
export function SuggestionsSheet({
	open,
	onClose,
	incoming,
	outgoing,
	members,
	today,
	onAccept,
	onDecline,
	onWithdraw,
}: {
	open: boolean;
	onClose: () => void;
	incoming: SuggestionDto[];
	outgoing: SuggestionDto[];
	members: MemberDto[];
	today: LocalDate;
	onAccept: (suggestion: SuggestionDto) => void;
	onDecline: (suggestion: SuggestionDto) => void;
	onWithdraw: (suggestion: SuggestionDto) => void;
}) {
	const empty = incoming.length === 0 && outgoing.length === 0;
	useEffect(() => {
		if (open && empty) onClose();
	}, [open, empty, onClose]);

	// The sheet slides out after the last answer; keep showing what it held so it
	// does not collapse to a bare title bar on the way out.
	const lastShown = useRef({ incoming, outgoing });
	useEffect(() => {
		if (!empty) lastShown.current = { incoming, outgoing };
	}, [empty, incoming, outgoing]);
	const shown = empty ? lastShown.current : { incoming, outgoing };

	// An answered row unmounts and takes focus with it. Hand focus to a neighbour.
	const bodyRef = useRef<HTMLDivElement>(null);
	const rowIds = useRef<string[]>([]);
	const answeredRow = useRef<string | null>(null);
	useLayoutEffect(() => {
		const ids = [...incoming, ...outgoing].map((suggestion) => suggestion.id);
		const previous = rowIds.current;
		rowIds.current = ids;
		const answered = answeredRow.current;
		const body = bodyRef.current;
		if (!answered || !body || ids.includes(answered) || empty) return;
		answeredRow.current = null;
		const at = previous.indexOf(answered);
		const neighbour =
			previous.slice(at + 1).find((id) => ids.includes(id)) ??
			previous
				.slice(0, Math.max(at, 0))
				.reverse()
				.find((id) => ids.includes(id));
		const row = body.querySelector<HTMLElement>(
			`[data-suggestion-row="${neighbour}"]`,
		);
		const target =
			row?.querySelector<HTMLElement>("button") ??
			body
				.closest('[data-slot="drawer-popup"]')
				?.querySelector<HTMLElement>('[data-slot="drawer-title"]');
		target?.focus({ preventScroll: true });
	}, [incoming, outgoing, empty]);

	return (
		<Sheet
			open={open && !empty}
			onClose={onClose}
			label="Suggestions"
			showTitle
		>
			<div
				ref={bodyRef}
				// Once everything is answered the cards are stale: show them, do not let them act.
				inert={empty}
				onClickCapture={(event) => {
					answeredRow.current =
						(event.target as Element)
							.closest("[data-suggestion-row]")
							?.getAttribute("data-suggestion-row") ?? null;
				}}
				className="flex flex-col gap-5 pb-2"
			>
				<IncomingSuggestions
					suggestions={shown.incoming}
					members={members}
					today={today}
					onAccept={onAccept}
					onDecline={onDecline}
				/>
				<OutgoingSuggestions
					suggestions={shown.outgoing}
					members={members}
					onWithdraw={onWithdraw}
				/>
			</div>
		</Sheet>
	);
}
