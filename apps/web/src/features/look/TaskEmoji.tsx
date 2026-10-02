import { DEFAULT_EMOJI } from "@tagteam/core";
import { cx } from "../../lib/cx";

const SIZES = {
	bare: "h-9 w-9 overflow-hidden text-[28px]",
	sheet: "size-20 text-[64px] leading-none",
	detail: "size-16 rounded-full bg-task-card text-[32px]",
} as const;

export type TaskEmojiSize = keyof typeof SIZES;

/**
 * A decorative emoji. A task with no stored emoji shows the default.
 * It carries no accessible name: the control around it (or the row's title) does.
 * - `bare`: Today tiles and suggestion cards. The glyph alone in a 36 px wide slot, with no
 *   fill, ring or hue of its own (the colour lives on the Today tile around it).
 * - `sheet`: the hero glyph on the task sheet, 64 px in an 80 px box with no fill or circle.
 * - `detail`: a round holder that sits on a tinted surface and inherits its hue,
 *   so the circle takes the `task-card` colour with no ring.
 */
export function TaskEmoji({
	emoji,
	size,
	className,
}: {
	emoji: string | null | undefined;
	size: TaskEmojiSize;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			data-slot="task-emoji"
			className={cx(
				"flex shrink-0 select-none items-center justify-center leading-none transition-colors duration-200 motion-reduce:transition-none",
				SIZES[size],
				className,
			)}
		>
			{emoji ?? DEFAULT_EMOJI}
		</span>
	);
}
