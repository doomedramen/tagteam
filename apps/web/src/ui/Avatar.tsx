import { AvatarFallback, Avatar as ShadcnAvatar } from "@/components/ui/avatar";
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
		<ShadcnAvatar
			aria-hidden="true"
			size={size === "sm" ? "sm" : "default"}
			className={size === "sm" ? "size-7" : "size-9"}
		>
			<AvatarFallback
				className={cx(
					`avatar-${color}`,
					"font-semibold",
					size === "sm" ? "text-[11px]" : "text-[13px]",
				)}
			>
				{initials(name)}
			</AvatarFallback>
		</ShadcnAvatar>
	);
}
