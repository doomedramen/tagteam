import { type InputHTMLAttributes, type Ref, useId } from "react";
import { cx } from "../lib/cx";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
	label: string;
	error?: string;
	hint?: string;
	ref?: Ref<HTMLInputElement>;
}

export function TextField({
	label,
	error,
	hint,
	id,
	className,
	ref,
	...rest
}: TextFieldProps) {
	const autoId = useId();
	const inputId = id ?? autoId;
	const note = error ?? hint;
	return (
		<div className={cx("flex flex-col gap-1.5", className)}>
			<label htmlFor={inputId} className="text-[13px] font-medium text-text-2">
				{label}
			</label>
			<input
				ref={ref}
				id={inputId}
				aria-invalid={error ? true : undefined}
				aria-describedby={note ? `${inputId}-note` : undefined}
				{...rest}
				className="min-h-12 rounded-xl bg-surface px-3.5 text-base text-text outline-none ring-1 ring-line placeholder:text-text-3 focus:ring-2 focus:ring-accent aria-invalid:ring-danger"
			/>
			{note ? (
				<p
					id={`${inputId}-note`}
					className={cx("text-[13px]", error ? "text-danger" : "text-text-3")}
				>
					{note}
				</p>
			) : null}
		</div>
	);
}
