import type { LocalDate, MemberDto, SuggestionDto } from "@tagteam/core";
import { useEffect } from "react";
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
	return (
		<Sheet
			open={open && !empty}
			onClose={onClose}
			label="Suggestions"
			showTitle
		>
			<div className="flex flex-col gap-5 pb-2">
				<IncomingSuggestions
					suggestions={incoming}
					members={members}
					today={today}
					onAccept={onAccept}
					onDecline={onDecline}
				/>
				<OutgoingSuggestions
					suggestions={outgoing}
					members={members}
					onWithdraw={onWithdraw}
				/>
			</div>
		</Sheet>
	);
}
