import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { FieldError } from "@/components/ui/field";
import { authClient } from "../../lib/auth";
import { Button } from "../../ui/Button";
import { AuthLayout } from "./SignInScreen";

export function AddPasskeyScreen() {
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const add = async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const result = await authClient.passkey.addPasskey();
			if (result?.error) {
				setError(
					result.error.message ??
						"Couldn't add a passkey. You can try again from Me.",
				);
				return;
			}
			navigate("/", { replace: true });
		} catch {
			setError("Couldn't add a passkey. You can try again from Me.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<AuthLayout title="Sign in faster next time">
			<p className="text-center text-[15px] text-text-2">
				Use Face ID, Touch ID or your screen lock instead of typing a password.
			</p>
			{error ? (
				<FieldError className="text-center text-[14px]">{error}</FieldError>
			) : null}
			<Button
				variant="primary"
				block
				busy={busy}
				disabled={busy}
				onClick={() => void add()}
			>
				<Fingerprint aria-hidden className="size-5" />
				Add passkey
			</Button>
			<Button
				variant="ghost"
				block
				disabled={busy}
				onClick={() => navigate("/", { replace: true })}
			>
				Not now
			</Button>
		</AuthLayout>
	);
}
