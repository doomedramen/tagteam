import webPush from "web-push";
import type { Config } from "../config";

export interface PushTransport {
	publicKey: string;
	send(subscription: webPush.PushSubscription, payload: string): Promise<void>;
}

export function createPushTransport(
	vapid: NonNullable<Config["vapid"]>,
): PushTransport {
	return {
		publicKey: vapid.publicKey,
		send: async (subscription, payload) => {
			await webPush.sendNotification(subscription, payload, {
				vapidDetails: vapid,
				TTL: 60 * 60,
				urgency: "high",
				timeout: 10_000,
			});
		},
	};
}
