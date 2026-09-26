import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { FieldError } from "@/components/ui/field";
import { authClient } from "../../lib/auth";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";
import { AuthLayout } from "./SignInScreen";

const MIN_PASSWORD = 10;

export function SignUpScreen() {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [tooShort, setTooShort] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		if (password.length < MIN_PASSWORD) return setTooShort(true);
		setBusy(true);
		setError(null);
		try {
			const result = await authClient.signUp.email({
				name: name.trim(),
				email,
				password,
			});
			if (result.error) {
				setError(
					result.error.message ?? "Couldn't create your account. Try again.",
				);
				return;
			}
			window.location.assign("/passkey");
		} catch {
			setError(
				"Couldn't create your account. Check your connection and try again.",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<AuthLayout title="Create your account">
			<form
				onSubmit={(event) => void submit(event)}
				className="flex flex-col gap-4"
			>
				<TextField
					label="Name"
					autoComplete="given-name"
					required
					value={name}
					onChange={(event) => setName(event.target.value)}
				/>
				<TextField
					label="Email"
					type="email"
					autoComplete="email"
					required
					value={email}
					onChange={(event) => setEmail(event.target.value)}
				/>
				<TextField
					label="Password"
					type="password"
					autoComplete="new-password"
					required
					value={password}
					onChange={(event) => {
						setPassword(event.target.value);
						setTooShort(false);
					}}
					hint={tooShort ? undefined : "At least 10 characters"}
					error={tooShort ? "At least 10 characters" : undefined}
				/>
				{error ? (
					<FieldError className="text-[14px]">{error}</FieldError>
				) : null}
				<Button
					type="submit"
					variant="primary"
					block
					busy={busy}
					disabled={busy}
				>
					Create account
				</Button>
			</form>
			<p className="text-center text-[14px] text-text-2">
				<Link to="/sign-in" className="font-medium text-accent">
					I already have an account
				</Link>
			</p>
		</AuthLayout>
	);
}
