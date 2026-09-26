/// <reference lib="webworker" />
import {
	NetworkOnly,
	type PrecacheEntry,
	type RuntimeCaching,
	Serwist,
} from "serwist";

declare const self: ServiceWorkerGlobalScope & {
	__SW_MANIFEST: (PrecacheEntry | string)[];
};

const runtimeCaching: RuntimeCaching[] = [
	// API calls always go to the network; the app handles offline itself.
	{
		matcher: ({ url }) => url.pathname.startsWith("/api/"),
		handler: new NetworkOnly(),
	},
];

const serwist = new Serwist({
	precacheEntries: self.__SW_MANIFEST,
	precacheOptions: {
		navigateFallback: "/index.html",
		navigateFallbackDenylist: [/^\/api(?:\/|$)/],
	},
	skipWaiting: false,
	clientsClaim: true,
	navigationPreload: true,
	runtimeCaching,
});

serwist.addEventListeners();

self.addEventListener("push", (event) => {
	const message = (() => {
		try {
			return event.data?.json() as {
				title?: unknown;
				body?: unknown;
				url?: unknown;
			};
		} catch {
			return {};
		}
	})();
	const title = typeof message.title === "string" ? message.title : "TagTeam";
	event.waitUntil(
		self.registration.showNotification(title, {
			body:
				typeof message.body === "string"
					? message.body
					: "You have a task update.",
			icon: "/icons/icon-192.png",
			badge: "/icons/icon-192.png",
			data: { url: typeof message.url === "string" ? message.url : "/" },
		}),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	event.waitUntil(
		(async () => {
			const target = new URL(
				typeof event.notification.data?.url === "string"
					? event.notification.data.url
					: "/",
				self.location.origin,
			);
			if (target.origin !== self.location.origin) return;
			const windows = await self.clients.matchAll({
				type: "window",
				includeUncontrolled: true,
			});
			for (const client of windows) {
				const windowClient = client as WindowClient;
				await windowClient.navigate(target.href);
				await windowClient.focus();
				return;
			}
			await self.clients.openWindow(target.href);
		})(),
	);
});
