import type { Mutation, SuggestionDto } from "@tagteam/core";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";
import { readFlag, writeFlag } from "../../lib/storage";
import { browserTimeZone, dayBounds, localDate, useNow } from "../../lib/time";
import { useSession } from "../../session/session";
import { fireScreenConfettiCannon } from "../../ui/confetti";
import { useToast } from "../../ui/Toast";
import {
	acceptStartDate,
	incomingSuggestions,
	outgoingSuggestions,
} from "../suggestions/model";
import { buildToday, type TodayRow } from "./model";
import { SuggestionsSheet } from "./SuggestionsSheet";
import { SuggestionsStrip } from "./SuggestionsStrip";
import { TodayList } from "./TodayList";

const UPCOMING_KEY = "tagteam.showUpcoming";

export function TodayScreen() {
	const { store, engine, me, activeGroupId } = useSession();
	const outlet = useOutletContext<{ openAdd?: () => void } | undefined>();
	const toast = useToast();
	const now = useNow();
	const [showUpcoming, setShowUpcoming] = useState(() =>
		readFlag(UPCOMING_KEY, false),
	);
	const [celebratingKey, setCelebratingKey] = useState<string | null>(null);
	const [suggestionsOpen, setSuggestionsOpen] = useState(false);
	const closeSuggestions = useCallback(() => setSuggestionsOpen(false), []);
	const inFlight = useRef(new Set<string>());
	const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
		},
		[],
	);
	const tasks = useLiveQuery(
		() =>
			store.tasks
				.where("groupId")
				.equals(activeGroupId ?? "")
				.toArray(),
		[store, activeGroupId],
	);
	const events = useLiveQuery(async () => {
		const ids = (tasks ?? []).map((t) => t.id);
		return ids.length === 0
			? []
			: store.events.where("taskId").anyOf(ids).toArray();
	}, [store, tasks]);
	const members = useLiveQuery(
		() =>
			store.members
				.where("groupId")
				.equals(activeGroupId ?? "")
				.toArray(),
		[store, activeGroupId],
	);
	const suggestions = useLiveQuery(
		() =>
			store.suggestions
				.where("groupId")
				.equals(activeGroupId ?? "")
				.toArray(),
		[store, activeGroupId],
	);
	if (!tasks || !events || !members || !suggestions || !activeGroupId)
		return null;

	const view = buildToday({
		tasks,
		events,
		userId: me.user.id,
		groupId: activeGroupId,
		now,
		day: dayBounds(now),
	});

	const uncomplete = (taskId: string, refEventId: string) =>
		engine.enqueue({
			id: crypto.randomUUID(),
			at: Date.now(),
			type: "task.uncomplete",
			taskId,
			refEventId,
		});

	const onToggle = async (row: TodayRow) => {
		const key = `${row.task.id}:${row.key}:${row.kind}`;
		if (inFlight.current.has(key)) return;
		inFlight.current.add(key);
		try {
			if (row.kind === "done") {
				if (row.completionId) {
					await uncomplete(row.task.id, row.completionId);
					toast.show({ message: `Reopened · ${row.task.title}` });
				}
				return;
			}
			const id = crypto.randomUUID();
			await engine.enqueue({
				id,
				at: Date.now(),
				type: "task.complete",
				taskId: row.task.id,
				occurrenceKey: row.key,
			});
			fireScreenConfettiCannon();
			const nextCelebrationKey = `${row.task.id}:${row.key}`;
			setCelebratingKey(nextCelebrationKey);
			if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
			celebrationTimer.current = setTimeout(() => {
				setCelebratingKey((current) =>
					current === nextCelebrationKey ? null : current,
				);
			}, 750);
			toast.show({
				message: `Done · ${row.task.title}`,
				action: {
					label: "Undo",
					onClick: () => {
						void uncomplete(row.task.id, id).catch(() => {
							toast.show({ message: "Could not undo completion. Try again." });
						});
					},
				},
				durationMs: 5000,
			});
		} catch {
			toast.show({ message: "Could not change task. Try again." });
		} finally {
			inFlight.current.delete(key);
		}
	};

	const answer = async (
		suggestion: SuggestionDto,
		mutation: Mutation,
		message: string,
	) => {
		const key = `suggestion:${suggestion.id}`;
		if (inFlight.current.has(key)) return;
		inFlight.current.add(key);
		try {
			await engine.enqueue(mutation);
			toast.show({ message });
		} catch {
			toast.show({ message: "Could not update suggestion. Try again." });
		} finally {
			inFlight.current.delete(key);
		}
	};
	const accept = (suggestion: SuggestionDto) =>
		answer(
			suggestion,
			{
				id: crypto.randomUUID(),
				at: Date.now(),
				type: "suggestion.accept",
				suggestionId: suggestion.id,
				taskId: crypto.randomUUID(),
				timezone: browserTimeZone(),
				startDate: acceptStartDate(suggestion.startDate, localDate(Date.now())),
			},
			`Added · ${suggestion.title}`,
		);
	const decline = (suggestion: SuggestionDto) =>
		answer(
			suggestion,
			{
				id: crypto.randomUUID(),
				at: Date.now(),
				type: "suggestion.decline",
				suggestionId: suggestion.id,
			},
			`Declined · ${suggestion.title}`,
		);
	const withdraw = (suggestion: SuggestionDto) =>
		answer(
			suggestion,
			{
				id: crypto.randomUUID(),
				at: Date.now(),
				type: "suggestion.withdraw",
				suggestionId: suggestion.id,
			},
			suggestion.status === "declined"
				? `Cleared · ${suggestion.title}`
				: `Withdrawn · ${suggestion.title}`,
		);

	const incoming = incomingSuggestions(suggestions, activeGroupId, me.user.id);
	const outgoing = outgoingSuggestions(suggestions, activeGroupId, me.user.id);

	return (
		<>
			<TodayList
				view={view}
				now={now}
				celebratingKey={celebratingKey}
				showUpcoming={showUpcoming}
				onToggleUpcoming={() => {
					setShowUpcoming((value) => {
						writeFlag(UPCOMING_KEY, !value);
						return !value;
					});
				}}
				onToggle={(row) => void onToggle(row)}
				onAdd={() => outlet?.openAdd?.()}
				strip={
					<SuggestionsStrip
						incoming={incoming.length}
						waiting={outgoing.filter((s) => s.status === "pending").length}
						declined={outgoing.filter((s) => s.status === "declined").length}
						onOpen={() => setSuggestionsOpen(true)}
					/>
				}
			/>
			<SuggestionsSheet
				open={suggestionsOpen}
				onClose={closeSuggestions}
				incoming={incoming}
				outgoing={outgoing}
				members={members}
				today={localDate(now)}
				onAccept={(suggestion) => void accept(suggestion)}
				onDecline={(suggestion) => void decline(suggestion)}
				onWithdraw={(suggestion) => void withdraw(suggestion)}
			/>
		</>
	);
}
