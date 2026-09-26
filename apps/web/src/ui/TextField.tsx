import { type InputHTMLAttributes, useId } from "react";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cx } from "../lib/cx";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
	label: string;
	error?: string;
	hint?: string;
}

export function TextField({
	label,
	error,
	hint,
	id,
	className,
	...rest
}: TextFieldProps) {
	const autoId = useId();
	const inputId = id ?? autoId;
	const note = error ?? hint;
	return (
		<FieldGroup className="gap-1.5">
			<Field data-invalid={error ? true : undefined} className="gap-1.5">
				<FieldLabel
					htmlFor={inputId}
					className="text-[13px] font-medium text-text-2"
				>
					{label}
				</FieldLabel>
				<Input
					id={inputId}
					aria-invalid={error ? true : undefined}
					aria-describedby={note ? `${inputId}-note` : undefined}
					{...rest}
					className={cx(
						"min-h-12 rounded-xl border-0 bg-surface px-3.5 text-base text-text ring-1 ring-line placeholder:text-text-3 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent aria-invalid:ring-danger",
						className,
					)}
				/>
				{error ? (
					<FieldError id={`${inputId}-note`} className="text-[13px]">
						{error}
					</FieldError>
				) : hint ? (
					<FieldDescription id={`${inputId}-note`} className="text-[13px]">
						{hint}
					</FieldDescription>
				) : null}
			</Field>
		</FieldGroup>
	);
}
