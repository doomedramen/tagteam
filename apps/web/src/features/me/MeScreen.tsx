import { Fingerprint, LogOut } from "lucide-react";
import { authClient } from "../../lib/auth";
import { useSession } from "../../session/session";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";

export function MeScreen() {
	const { me, signOut } = useSession();
	const toast = useToast();
	const addPasskey = async () => {
		try {
			const result = await authClient.passkey.addPasskey();
			toast.show({
				message: result?.error ? "Couldn't add a passkey." : "Passkey added.",
			});
		} catch {
			toast.show({ message: "Couldn't add a passkey." });
		}
	};

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
				<Button block onClick={() => void addPasskey()}>
					<Fingerprint aria-hidden className="size-5" />
					Add a passkey
				</Button>
				<Button variant="danger" block onClick={() => void signOut()}>
					<LogOut aria-hidden className="size-5" />
					Sign out
				</Button>
			</div>
		</div>
	);
}
