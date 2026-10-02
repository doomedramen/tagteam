import { useId } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "../../ui/Button";
import { EMOJI_DOWNLOAD_BYTES } from "../emoji/assets";
import type { FailureReason } from "../emoji/controller";
import { useEmojiSettings } from "../emoji/EmojiEngineHost";

/** The size of a full download in whole megabytes, from the same bytes the controller counts progress against. */
const DOWNLOAD_MB = Math.round(EMOJI_DOWNLOAD_BYTES / 1_000_000);

const HELPER = `Suggests an emoji while you type a task name. Needs a one-time download of about ${DOWNLOAD_MB} MB and works offline afterwards. Wi-Fi is best.`;

const FAILURES: Record<FailureReason, string> = {
	offline: "Couldn't download. You're offline. Connect and try again.",
	storage: "Couldn't download. This device is out of storage.",
	load: "Couldn't load emoji suggestions.",
	stopped: "Emoji suggestions stopped after repeated problems.",
	unsupported: "This browser can't run emoji suggestions.",
};

/**
 * The only place emoji suggestions are switched on or off, and the only place an update or a
 * failure is shown. Nothing downloads until the person presses Download.
 */
export function EmojiSuggestionsSettings() {
	const { download, startDownload, removeDownload } = useEmojiSettings();
	const id = useId();

	let status: string;
	let detail: string | null = null;
	let action: { label: string; run: () => void; variant?: "primary" } | null =
		null;
	let progress: number | null | undefined;
	let percent: number | null = null;

	switch (download.kind) {
		case "notDownloaded":
			status = "Emoji suggestions are off.";
			detail =
				download.note === "crash"
					? "They were switched off because this device ran out of memory while loading them. You can download them again to retry."
					: download.note === "evicted"
						? "The browser removed the download to free space. You can download it again."
						: null;
			action = { label: "Download", run: startDownload, variant: "primary" };
			break;
		case "updateAvailable":
			status = "An update is available.";
			detail = `Suggestions are paused until you download it. It is about ${DOWNLOAD_MB} MB, so Wi-Fi is best.`;
			action = { label: "Download", run: startDownload, variant: "primary" };
			break;
		case "downloading":
			progress = download.progress;
			percent =
				download.progress === null ? null : Math.round(download.progress * 100);
			// The live region names the state only; the percentage is shown beside it and carried
			// by the progress bar, so a screen reader is not read a new number every percent.
			status = "Downloading…";
			action = { label: "Cancel", run: removeDownload };
			break;
		case "loading":
			status = "Getting emoji suggestions ready…";
			action = { label: "Remove download", run: removeDownload };
			break;
		case "ready":
			status = "Emoji suggestions are on";
			detail = "They work offline.";
			action = { label: "Remove download", run: removeDownload };
			break;
		case "failed":
			status = FAILURES[download.reason];
			action =
				download.reason === "unsupported"
					? null
					: { label: "Try again", run: startDownload, variant: "primary" };
			break;
	}

	return (
		<section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
			<div>
				<h2 id={`${id}-heading`} className="text-[15px] font-semibold">
					Emoji suggestions
				</h2>
				<p className="mt-1 text-[13px] text-text-2">{HELPER}</p>
			</div>
			<Card className="gap-3 rounded-2xl p-4 ring-line">
				<CardContent className="flex flex-col gap-3 p-0">
					<div className="flex items-baseline justify-between gap-3">
						<p role="status" className="text-[14px] font-medium">
							{status}
						</p>
						{percent !== null ? (
							<span
								aria-hidden
								className="text-[13px] text-text-2 tabular-nums"
							>
								{percent}%
							</span>
						) : null}
					</div>
					{detail ? <p className="text-[13px] text-text-2">{detail}</p> : null}
					{progress !== undefined ? (
						<Progress
							aria-label="Download progress"
							value={percent}
							indicatorClassName="data-indeterminate:w-2/5 motion-safe:data-indeterminate:animate-pulse"
						/>
					) : null}
					{action ? (
						<Button
							variant={action.variant ?? "secondary"}
							block
							onClick={action.run}
						>
							{action.label}
						</Button>
					) : null}
				</CardContent>
			</Card>
		</section>
	);
}
