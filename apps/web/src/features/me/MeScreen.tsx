import { Fingerprint, LogOut, Pencil, X } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
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
				<form
					onSubmit={(event) => void saveProfile(event)}
					className="flex flex-col gap-4 rounded-2xl bg-surface p-4 ring-1 ring-line"
				>
					<div className="flex items-center justify-between">
						<h2 className="text-[15px] font-semibold">Edit profile</h2>
						<Button
							aria-label="Cancel profile edit"
							variant="ghost"
							className="size-10 px-0"
							onClick={cancelProfileEdit}
						>
							<X aria-hidden className="size-4" />
						</Button>
					</div>
					<div className="flex flex-col gap-1.5">
						<label htmlFor="profile-name" className="text-[13px] text-text-2">
							Display name
						</label>
						<input
							id="profile-name"
							value={displayName}
							maxLength={40}
							autoComplete="name"
							onChange={(event) => setDisplayName(event.target.value)}
							className="min-h-11 rounded-xl bg-bg px-3 ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-accent"
						/>
					</div>
					<fieldset>
						<legend className="mb-2 text-[13px] text-text-2">
							Avatar color
						</legend>
						<div className="flex flex-wrap gap-3">
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
								<button
									key={color}
									type="button"
									aria-label={`${color} avatar color`}
									aria-pressed={avatarColor === color}
									onClick={() => setAvatarColor(color)}
									className={`avatar-${color} size-9 rounded-full ring-2 ring-offset-2 ring-offset-surface ${avatarColor === color ? "ring-accent" : "ring-transparent"}`}
								/>
							))}
						</div>
					</fieldset>
					<div className="flex gap-2">
						<Button
							type="button"
							variant="secondary"
							block
							onClick={cancelProfileEdit}
						>
							Cancel
						</Button>
						<Button type="submit" variant="primary" block busy={savingProfile}>
							Save profile
						</Button>
					</div>
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
						<p role="alert" className="text-[14px] text-danger">
							Couldn't load passkey status.
						</p>
						<Button onClick={() => void passkeyQuery.refetch()}>Retry</Button>
					</div>
				) : passkeys.length > 0 ? (
					<div className="rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
						<p className="font-medium">
							{passkeys.length} {passkeys.length === 1 ? "passkey" : "passkeys"}{" "}
							added
						</p>
						<p className="mt-1 text-[13px] text-text-2">
							You can use {passkeys.length === 1 ? "it" : "them"} to sign in.
						</p>
					</div>
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
