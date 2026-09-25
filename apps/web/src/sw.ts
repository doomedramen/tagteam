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
	skipWaiting: true,
	clientsClaim: true,
	navigationPreload: true,
	runtimeCaching,
});

serwist.addEventListeners();
