import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeEmojiController } from "../../test/emoji";
import { renderWithSession } from "../../test/fakes";
import { EMOJI_DOWNLOAD_BYTES } from "../emoji/assets";
import type { EmojiSnapshot } from "../emoji/controller";
import { EmojiEngineHost } from "../emoji/EmojiEngineHost";
import { EmojiSuggestionsSettings } from "./EmojiSuggestionsSettings";

function setup(initial: Partial<EmojiSnapshot> = {}) {
	const { controller, change } = fakeEmojiController(initial);
	renderWithSession(
		<EmojiEngineHost controller={controller}>
			<EmojiSuggestionsSettings />
		</EmojiEngineHost>,
	);
	return { controller, change };
}
const status = () => screen.getByRole("status");
const button = (name: string) => screen.getByRole("button", { name });

describe("EmojiSuggestionsSettings", () => {
	it("by default says they are off, explains the 49 MB download, and offers Download", () => {
		setup();
		expect(
			screen.getByRole("heading", { name: "Emoji suggestions" }),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"Suggests an emoji while you type a task name. Needs a one-time download of about 49 MB and works offline afterwards. Wi-Fi is best.",
			),
		).toBeInTheDocument();
		expect(status()).toHaveTextContent("Emoji suggestions are off.");
		expect(button("Download")).toBeInTheDocument();
		expect(screen.queryByRole("switch")).not.toBeInTheDocument();
	});

	it("starts the download only when Download is pressed", async () => {
		const { controller } = setup();
		expect(controller.download).not.toHaveBeenCalled();
		await userEvent.click(button("Download"));
		expect(controller.download).toHaveBeenCalledTimes(1);
	});

	it("shows progress in words and as a bar while downloading, with a Cancel button", async () => {
		const { controller, change } = setup({ optedIn: true });
		act(() => change({ download: { kind: "downloading", progress: null } }));
		expect(status()).toHaveTextContent("Downloading…");
		expect(
			screen.getByRole("progressbar", { name: "Download progress" }),
		).toBeInTheDocument();
		act(() => change({ download: { kind: "downloading", progress: 0.426 } }));
		expect(status()).toHaveTextContent("Downloading…");
		expect(status()).not.toHaveTextContent("43");
		expect(screen.getByText("43%")).toHaveAttribute("aria-hidden", "true");
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"43",
		);
		await userEvent.click(button("Cancel"));
		expect(controller.remove).toHaveBeenCalledTimes(1);
	});

	it("says they are on once downloaded, and Remove download takes them away", async () => {
		const { controller } = setup({
			optedIn: true,
			download: { kind: "ready" },
		});
		expect(status()).toHaveTextContent("Emoji suggestions are on");
		expect(screen.getByText("They work offline.")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Download" }),
		).not.toBeInTheDocument();
		await userEvent.click(button("Remove download"));
		expect(controller.remove).toHaveBeenCalledTimes(1);
	});

	it("announces each change in the same status line", () => {
		const { change } = setup();
		const line = status();
		act(() => change({ download: { kind: "loading" } }));
		expect(line).toHaveTextContent("Getting emoji suggestions ready…");
		expect(screen.getByRole("status")).toBe(line);
		act(() => change({ download: { kind: "ready" } }));
		expect(line).toHaveTextContent("Emoji suggestions are on");
	});

	it("explains a failure in one plain sentence and offers Try again", async () => {
		const { controller, change } = setup({ optedIn: true });
		const reasons = [
			["offline", "Couldn't download. You're offline. Connect and try again."],
			["storage", "Couldn't download. This device is out of storage."],
			["load", "Couldn't load emoji suggestions."],
			["stopped", "Emoji suggestions stopped after repeated problems."],
		] as const;
		for (const [reason, sentence] of reasons) {
			act(() => change({ download: { kind: "failed", reason } }));
			expect(status(), reason).toHaveTextContent(sentence);
		}
		await userEvent.click(button("Try again"));
		expect(controller.download).toHaveBeenCalledTimes(1);
	});

	it("says an unsupported browser cannot run them, with nothing to press", () => {
		setup({ download: { kind: "failed", reason: "unsupported" } });
		expect(status()).toHaveTextContent(
			"This browser can't run emoji suggestions.",
		);
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("shows an update with Download and the paused explanation", async () => {
		const { controller } = setup({
			optedIn: true,
			download: { kind: "updateAvailable" },
		});
		expect(status()).toHaveTextContent("An update is available.");
		expect(
			screen.getByText(
				"Suggestions are paused until you download it. It is about 49 MB, so Wi-Fi is best.",
			),
		).toBeInTheDocument();
		await userEvent.click(button("Download"));
		expect(controller.download).toHaveBeenCalledTimes(1);
	});

	it("explains a switch-off the person did not ask for, and offers Download again", () => {
		const { change } = setup();
		act(() => change({ download: { kind: "notDownloaded", note: "crash" } }));
		expect(
			screen.getByText(
				"They were switched off because this device ran out of memory while loading them. You can download them again to retry.",
			),
		).toBeInTheDocument();
		expect(button("Download")).toBeInTheDocument();
		act(() => change({ download: { kind: "notDownloaded", note: "evicted" } }));
		expect(
			screen.getByText(
				"The browser removed the download to free space. You can download it again.",
			),
		).toBeInTheDocument();
	});

	it("also offers Remove download next to the primary action when an update is pending", async () => {
		const { controller } = setup({
			optedIn: true,
			download: { kind: "updateAvailable" },
		});
		expect(button("Download")).toBeInTheDocument();
		expect(button("Remove download")).toHaveClass("min-h-11");
		await userEvent.click(button("Remove download"));
		expect(controller.remove).toHaveBeenCalledTimes(1);
		expect(controller.download).not.toHaveBeenCalled();
	});

	it("also offers Remove download next to Try again after a failure, a stop included", async () => {
		const { controller, change } = setup({ optedIn: true });
		for (const reason of ["offline", "storage", "load", "stopped"] as const) {
			act(() => change({ download: { kind: "failed", reason } }));
			expect(button("Try again"), reason).toBeInTheDocument();
			expect(button("Remove download"), reason).toHaveClass("min-h-11");
		}
		await userEvent.click(button("Remove download"));
		expect(controller.remove).toHaveBeenCalledTimes(1);
		expect(controller.download).not.toHaveBeenCalled();
	});

	it("offers no Remove download where there is nothing to remove", () => {
		const { change } = setup();
		act(() => change({ download: { kind: "notDownloaded", note: "evicted" } }));
		expect(
			screen.queryByRole("button", { name: "Remove download" }),
		).not.toBeInTheDocument();
		act(() => change({ download: { kind: "failed", reason: "unsupported" } }));
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("has buttons at least 44 px tall", () => {
		setup();
		expect(button("Download")).toHaveClass("min-h-11");
	});

	it("states the download size from the manifest, in whole megabytes", () => {
		setup();
		const mb = Math.round(EMOJI_DOWNLOAD_BYTES / 1_000_000);
		expect(mb).toBe(49);
		expect(
			screen.getByText(new RegExp(`download of about ${mb} MB and works`)),
		).toBeInTheDocument();
	});
});
