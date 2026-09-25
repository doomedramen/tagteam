import { CloudOff, RefreshCw } from "lucide-react";
import type { SyncStatus } from "../sync/engine";

export function syncLabel(status: SyncStatus): string | null {
	if (status.state === "offline")
		return status.pending > 0
			? `Offline · ${status.pending} queued`
			: "Offline";
	if (status.pending > 0) return `Syncing ${status.pending}`;
	return null;
}

export function SyncChip({ status }: { status: SyncStatus }) {
	const label = syncLabel(status);
	if (!label) return null;
	const Icon = status.state === "offline" ? CloudOff : RefreshCw;
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-medium text-warning">
			<Icon aria-hidden className="size-3.5" />
			{label}
		</span>
	);
}
