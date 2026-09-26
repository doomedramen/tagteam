import { Fingerprint, LogOut, Pencil, X } from "lucide-react";
import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiFetch } from "../../lib/api";
import { authClient } from "../../lib/auth";
import { useSession } from "../../session/session";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { NotificationSettings } from "./NotificationSettings";

export function MeScreen() {
	const { me, signOut, refreshMe } = useSession();
	const toast = useToast();
	const passkeyQuery = authClient.useListPasskeys();
	const [addingPasskey, setAddingPasskey] = useState(false);
	const [editingProfile, setEditingProfile] = useState(false);
	const [displayName, setDisplayName] = useState(me.profile.displayName);
	const [avatarColor, setAvatarColor] = useState(me.profile.avatarColor);
	const [savingProfile, setSavingProfile] = useState(false);
	const addPasskey = async () => {
		if (addingPasskey) return;
		setAddingPasskey(true);
		try {
			const result = await authClient.passkey.addPasskey();
			if (result.error) {
				toast.show({ message: "Couldn't add a passkey." });
				return;
			}
			await passkeyQuery.refetch();
			toast.show({ message: "Passkey added." });
		} catch {
			toast.show({ message: "Couldn't add a passkey." });
		} finally {
			setAddingPasskey(false);
		}
	};
	const saveProfile = async (event: FormEvent) => {
		event.preventDefault();
		if (savingProfile) return;
		const name = displayName.trim();
		if (name.length < 1 || name.length > 40) {
			toast.show({ message: "Name must be 1–40 characters." });
			return;
		}
		setSavingProfile(true);
		try {
			await apiFetch("/api/me", {
				method: "PATCH",
				body: { displayName: name, avatarColor },
			});
			await refreshMe();
			setEditingProfile(false);
			toast.show({ message: "Profile updated." });
		} catch {
			toast.show({ message: "Couldn't update your profile. Try again." });
		} finally {
			setSavingProfile(false);
		}
	};
	const cancelProfileEdit = () => {
		setDisplayName(me.profile.displayName);
		setAvatarColor(me.profile.avatarColor);
		setEditingProfile(false);
	};
	const passkeys = passkeyQuery.data ?? [];

	return (
		<div className="mt-4 flex flex-col gap-6">
			<div className="flex items-center gap-3">
				<Avatar name={me.profile.displayName} color={me.profile.avatarColor} />
				<div className="min-w-0 flex-1">
					<p className="truncate text-lg font-semibold">
						{me.profile.displayName}
					</p>
					<p className="truncate text-[14px] text-text-2">{me.user.email}</p>
				</div>
				{!editingProfile ? (
					<Button
						aria-label="Edit profile"
						variant="ghost"
						className="size-11 shrink-0 px-0"
						onClick={() => setEditingProfile(true)}
					>
						<Pencil aria-hidden className="size-4" />
					</Button>
				) : null}
			</div>
			{editingProfile ? (
				<form onSubmit={(event) => void saveProfile(event)}>
					<Card className="gap-4 rounded-2xl p-4 ring-line">
						<CardHeader className="flex flex-row items-center justify-between p-0">
							<CardTitle className="text-[15px] font-semibold">
								Edit profile
							</CardTitle>
							<Button
								aria-label="Cancel profile edit"
								variant="ghost"
								className="size-10 px-0"
								onClick={cancelProfileEdit}
							>
								<X aria-hidden className="size-4" />
							</Button>
						</CardHeader>
						<CardContent className="flex flex-col gap-4 p-0">
							<FieldGroup className="gap-4">
								<Field className="gap-1.5">
									<FieldLabel
										htmlFor="profile-name"
										className="text-[13px] text-text-2"
									>
										Display name
									</FieldLabel>
									<Input
										id="profile-name"
										value={displayName}
										maxLength={40}
										autoComplete="name"
										onChange={(event) => setDisplayName(event.target.value)}
										className="min-h-11 bg-bg"
									/>
								</Field>
								<FieldSet className="gap-2">
									<FieldLegend
										variant="label"
										className="mb-0 text-[13px] text-text-2"
									>
										Avatar color
									</FieldLegend>
									<ToggleGroup
										value={[avatarColor]}
										aria-label="Avatar color"
										onValueChange={([value]) => value && setAvatarColor(value)}
										className="flex-wrap justify-start gap-3 rounded-none"
									>
										{[
											"blue",
											"green",
											"amber",
											"coral",
											"purple",
											"teal",
											"pink",
											"gray",
										].map((color) => (
											<ToggleGroupItem
												key={color}
												value={color}
												aria-label={`${color} avatar color`}
												style={
													{
														"--avatar-color": `var(--av-${color})`,
													} as CSSProperties
												}
												className={`avatar-${color} size-9 rounded-full p-0 ring-2 ring-offset-2 ring-offset-surface hover:opacity-90 data-[state=on]:bg-(--avatar-color) data-[state=off]:bg-(--avatar-color) data-[state=on]:ring-accent data-[state=off]:ring-transparent`}
											>
												<span className="sr-only">{color}</span>
											</ToggleGroupItem>
										))}
									</ToggleGroup>
								</FieldSet>
							</FieldGroup>
							<div className="flex gap-2">
								<Button
									type="button"
									variant="secondary"
									block
									onClick={cancelProfileEdit}
								>
									Cancel
								</Button>
								<Button
									type="submit"
									variant="primary"
									block
									busy={savingProfile}
								>
									Save profile
								</Button>
							</div>
						</CardContent>
					</Card>
				</form>
			) : null}
			<NotificationSettings />
			<div className="flex flex-col gap-3">
				{passkeyQuery.isPending ? (
					<p role="status" className="text-[14px] text-text-2">
						Checking passkeys…
					</p>
				) : passkeyQuery.error ? (
					<div className="flex items-center justify-between gap-3">
						<FieldError className="text-[14px]">
							Couldn't load passkey status.
						</FieldError>
						<Button onClick={() => void passkeyQuery.refetch()}>Retry</Button>
					</div>
				) : passkeys.length > 0 ? (
					<Card className="gap-0 rounded-2xl py-0 ring-line">
						<CardContent className="px-4 py-3">
							<p className="font-medium">
								{passkeys.length}{" "}
								{passkeys.length === 1 ? "passkey" : "passkeys"} added
							</p>
							<p className="mt-1 text-[13px] text-text-2">
								You can use {passkeys.length === 1 ? "it" : "them"} to sign in.
							</p>
						</CardContent>
					</Card>
				) : null}
				{!passkeyQuery.isPending && !passkeyQuery.error ? (
					<Button
						block
						busy={addingPasskey}
						disabled={addingPasskey}
						onClick={() => void addPasskey()}
					>
						<Fingerprint aria-hidden className="size-5" />
						{passkeys.length > 0 ? "Add another passkey" : "Add a passkey"}
					</Button>
				) : null}
				<Button variant="danger" block onClick={() => void signOut()}>
					<LogOut aria-hidden className="size-5" />
					Sign out
				</Button>
			</div>
		</div>
	);
}
