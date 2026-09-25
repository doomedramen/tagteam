import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

/** Bottom sheet dialog. Closes on backdrop tap and Escape. */
export function Sheet({
	open,
	onClose,
	label,
	children,
}: {
	open: boolean;
	onClose: () => void;
	label: string;
	children: ReactNode;
}) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = previous;
		};
	}, [open, onClose]);

	if (!open) return null;
	return createPortal(
		<div className="fixed inset-0 z-50 flex flex-col justify-end">
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute inset-0 bg-black/40 animate-[fade-in_150ms_ease-out]"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={label}
				className="relative max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-surface px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl animate-[sheet-up_240ms_cubic-bezier(0.32,0.72,0,1)]"
			>
				<div
					aria-hidden
					className="mx-auto mb-3 h-1 w-9 rounded-full bg-line"
				/>
				{children}
			</div>
		</div>,
		document.body,
	);
}
