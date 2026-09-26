import type {
	Serwist as SerwistInstance,
	SerwistLifecycleWaitingEvent,
} from "@serwist/window";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "../ui/Button";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface AppUpdateValue {
	updateAvailable: boolean;
	applyUpdate: () => void;
}

const AppUpdateContext = createContext<AppUpdateValue>({
	updateAvailable: false,
	applyUpdate: () => {},
});

function reloadCurrentPage() {
	window.location.reload();
}

function scheduleUpdateCheck(callback: () => void, intervalMs: number) {
	const interval = window.setInterval(callback, intervalMs);
	return () => window.clearInterval(interval);
}

export function AppUpdateProvider({
	children,
	reloadPage = reloadCurrentPage,
	scheduleCheck = scheduleUpdateCheck,
}: {
	children: ReactNode;
	reloadPage?: () => void;
	scheduleCheck?: (callback: () => void, intervalMs: number) => () => void;
}) {
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const serwistRef = useRef<SerwistInstance | null>(null);
	const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

	useEffect(() => {
		if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

		let active = true;
		let registrationPromise: Promise<void> | null = null;
		const controlledAtStart = navigator.serviceWorker.controller !== null;

		const onWaiting = (event: SerwistLifecycleWaitingEvent) => {
			if (
				event.isUpdate ||
				event.wasWaitingBeforeRegister ||
				event.isExternal
			) {
				setUpdateAvailable(true);
			}
		};
		const onControllerChange = () => {
			if (controlledAtStart) reloadPage();
		};

		const registerOrCheckForUpdate = (): Promise<void> => {
			if (!active) return Promise.resolve();

			if (registrationRef.current) {
				return (
					serwistRef.current?.update().catch(() => {}) ?? Promise.resolve()
				);
			}
			if (registrationPromise) return registrationPromise;

			const pending = (async () => {
				try {
					let client = serwistRef.current;
					if (!client) {
						const { Serwist } = await import("@serwist/window");
						if (!active) return;

						client = new Serwist("/sw.js", { type: "classic" });
						serwistRef.current = client;
						client.addEventListener("waiting", onWaiting);
					}
					const registration = await client.register();
					if (!active) return;
					if (!registration)
						throw new Error("Service worker registration failed");

					registrationRef.current = registration;
					await client.update().catch(() => {});
				} catch {
					if (active) registrationPromise = null;
				}
			})();
			registrationPromise = pending;
			return pending;
		};

		const checkWhenVisible = () => {
			if (document.visibilityState === "visible")
				void registerOrCheckForUpdate();
		};

		// Attach before registration so no controller change can race setup.
		navigator.serviceWorker.addEventListener(
			"controllerchange",
			onControllerChange,
		);
		document.addEventListener("visibilitychange", checkWhenVisible);
		const stopInterval = scheduleCheck(
			checkWhenVisible,
			UPDATE_CHECK_INTERVAL_MS,
		);
		void registerOrCheckForUpdate();

		return () => {
			active = false;
			stopInterval();
			document.removeEventListener("visibilitychange", checkWhenVisible);
			navigator.serviceWorker.removeEventListener(
				"controllerchange",
				onControllerChange,
			);
			serwistRef.current?.removeEventListener("waiting", onWaiting);
			serwistRef.current = null;
			registrationRef.current = null;
		};
	}, [reloadPage, scheduleCheck]);

	const applyUpdate = useCallback(() => {
		const registration = registrationRef.current;
		if (!registration) return;

		if (registration.waiting) {
			serwistRef.current?.messageSkipWaiting();
			return;
		}
		reloadPage();
	}, [reloadPage]);

	const value = useMemo(
		() => ({ updateAvailable, applyUpdate }),
		[updateAvailable, applyUpdate],
	);

	return (
		<AppUpdateContext.Provider value={value}>
			{updateAvailable ? <AppUpdateNotice /> : null}
			{children}
		</AppUpdateContext.Provider>
	);
}

export function useAppUpdate() {
	return useContext(AppUpdateContext);
}

function AppUpdateNotice() {
	const { applyUpdate } = useAppUpdate();

	return (
		<div className="sticky top-0 z-40 bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
			<div
				role="status"
				aria-live="polite"
				className="mx-auto flex min-h-14 max-w-md items-center gap-3 bg-warning-soft px-4 text-[14px] text-warning"
			>
				<span className="min-w-0 flex-1">A new version is available.</span>
				<Button
					variant="ghost"
					onClick={applyUpdate}
					className="min-h-11 rounded-lg px-2 font-semibold text-warning underline-offset-2 hover:bg-warning-soft hover:text-warning hover:underline"
				>
					Reload
				</Button>
			</div>
		</div>
	);
}
