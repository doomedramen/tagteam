import { DEFAULT_EMOJI, type TaskColor } from "@tagteam/core";
import { cx } from "../../lib/cx";

const SIZES = {
	row: "size-9 text-[19px]",
	sheet: "size-15 text-[30px]",
	detail: "size-16 text-[32px]",
} as const;

export type TaskEmojiSize = keyof typeof SIZES;

/**
 * A round, decorative emoji holder. A task with no stored emoji shows the default.
 * It carries no accessible name: the control around it (or the row's title) does.
 * It wears `color` when given one; otherwise it inherits the nearest ancestor's tokens.
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
	return (
		<span
			aria-hidden="true"
			data-slot="task-emoji"
			data-task-color={color ?? undefined}
			className={cx(
				"flex shrink-0 select-none items-center justify-center rounded-full bg-task-swatch leading-none transition-colors duration-200 motion-reduce:transition-none",
				SIZES[size],
				className,
			)}
		>
			{emoji ?? DEFAULT_EMOJI}
		</span>
	);
}
