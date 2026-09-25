import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useOutletContext } from "react-router";
import { readFlag, writeFlag } from "../../lib/storage";
import { dayBounds, useNow } from "../../lib/time";
import { useSession } from "../../session/session";
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
		toast.show({
			message: `Done · ${row.task.title}`,
			action: {
				label: "Undo",
				onClick: () => void uncomplete(row.task.id, id),
			},
			durationMs: 5000,
		});
	};

	return (
		<TodayList
			view={view}
			now={now}
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
