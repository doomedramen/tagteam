import { type FormEvent, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError, apiFetch, OfflineError } from "../../lib/api";
import { useSession } from "../../session/session";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";

const MESSAGES: Record<string, string> = {
	invalid_code: "That code isn't valid. Ask for a new one.",
	rate_limited: "Too many tries. Wait a minute and try again.",
	already_member: "You're already in this group.",
};

function describeError(error: unknown): string {
	if (error instanceof OfflineError)
		return "You need to be online to create or join a group.";
	if (error instanceof ApiError)
		return MESSAGES[error.code] ?? error.details?.[0] ?? error.message;
	return "Something went wrong. Try again.";
}

export function WelcomeScreen() {
	const { me, engine, refreshMe, setActiveGroup } = useSession();
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const mode = params.get("mode");
	const [name, setName] = useState("");
	const [code, setCode] = useState("");
	const [error, setError] = useState<{
		form: "create" | "join";
		message: string;
	} | null>(null);
	const [busy, setBusy] = useState<"create" | "join" | null>(null);
	const inFlight = useRef(false);

	const finish = async (groupId: string) => {
		await refreshMe().catch(() => undefined);
		await setActiveGroup(groupId);
		void engine.sync();
		navigate("/", { replace: true });
	};
	const run = async (
		form: "create" | "join",
		action: () => Promise<{ group: { id: string } }>,
	) => {
		if (inFlight.current) return;
		inFlight.current = true;
		setError(null);
		setBusy(form);
		try {
			const { group } = await action();
			await finish(group.id);
		} catch (err) {
			setError({ form, message: describeError(err) });
		} finally {
			inFlight.current = false;
			setBusy(null);
		}
	};
	const create = (event: FormEvent) => {
		event.preventDefault();
		if (!name.trim()) {
			setError({ form: "create", message: "Enter a group name." });
			return;
		}
		void run("create", () =>
			apiFetch<{ group: { id: string } }>("/api/groups", {
				method: "POST",
				body: { name: name.trim() },
			}),
		);
	};
	const join = (event: FormEvent) => {
		event.preventDefault();
		void run("join", () =>
			apiFetch<{ group: { id: string } }>("/api/invites/redeem", {
				method: "POST",
				body: { code },
			}),
		);
	};
	const errorFor = (form: "create" | "join") =>
		error?.form === form ? (
			<p role="alert" className="text-[14px] text-danger">
				{error.message}
			</p>
		) : null;

	return (
		<div className="mx-auto flex min-h-dvh max-w-sm flex-col gap-6 px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]">
			{me.groups.length > 0 ? (
				<Link
					to="/"
					className="min-h-11 self-start py-2 text-[15px] font-medium text-accent"
				>
					Back
				</Link>
			) : null}
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">
					Start a group or join one
				</h1>
				<p className="mt-1 text-[15px] text-text-2">
					Everyone in a group can see each other's tasks.
				</p>
			</div>
			{mode !== "join" ? (
				<form
					onSubmit={create}
					className="flex flex-col gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line"
				>
					<h2 className="font-semibold">Create a group</h2>
					<TextField
						label="Group name"
						placeholder="Smith family"
						maxLength={40}
						required
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
					{errorFor("create")}
					<Button
						type="submit"
						variant="primary"
						block
						busy={busy === "create"}
						disabled={busy !== null}
					>
						Create group
					</Button>
				</form>
			) : null}
			{mode !== "create" ? (
				<form
					onSubmit={join}
					className="flex flex-col gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line"
				>
					<h2 className="font-semibold">Join with a code</h2>
					<TextField
						label="Invite code"
						inputMode="numeric"
						autoComplete="one-time-code"
						pattern="\d{6}"
						maxLength={6}
						placeholder="123456"
						required
						value={code}
						onChange={(event) =>
							setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
						}
						hint="Ask someone in the group for a 6-digit code."
					/>
					{errorFor("join")}
					<Button
						type="submit"
						variant={mode === "join" ? "primary" : "secondary"}
						block
						busy={busy === "join"}
						disabled={busy !== null}
					>
						Join group
					</Button>
				</form>
			) : null}
		</div>
	);
}
