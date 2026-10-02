import { DEFAULT_EMOJI, type TaskColor } from "@tagteam/core";
import { cx } from "../../lib/cx";

const SIZES = {
	row: "size-9 text-[19px]",
	sheet: "size-15 text-[30px]",
	detail: "size-16 text-[32px]",
} as const;

export type TaskEmojiSize = keyof typeof SIZES;

/** Fill and border by situation; see the doc comment on TaskEmoji. */
const LOOK = {
	ringed: "border-2 border-task-ring bg-task-sheet",
	neutral: "bg-surface-2",
	onTint: "bg-task-card",
} as const;

/**
 * A round, decorative emoji holder. A task with no stored emoji shows the default.
 * It carries no accessible name: the control around it (or the row's title) does.
 * The colour is a ring, not a fill, so the emoji stays readable:
 * - `row` with a `color` (Today rows, suggestion cards): pale `task-sheet` fill and a 2 px
 *   `task-ring` border, wearing that hue itself.
 * - `row` without a `color`: neutral `surface-2` fill, no ring.
 * - `sheet` and `detail`: they sit on a tinted surface and inherit its hue, so the circle
 *   takes the `task-card` colour with no ring.
 */
export function TaskEmoji({
	emoji,
	color,
	size,
	className,
}: {
	emoji: string | null | undefined;
	color?: TaskColor | null;
	size: TaskEmojiSize;
	className?: string;
}) {
	const look =
		size !== "row" ? LOOK.onTint : color ? LOOK.ringed : LOOK.neutral;
	return (
		<span
			aria-hidden="true"
			data-slot="task-emoji"
			data-task-color={color ?? undefined}
			className={cx(
				"flex shrink-0 select-none items-center justify-center rounded-full leading-none transition-colors duration-200 motion-reduce:transition-none",
				SIZES[size],
				look,
				className,
			)}
		>
			{emoji ?? DEFAULT_EMOJI}
		</span>
	);
}
