import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SyncStatus } from "../sync/engine";

export function syncLabel(status: SyncStatus): string | null {
	if (status.state === "offline")
		return status.pending > 0
			? `Offline · ${status.pending} queued`
			: "Offline";
	if (status.pending > 0) return "Syncing";
	return null;
}

export function SyncChip({ status }: { status: SyncStatus }) {
	const label = syncLabel(status);
	const [displayLabel, setDisplayLabel] = useState(label);
	const [visible, setVisible] = useState(label !== null);
	const [entering, setEntering] = useState(label !== null);
	const displayedLabel = useRef<string | null>(null);

	useEffect(() => {
		if (label) {
			const wasHidden = displayedLabel.current === null;
			displayedLabel.current = label;
			setDisplayLabel(label);
			setVisible(true);
			setEntering(wasHidden);
			if (wasHidden) {
				const timer = setTimeout(() => setEntering(false), 180);
				return () => clearTimeout(timer);
			}
			return;
		}

		if (displayedLabel.current === null) return;
		setVisible(false);
		const timer = setTimeout(() => {
			displayedLabel.current = null;
			setDisplayLabel(null);
		}, 180);
		return () => clearTimeout(timer);
	}, [label]);

	if (!displayLabel) return null;
	const Icon = displayLabel.startsWith("Offline") ? CloudOff : RefreshCw;
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-medium text-warning transition-[opacity,transform] duration-[180ms] ease-out ${visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0"} ${entering ? "animate-[sync-badge-in_180ms_ease-out]" : ""}`}
		>
			<Icon aria-hidden className="size-3.5" />
			{displayLabel}
		</span>
	);
}
