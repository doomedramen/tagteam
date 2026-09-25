import { cx } from "../lib/cx";

const initials = (name: string) =>
	name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("") || "?";

export function Avatar({
	name,
	color,
	size = "md",
}: {
	name: string;
	color: string;
	size?: "sm" | "md";
}) {
	return (
		<span
			aria-hidden
			className={cx(
				`avatar-${color}`,
				"inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
				size === "sm" ? "size-7 text-[11px]" : "size-9 text-[13px]",
			)}
		>
			{initials(name)}
		</span>
	);
}
