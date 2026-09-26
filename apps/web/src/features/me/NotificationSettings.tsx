import { Bell, BellOff } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ApiError, apiFetch } from "../../lib/api";
import { browserTimeZone } from "../../lib/time";
import { useSession } from "../../session/session";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";

interface PushSettings {
	remindersEnabled: boolean;
	nudgesEnabled: boolean;
	quietHoursStart: string;
	quietHoursEnd: string;
}

interface PushStatus {
	configured: boolean;
	publicKey: string | null;
	settings: PushSettings;
	subscriptionCount: number;
}

const supported = () =>
	typeof window !== "undefined" &&
	"Notification" in window &&
	"serviceWorker" in navigator &&
	"PushManager" in window;

const needsIosHomeScreen = () => {
	if (
		typeof window === "undefined" ||
		!/iPad|iPhone|iPod/.test(navigator.userAgent)
	)
		return false;
	const standalone = (navigator as Navigator & { standalone?: boolean })
		.standalone;
	return (
		!standalone && !window.matchMedia("(display-mode: standalone)").matches
	);
};

function applicationServerKey(key: string): Uint8Array<ArrayBuffer> {
	const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function deviceLabel(): string {
	const agent = navigator.userAgent;
	if (/iPad|iPhone|iPod/.test(agent)) return "iPhone or iPad";
	if (/Android/.test(agent)) return "Android device";
	return "This device";
}

export function NotificationSettings() {
	const { me, refreshMe } = useSession();
	const toast = useToast();
	const [status, setStatus] = useState<PushStatus | null>(null);
	const [subscription, setSubscription] = useState<PushSubscription | null>(
		null,
	);
	const [serviceWorkerReady, setServiceWorkerReady] = useState(false);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [savingTimezone, setSavingTimezone] = useState(false);
	const [error, setError] = useState(false);

	const refresh = useCallback(async () => {
		setError(false);
		try {
			const next = await apiFetch<PushStatus>("/api/push");
			setStatus(next);
			if (supported()) {
				const registration = await navigator.serviceWorker.getRegistration();
				setServiceWorkerReady(Boolean(registration));
				setSubscription(
					registration
						? await registration.pushManager.getSubscription()
						: null,
				);
			}
		} catch {
			setError(true);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const enable = async () => {
		if (!status?.configured || !status.publicKey || busy) return;
		if (!supported() || !window.isSecureContext) {
			toast.show({ message: "Push notifications are not supported here." });
			return;
		}
		setBusy(true);
		try {
			const registration = await navigator.serviceWorker.getRegistration();
			if (!registration) {
				toast.show({
					message: "Open TagTeam as an installed app to enable push.",
				});
				return;
			}
			let permission = Notification.permission;
			if (permission === "default")
				permission = await Notification.requestPermission();
			if (permission !== "granted") {
				toast.show({
					message: "Allow notifications in your browser settings.",
				});
				return;
			}
			const next =
				(await registration.pushManager.getSubscription()) ??
				(await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: applicationServerKey(status.publicKey),
				}));
			await apiFetch("/api/push/subscriptions", {
				method: "POST",
				body: { subscription: next.toJSON(), deviceLabel: deviceLabel() },
			});
			setSubscription(next);
			await refresh();
			toast.show({ message: "Push notifications enabled on this device." });
		} catch (cause) {
			const message =
				cause instanceof ApiError && cause.status === 503
					? "Push notifications are not configured on this server."
					: "Couldn't enable push notifications. Try again.";
			toast.show({ message });
		} finally {
			setBusy(false);
		}
	};

	const disable = async () => {
		if (!subscription || busy) return;
		setBusy(true);
		try {
			await apiFetch("/api/push/subscriptions", {
				method: "DELETE",
				body: { endpoint: subscription.endpoint },
			});
			await subscription.unsubscribe();
			setSubscription(null);
			await refresh();
			toast.show({ message: "Push notifications disabled on this device." });
		} catch {
			toast.show({
				message: "Couldn't disable push notifications. Try again.",
			});
		} finally {
			setBusy(false);
		}
	};

	const updateSettings = async (patch: Partial<PushSettings>) => {
		if (!status || busy) return;
		const previous = status.settings;
		setStatus({ ...status, settings: { ...previous, ...patch } });
		setBusy(true);
		try {
			const result = await apiFetch<{ settings: PushSettings }>(
				"/api/push/settings",
				{ method: "PATCH", body: patch },
			);
			setStatus((current) =>
				current ? { ...current, settings: result.settings } : current,
			);
		} catch {
			setStatus((current) =>
				current ? { ...current, settings: previous } : current,
			);
			toast.show({ message: "Couldn't save notification settings." });
		} finally {
			setBusy(false);
		}
	};

	const updateToDeviceTimezone = async () => {
		if (savingTimezone) return;
		setSavingTimezone(true);
		try {
			await apiFetch("/api/me", {
				method: "PATCH",
				body: { timezone: browserTimeZone() },
			});
			await refreshMe();
			toast.show({ message: "Timezone updated." });
		} catch {
			toast.show({ message: "Couldn't update your timezone." });
		} finally {
			setSavingTimezone(false);
		}
	};

	return (
		<section className="flex flex-col gap-3">
			<div>
				<h2 className="text-[15px] font-semibold">Notifications</h2>
				<p className="mt-1 text-[13px] text-text-2">
					Choose reminders and quiet hours for this account.
				</p>
			</div>
			{loading ? (
				<p role="status" className="text-[14px] text-text-2">
					Loading notification settings…
				</p>
			) : error || !status ? (
				<div className="flex items-center justify-between gap-3">
					<FieldError className="text-[14px]">
						Couldn't load notification settings.
					</FieldError>
					<Button onClick={() => void refresh()}>Retry</Button>
				</div>
			) : !status.configured ? (
				<Card className="gap-0 rounded-2xl py-0 ring-line">
					<CardContent className="px-4 py-3 text-[14px] text-text-2">
						Push notifications are not configured on this server yet.
					</CardContent>
				</Card>
			) : (
				<Card className="gap-3 rounded-2xl p-4 ring-line">
					<CardContent className="flex flex-col gap-3 p-0">
						{!supported() ? (
							<p className="text-[14px] text-text-2">
								This browser does not support push notifications.
							</p>
						) : !window.isSecureContext ? (
							<p className="text-[14px] text-text-2">
								Push notifications require a secure connection.
							</p>
						) : needsIosHomeScreen() ? (
							<p className="text-[14px] text-text-2">
								On iPhone or iPad, add TagTeam to your Home Screen to enable
								push.
							</p>
						) : !serviceWorkerReady ? (
							<p className="text-[14px] text-text-2">
								Open the installed TagTeam app to enable push on this device.
							</p>
						) : subscription ? (
							<div className="flex items-center gap-3">
								<Bell aria-hidden className="size-5 shrink-0 text-accent" />
								<p className="min-w-0 flex-1 text-[14px]">
									Push enabled on this device
								</p>
								<Button disabled={busy} onClick={() => void disable()}>
									<BellOff aria-hidden className="size-4" />
									Turn off
								</Button>
							</div>
						) : (
							<div className="flex items-center gap-3">
								<BellOff aria-hidden className="size-5 shrink-0 text-text-2" />
								<p className="min-w-0 flex-1 text-[14px] text-text-2">
									Push is off on this device
								</p>
								<Button disabled={busy} onClick={() => void enable()}>
									Enable
								</Button>
							</div>
						)}
						{status.subscriptionCount > (subscription ? 1 : 0) ? (
							<p className="text-[12px] text-text-3">
								Also enabled on{" "}
								{status.subscriptionCount - (subscription ? 1 : 0)} other
								devices.
							</p>
						) : null}
						<FieldGroup className="gap-3 border-t border-line pt-3">
							<SettingToggle
								label="Task reminders"
								description="When tasks are due or overdue"
								checked={status.settings.remindersEnabled}
								disabled={busy}
								onChange={(checked) =>
									void updateSettings({ remindersEnabled: checked })
								}
							/>
							<SettingToggle
								label="Nudges from your team"
								description="A teammate nudges you about a task"
								checked={status.settings.nudgesEnabled}
								disabled={busy}
								onChange={(checked) =>
									void updateSettings({ nudgesEnabled: checked })
								}
							/>
							<FieldSet className="gap-2">
								<FieldLegend variant="label" className="mb-0 text-[14px]">
									Quiet hours
								</FieldLegend>
								<Field
									orientation="horizontal"
									className="flex-wrap gap-2 text-[13px] text-text-2"
								>
									<FieldLabel htmlFor="quiet-hours-start" className="w-auto">
										From
									</FieldLabel>
									<TimeInput
										id="quiet-hours-start"
										value={status.settings.quietHoursStart}
										disabled={busy}
										onSave={(value) =>
											void updateSettings({ quietHoursStart: value })
										}
									/>
									<FieldLabel htmlFor="quiet-hours-end" className="w-auto">
										to
									</FieldLabel>
									<TimeInput
										id="quiet-hours-end"
										value={status.settings.quietHoursEnd}
										disabled={busy}
										onSave={(value) =>
											void updateSettings({ quietHoursEnd: value })
										}
									/>
								</Field>
								<p className="text-[12px] text-text-3">
									Reminders wait until quiet hours end. Nudges arrive right
									away.
								</p>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<p className="text-[12px] text-text-3">
										Quiet hours use {me.profile.timezone}.
									</p>
									{me.profile.timezone !== browserTimeZone() ? (
										<Button
											className="min-h-9 px-3 text-[13px]"
											disabled={savingTimezone}
											onClick={() => void updateToDeviceTimezone()}
										>
											Use this device’s timezone
										</Button>
									) : null}
								</div>
							</FieldSet>
						</FieldGroup>
					</CardContent>
				</Card>
			)}
		</section>
	);
}

function SettingToggle({
	label,
	description,
	checked,
	disabled,
	onChange,
}: {
	label: string;
	description: string;
	checked: boolean;
	disabled: boolean;
	onChange: (checked: boolean) => void;
}) {
	const id = useId();
	return (
		<Field orientation="horizontal" className="items-center gap-3">
			<FieldContent className="min-w-0 gap-0.5">
				<FieldLabel htmlFor={id} className="w-auto text-[14px] font-medium">
					{label}
				</FieldLabel>
				<FieldDescription className="text-[12px] text-text-3">
					{description}
				</FieldDescription>
			</FieldContent>
			<Switch
				id={id}
				aria-label={label}
				checked={checked}
				disabled={disabled}
				onCheckedChange={onChange}
			/>
		</Field>
	);
}

function TimeInput({
	id,
	value,
	disabled,
	onSave,
}: {
	id: string;
	value: string;
	disabled: boolean;
	onSave: (value: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	return (
		<Input
			id={id}
			type="time"
			value={draft}
			disabled={disabled}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={(event) => {
				if (event.target.value !== value) onSave(event.target.value);
			}}
			className="min-h-11 w-auto bg-bg px-3 text-base text-text disabled:opacity-50"
		/>
	);
}
