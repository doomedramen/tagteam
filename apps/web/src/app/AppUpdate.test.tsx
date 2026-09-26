import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateProvider } from "./AppUpdate";

const ONE_HOUR_MS = 60 * 60 * 1000;

const serwistMock = vi.hoisted(() => ({
	created: vi.fn(),
	register: vi.fn(),
	update: vi.fn(),
	messageSkipWaiting: vi.fn(),
	waitingHandler: null as
		| ((event: {
				isUpdate?: boolean;
				isExternal?: boolean;
				wasWaitingBeforeRegister?: boolean;
		  }) => void)
		| null,
}));

vi.mock("@serwist/window", () => ({
	Serwist: class {
		constructor() {
			serwistMock.created();
		}

		addEventListener(
			_type: string,
			listener: (event: {
				isUpdate?: boolean;
				isExternal?: boolean;
				wasWaitingBeforeRegister?: boolean;
			}) => void,
		) {
			serwistMock.waitingHandler = listener;
		}

		removeEventListener() {
			serwistMock.waitingHandler = null;
		}

		register() {
			return serwistMock.register();
		}

		update() {
			return serwistMock.update();
		}

		messageSkipWaiting() {
			serwistMock.messageSkipWaiting();
		}
	},
}));

const originalServiceWorker = Object.getOwnPropertyDescriptor(
	navigator,
	"serviceWorker",
);

function mockServiceWorkerContainer(controlled: boolean) {
	const listeners = new Map<string, EventListener>();
	const container = {
		controller: controlled ? ({} as ServiceWorker) : null,
		addEventListener: vi.fn((type: string, listener: EventListener) => {
			listeners.set(type, listener);
		}),
		removeEventListener: vi.fn((type: string) => {
			listeners.delete(type);
		}),
	};
	Object.defineProperty(navigator, "serviceWorker", {
		configurable: true,
		value: container,
	});
	return {
		emit(type: string) {
			listeners.get(type)?.(new Event(type));
		},
	};
}

describe("AppUpdateProvider", () => {
	beforeEach(() => {
		vi.stubEnv("PROD", true);
		serwistMock.created.mockClear();
		serwistMock.register.mockReset().mockResolvedValue({
			waiting: { postMessage: vi.fn() },
		} as unknown as ServiceWorkerRegistration);
		serwistMock.update.mockReset().mockResolvedValue(undefined);
		serwistMock.messageSkipWaiting.mockReset();
		serwistMock.waitingHandler = null;
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		if (originalServiceWorker) {
			Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
		} else {
			Reflect.deleteProperty(navigator, "serviceWorker");
		}
	});

	it("does not register a service worker in development", async () => {
		vi.stubEnv("PROD", false);
		mockServiceWorkerContainer(false);
		render(
			<AppUpdateProvider>
				<p>App</p>
			</AppUpdateProvider>,
		);

		await act(async () => {});
		expect(serwistMock.created).not.toHaveBeenCalled();
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("prompts for an update and reloads only after the worker takes control", async () => {
		const serviceWorker = mockServiceWorkerContainer(true);
		const reloadPage = vi.fn();
		render(
			<AppUpdateProvider reloadPage={reloadPage}>
				<p>App</p>
			</AppUpdateProvider>,
		);
		await waitFor(() => expect(serwistMock.register).toHaveBeenCalledOnce());
		expect(screen.queryByRole("status")).not.toBeInTheDocument();

		act(() => serwistMock.waitingHandler?.({ isUpdate: false }));
		expect(screen.queryByRole("status")).not.toBeInTheDocument();

		act(() => serwistMock.waitingHandler?.({ isUpdate: true }));
		expect(screen.getByRole("status")).toHaveTextContent(
			"A new version is available.",
		);

		fireEvent.click(screen.getByRole("button", { name: "Reload" }));
		expect(serwistMock.messageSkipWaiting).toHaveBeenCalledOnce();
		expect(reloadPage).not.toHaveBeenCalled();

		serviceWorker.emit("controllerchange");
		expect(reloadPage).toHaveBeenCalledOnce();
	});

	it("shows a worker that was already waiting at app start", async () => {
		mockServiceWorkerContainer(true);
		render(
			<AppUpdateProvider>
				<p>App</p>
			</AppUpdateProvider>,
		);
		await waitFor(() => expect(serwistMock.register).toHaveBeenCalledOnce());

		act(() => serwistMock.waitingHandler?.({ wasWaitingBeforeRegister: true }));
		expect(screen.getByRole("status")).toHaveTextContent(
			"A new version is available.",
		);
	});

	it("retries failed checks on foreground and checks hourly only while visible", async () => {
		serwistMock.update.mockRejectedValueOnce(new Error("offline"));
		mockServiceWorkerContainer(true);
		let intervalCallback: (() => void) | null = null;
		const scheduleCheck = vi.fn((callback: () => void) => {
			intervalCallback = callback;
			return vi.fn();
		});
		let visibility: DocumentVisibilityState = "visible";
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => visibility,
		});
		render(
			<AppUpdateProvider scheduleCheck={scheduleCheck}>
				<p>App</p>
			</AppUpdateProvider>,
		);
		await waitFor(() => expect(serwistMock.register).toHaveBeenCalledOnce());
		await waitFor(() => expect(serwistMock.update).toHaveBeenCalledOnce());
		expect(scheduleCheck).toHaveBeenCalledWith(
			expect.any(Function),
			ONE_HOUR_MS,
		);
		expect(screen.queryByRole("status")).not.toBeInTheDocument();

		visibility = "hidden";
		act(() => intervalCallback?.());
		expect(serwistMock.update).toHaveBeenCalledOnce();

		visibility = "visible";
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		await waitFor(() => expect(serwistMock.update).toHaveBeenCalledTimes(2));

		act(() => intervalCallback?.());
		await waitFor(() => expect(serwistMock.update).toHaveBeenCalledTimes(3));
	});
});
