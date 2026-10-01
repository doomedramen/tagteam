/** The seven hues a task can take. A task stores the name, never a colour value. */
export const TASK_COLORS = [
	"pink",
	"coral",
	"amber",
	"green",
	"teal",
	"blue",
	"purple",
] as const;

export type TaskColor = (typeof TASK_COLORS)[number];

export const isTaskColor = (v: unknown): v is TaskColor =>
	typeof v === "string" && (TASK_COLORS as readonly string[]).includes(v);

/** Shown wherever a task has no stored emoji ("not decided yet"): 📋, the bare code point U+1F4CB. */
export const DEFAULT_EMOJI = "\u{1F4CB}";
export const DEFAULT_EMOJI_NAME = "clipboard";

const MAX_EMOJI_UNITS = 32;
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const KEYCAP = /^[0-9#*]️?⃣$/;
// Missing in very old browsers; there the length and pictograph checks still apply.
const segmenter =
	typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : null;

/** True for a string that is exactly one emoji: one grapheme cluster with a pictograph, flag, or keycap, at most 32 UTF-16 code units. `null` is handled by the caller. */
export function isEmoji(v: unknown): v is string {
	if (typeof v !== "string" || v.length < 1 || v.length > MAX_EMOJI_UNITS)
		return false;
	if (segmenter && Array.from(segmenter.segment(v)).length !== 1) return false;
	return PICTOGRAPHIC.test(v) || KEYCAP.test(v);
}
