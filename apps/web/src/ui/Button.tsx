import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
	primary: "bg-accent text-on-accent active:opacity-90",
	secondary: "bg-surface text-text ring-1 ring-line active:bg-surface-2",
	ghost: "text-accent active:bg-accent-soft",
	danger: "text-danger ring-1 ring-danger/40 active:bg-danger-soft",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	block?: boolean;
	busy?: boolean;
}

export function Button({
	variant = "secondary",
	block,
	busy,
	className,
	children,
	disabled,
	...rest
}: ButtonProps) {
	return (
		<button
			type="button"
			{...rest}
			disabled={disabled || busy}
			aria-busy={busy || undefined}
			className={cx(
				"inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium transition-[opacity,background-color] duration-150 disabled:opacity-50",
				VARIANTS[variant],
				block && "w-full",
				className,
			)}
		>
			{busy ? <Spinner /> : null}
			{children}
		</button>
	);
}
