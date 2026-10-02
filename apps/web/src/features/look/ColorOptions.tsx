import { TASK_COLORS, type TaskColor } from "@tagteam/core";
import { Check } from "lucide-react";
import { useId } from "react";
import { cx } from "../../lib/cx";
import { COLOR_LABELS } from "./colors";

/**
 * The seven hues as a radio group of circles: 32 px swatch, 44 px target, a check on the
 * selected one (so colour is never the only signal). Native radios give grouping, arrow keys
 * and screen reader semantics for free. `value` null checks none.
 */
export function ColorOptions({
	value,
	onChange,
	className,
}: {
	value: TaskColor | null;
	onChange: (color: TaskColor) => void;
	className?: string;
}) {
	const name = useId();
	return (
		<div
			role="radiogroup"
			aria-label="Color"
			className={cx("flex justify-center", className)}
		>
			{TASK_COLORS.map((hue) => {
				const selected = value === hue;
				return (
					<label
						key={hue}
						data-task-color={hue}
						className="relative flex size-11 cursor-pointer items-center justify-center"
					>
						<input
							type="radio"
							name={name}
							value={hue}
							checked={selected}
							aria-label={COLOR_LABELS[hue]}
							onChange={() => onChange(hue)}
							className="peer sr-only"
						/>
						<span
							aria-hidden="true"
							className="flex size-8 items-center justify-center rounded-full border-2 border-task-ring bg-task-swatch text-text transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent motion-reduce:transition-none motion-safe:peer-active:scale-90"
						>
							{selected ? <Check className="size-4" strokeWidth={3} /> : null}
						</span>
					</label>
				);
			})}
		</div>
	);
}
