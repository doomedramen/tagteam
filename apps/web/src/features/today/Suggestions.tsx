import type { LocalDate, MemberDto, SuggestionDto } from "@tagteam/core";
import { useId } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { TaskEmoji } from "../look/TaskEmoji";
import { suggestionSummary } from "../suggestions/model";

const nameOf = (members: MemberDto[], userId: string) =>
	members.find((member) => member.userId === userId)?.displayName ?? "Someone";

export function IncomingSuggestions({
	suggestions,
	members,
	today,
	onAccept,
	onDecline,
}: {
	suggestions: SuggestionDto[];
	members: MemberDto[];
	today: LocalDate;
	onAccept: (suggestion: SuggestionDto) => void;
	onDecline: (suggestion: SuggestionDto) => void;
}) {
	const headingId = useId();
	if (suggestions.length === 0) return null;
	return (
		<section aria-labelledby={headingId}>
			<h2 id={headingId} className="mb-1 text-[13px] font-medium text-text-2">
				For you
			</h2>
			<ul className="flex flex-col gap-2">
				{suggestions.map((suggestion) => {
					const sender = members.find(
						(member) => member.userId === suggestion.fromUserId,
					);
					const name = sender?.displayName ?? "Someone";
					return (
						<li key={suggestion.id} data-suggestion-row={suggestion.id}>
							<Card className="gap-3 rounded-2xl p-4 ring-line">
								<CardContent className="flex flex-col gap-3 p-0">
									<div className="flex items-start gap-3">
										<Avatar name={name} color={sender?.avatarColor ?? "gray"} />
										<div className="min-w-0 flex-1">
											<p className="text-[13px] text-text-2">{name} suggests</p>
											<div className="flex items-start gap-2">
												<TaskEmoji
													emoji={suggestion.emoji}
													color={suggestion.color}
													size="row"
												/>
												<p className="min-w-0 break-words pt-1.5 text-[15px] font-medium">
													{suggestion.title}
												</p>
											</div>
											<p className="text-[13px] text-text-2">
												{suggestionSummary(suggestion, today)}
											</p>
										</div>
									</div>
									<div className="flex gap-2">
										<Button
											aria-label={`Decline ${suggestion.title}`}
											className="flex-1"
											onClick={() => onDecline(suggestion)}
										>
											Decline
										</Button>
										<Button
											variant="primary"
											aria-label={`Accept ${suggestion.title}`}
											className="flex-1"
											onClick={() => onAccept(suggestion)}
										>
											Accept
										</Button>
									</div>
								</CardContent>
							</Card>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

export function OutgoingSuggestions({
	suggestions,
	members,
	onWithdraw,
}: {
	suggestions: SuggestionDto[];
	members: MemberDto[];
	onWithdraw: (suggestion: SuggestionDto) => void;
}) {
	const headingId = useId();
	if (suggestions.length === 0) return null;
	return (
		<section aria-labelledby={headingId}>
			<h2 id={headingId} className="mb-1 text-[13px] font-medium text-text-2">
				Sent by you
			</h2>
			<Card className="gap-0 overflow-hidden rounded-2xl p-0 ring-line">
				<CardContent className="px-4 py-0">
					<ul>
						{suggestions.map((suggestion) => {
							const name = nameOf(members, suggestion.toUserId);
							const declined = suggestion.status === "declined";
							const action = declined ? "Clear" : "Withdraw";
							return (
								<li
									key={suggestion.id}
									data-suggestion-row={suggestion.id}
									className="flex items-center gap-3 border-b border-line py-3 last:border-0"
								>
									<TaskEmoji
										emoji={suggestion.emoji}
										color={suggestion.color}
										size="row"
									/>
									<div className="min-w-0 flex-1">
										<p className="truncate text-[15px]">{suggestion.title}</p>
										<p className="text-[13px] text-text-2">
											{declined ? `${name} declined` : `Waiting for ${name}`}
										</p>
									</div>
									<Button
										variant="ghost"
										aria-label={`${action} ${suggestion.title}`}
										className="shrink-0"
										onClick={() => onWithdraw(suggestion)}
									>
										{action}
									</Button>
								</li>
							);
						})}
					</ul>
				</CardContent>
			</Card>
		</section>
	);
}
