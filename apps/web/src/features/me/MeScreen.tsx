import { Fingerprint, LogOut } from "lucide-react";
import { useState } from "react";
import { authClient } from "../../lib/auth";
import { useSession } from "../../session/session";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";

export function MeScreen() {
	const { me, signOut } = useSession();
	const toast = useToast();
	const passkeyQuery = authClient.useListPasskeys();
	const [addingPasskey, setAddingPasskey] = useState(false);
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
	const passkeys = passkeyQuery.data ?? [];

	return (
		<div className="mt-4 flex flex-col gap-6">
			<div className="flex items-center gap-3">
				<Avatar name={me.profile.displayName} color={me.profile.avatarColor} />
				<div className="min-w-0">
					<p className="truncate text-lg font-semibold">
						{me.profile.displayName}
					</p>
					<p className="truncate text-[14px] text-text-2">{me.user.email}</p>
				</div>
			</div>
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
