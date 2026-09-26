import type { ComponentProps } from "react";
import { Spinner as ShadcnSpinner } from "@/components/ui/spinner";

export function Spinner(props: ComponentProps<typeof ShadcnSpinner>) {
	return (
		<ShadcnSpinner
			aria-hidden="true"
			role="presentation"
			aria-label={undefined}
			{...props}
		/>
	);
}
