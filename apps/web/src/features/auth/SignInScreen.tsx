import { KeyRound } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link } from "react-router";
import { FieldError } from "@/components/ui/field";
import { authClient } from "../../lib/auth";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";

export function AuthLayout({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
			<div className="flex flex-col items-center gap-3 text-center">
				<img src="/icon.svg" alt="" className="size-14 rounded-2xl" />
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
			</div>
			{children}
		</div>
	);
}

export function SignInScreen() {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<"password" | "passkey" | null>(null);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setBusy("password");
		setError(null);
		try {
			const result = await authClient.signIn.email({ email, password });
			if (result.error) {
				setError(result.error.message ?? "Couldn't sign in. Try again.");
				return;
			}
			window.location.assign("/");
		} catch {
			setError("Couldn't sign in. Check your connection and try again.");
		} finally {
			setBusy(null);
		}
	};

	const passkey = async () => {
		if (busy) return;
		setBusy("passkey");
		setError(null);
		try {
			const result = await authClient.signIn.passkey();
			if (result?.error) {
				setError(
					result.error.message ?? "Couldn't use a passkey. Try your password.",
				);
				return;
			}
			window.location.assign("/");
		} catch {
			setError("Couldn't use a passkey. Try your password.");
		} finally {
			setBusy(null);
		}
	};

	return (
		<AuthLayout title="Sign in to TagTeam">
			<form
				onSubmit={(event) => void submit(event)}
				className="flex flex-col gap-4"
			>
				<TextField
					label="Email"
					type="email"
					autoComplete="username webauthn"
					required
					value={email}
					onChange={(event) => setEmail(event.target.value)}
				/>
				<TextField
					label="Password"
					type="password"
					autoComplete="current-password"
					required
					value={password}
					onChange={(event) => setPassword(event.target.value)}
				/>
				{error ? (
					<FieldError className="text-[14px]">{error}</FieldError>
				) : null}
				<Button
					type="submit"
					variant="primary"
					block
					busy={busy === "password"}
					disabled={busy !== null}
				>
					Sign in
				</Button>
			</form>
			<Button
				variant="secondary"
				block
				busy={busy === "passkey"}
				disabled={busy !== null}
				onClick={() => void passkey()}
			>
				<KeyRound aria-hidden className="size-4" />
				Use a passkey
			</Button>
			<p className="text-center text-[14px] text-text-2">
				New here?{" "}
				<Link to="/sign-up" className="font-medium text-accent">
					Create an account
				</Link>
			</p>
		</AuthLayout>
	);
}
