import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";
import { readFlag, writeFlag } from "../../lib/storage";
import { dayBounds, useNow } from "../../lib/time";
import { useSession } from "../../session/session";
import { fireScreenConfettiCannon } from "../../ui/confetti";
import { useToast } from "../../ui/Toast";
import { buildToday, type TodayRow } from "./model";
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
	if (!tasks || !events || !activeGroupId) return null;

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
				if (row.completionId) await uncomplete(row.task.id, row.completionId);
				return;
			}
			const id = crypto.randomUUID();
			navigator.vibrate?.(10);
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
					onClick: () => void uncomplete(row.task.id, id),
				},
				durationMs: 5000,
			});
		} finally {
			inFlight.current.delete(key);
		}
	};

	return (
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
		/>
	);
}
