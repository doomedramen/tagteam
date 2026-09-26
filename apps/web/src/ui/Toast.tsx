import type { ReactNode } from "react";
import { toast as shadcnToast, Toaster } from "@/components/ui/toast";

interface ToastInput {
	message: string;
	action?: { label: string; onClick: () => void };
	durationMs?: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
	return <Toaster>{children}</Toaster>;
}

export function useToast() {
	return {
		show(input: ToastInput) {
			let id = "";
			id = shadcnToast.add({
				title: input.message,
				timeout: input.durationMs,
				actionProps: input.action
					? {
							children: input.action.label,
							onClick: () => {
								try {
									input.action?.onClick();
								} finally {
									shadcnToast.close(id);
								}
							},
						}
					: undefined,
			});
		},
	};
}
