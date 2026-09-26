import type { ReactNode } from "react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { cx } from "../lib/cx";
import { Button } from "./Button";

export function Banner({
	tone,
	children,
	action,
}: {
	tone: "warning" | "danger";
	children: ReactNode;
	action?: { label: string; onClick: () => void };
}) {
	return (
		<Alert
			variant={tone === "danger" ? "destructive" : "default"}
			className={cx(
				"mx-4 mt-2 flex items-center gap-3 rounded-2xl border-0 px-4 py-2.5 text-[14px]",
				tone === "warning"
					? "bg-warning-soft text-warning"
					: "bg-danger-soft text-danger",
			)}
		>
			<AlertDescription
				className={cx(
					"min-w-0 flex-1 text-[14px]",
					tone === "warning" ? "text-warning" : "text-danger",
				)}
			>
				{children}
			</AlertDescription>
			{action ? (
				<AlertAction className="static shrink-0 p-0">
					<Button
						variant="ghost"
						className="-my-1 min-h-11 px-0 font-semibold underline-offset-2 hover:underline"
						onClick={action.onClick}
					>
						{action.label}
					</Button>
				</AlertAction>
			) : null}
		</Alert>
	);
}
