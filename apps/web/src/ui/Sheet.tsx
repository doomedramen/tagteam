import { Drawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";

/** Bottom sheet dialog. Closes on backdrop tap, Escape, close button, or swipe. */
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
	const popupRef = useRef<HTMLDivElement>(null);

	return (
		<Drawer.Root
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
		>
			<Drawer.VirtualKeyboardProvider>
				<Drawer.Portal>
					<Drawer.Backdrop className="sheet-backdrop" />
					<Drawer.Viewport className="sheet-viewport">
						<Drawer.Popup
							ref={popupRef}
							className="sheet-popup"
							initialFocus={(openType) => {
								const popup = popupRef.current;
								if (!popup) return true;
								if (openType === "touch") return popup;
								return (
									popup.querySelector<HTMLElement>(
										"[autofocus], [data-autofocus]",
									) ?? true
								);
							}}
						>
							<div aria-hidden className="sheet-handle" />
							<Drawer.Title className="sr-only">{label}</Drawer.Title>
							<Drawer.Content className="sheet-scroll">
								{children}
							</Drawer.Content>
							<Drawer.Close aria-label="Close" className="sheet-close">
								<X aria-hidden className="size-4" />
							</Drawer.Close>
						</Drawer.Popup>
					</Drawer.Viewport>
				</Drawer.Portal>
			</Drawer.VirtualKeyboardProvider>
		</Drawer.Root>
	);
}
