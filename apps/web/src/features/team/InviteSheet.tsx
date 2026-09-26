import type { InviteDto } from "@tagteam/core";
import { Copy, Share2, UserRoundPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError, apiFetch, OfflineError } from "../../lib/api";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { useToast } from "../../ui/Toast";

type CreatedInvite = Pick<InviteDto, "code" | "expiresAt">;

function inviteError(error: unknown): string {
	if (error instanceof OfflineError) return "Connect to manage invite codes.";
	if (error instanceof ApiError) return error.message;
	return "Could not load invite codes. Try again.";
}

function expiresIn(expiresAt: number, now: number): string {
	const days = Math.max(
		1,
		Math.min(7, Math.ceil((expiresAt - now) / 86_400_000)),
	);
	return `Expires in ${days} ${days === 1 ? "day" : "days"}`;
}

export function InviteSheet({
	open,
	onClose,
	groupId,
	groupName,
	now,
}: {
	open: boolean;
	onClose: () => void;
	groupId: string;
	groupName: string;
	now: number;
}) {
	const toast = useToast();
	const [invites, setInvites] = useState<InviteDto[]>([]);
	const [latest, setLatest] = useState<InviteDto | null>(null);
	const [loading, setLoading] = useState(false);
	const [creating, setCreating] = useState(false);
	const [revoking, setRevoking] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await apiFetch<{ invites: InviteDto[] }>(
				`/api/groups/${encodeURIComponent(groupId)}/invites`,
			);
			setInvites(result.invites);
		} catch (err) {
			setError(inviteError(err));
		} finally {
			setLoading(false);
		}
	}, [groupId]);

	useEffect(() => {
		if (open) {
			setLatest(null);
			void refresh();
		}
	}, [open, refresh]);

	const create = async () => {
		setCreating(true);
		setError(null);
		try {
			const result = await apiFetch<CreatedInvite>(
				`/api/groups/${encodeURIComponent(groupId)}/invites`,
				{ method: "POST" },
			);
			const invite: InviteDto = { ...result, createdAt: now };
			setInvites((current) => [invite, ...current]);
			setLatest(invite);
		} catch (err) {
			setError(inviteError(err));
		} finally {
			setCreating(false);
		}
	};

	const copy = async (code: string) => {
		try {
			await navigator.clipboard.writeText(code);
			toast.show({ message: "Invite code copied." });
		} catch {
			toast.show({ message: "Copy failed. Select the code to copy it." });
		}
	};

	const share = async (code: string) => {
		if (!navigator.share) {
			await copy(code);
			return;
		}
		try {
			await navigator.share({
				title: `Join ${groupName}`,
				text: `Use this single-use TagTeam code to join ${groupName}: ${code}`,
			});
		} catch (err) {
			if (!(err instanceof DOMException && err.name === "AbortError"))
				toast.show({ message: "Could not share the invite code." });
		}
	};

	const revoke = async (code: string) => {
		setRevoking(code);
		setError(null);
		try {
			await apiFetch<void>(`/api/invites/${encodeURIComponent(code)}`, {
				method: "DELETE",
			});
			setInvites((current) => current.filter((invite) => invite.code !== code));
			if (latest?.code === code) setLatest(null);
		} catch (err) {
			setError(inviteError(err));
		} finally {
			setRevoking(null);
		}
	};
	const pendingInvites = invites.filter(
		(invite) => invite.code !== latest?.code,
	);

	return (
		<Sheet
			open={open}
			onClose={onClose}
			label="Invite someone"
			showCloseButton={false}
		>
			<div className="mb-4 flex items-center justify-between">
				<div>
					<h2 className="text-xl font-semibold">Invite someone</h2>
					<p className="mt-1 text-[14px] text-text-2">
						Codes work once and expire after seven days.
					</p>
				</div>
				<Button
					variant="ghost"
					aria-label="Close invite sheet"
					onClick={onClose}
					className="size-11 rounded-full px-0 text-text-2"
				>
					<X aria-hidden className="size-5" />
				</Button>
			</div>

			{latest ? (
				<Card className="mb-4 gap-0 rounded-2xl border-0 bg-accent-soft p-4 shadow-none ring-0">
					<CardContent className="p-0">
						<div className="flex items-center gap-2 text-[13px] font-medium text-text-2">
							<UserRoundPlus aria-hidden className="size-4" />
							New single-use code
						</div>
						<p className="mt-2 font-mono text-3xl font-semibold tracking-[0.18em] text-text">
							{latest.code}
						</p>
						<p className="mt-1 text-[13px] text-text-2">
							{expiresIn(latest.expiresAt, now)}
						</p>
						<div className="mt-3 flex gap-2">
							<Button block onClick={() => void copy(latest.code)}>
								<Copy aria-hidden className="size-4" />
								Copy code
							</Button>
							<Button block onClick={() => void share(latest.code)}>
								<Share2 aria-hidden className="size-4" />
								Share
							</Button>
						</div>
						<Button
							variant="danger"
							block
							className="mt-2"
							busy={revoking === latest.code}
							disabled={revoking !== null}
							onClick={() => void revoke(latest.code)}
						>
							Revoke code
						</Button>
					</CardContent>
				</Card>
			) : null}

			{error ? (
				<Alert variant="destructive" className="mb-3">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}

			<Button
				variant="primary"
				block
				busy={creating}
				disabled={creating || loading}
				onClick={() => void create()}
			>
				<UserRoundPlus aria-hidden className="size-5" />
				Generate code
			</Button>

			<div className="mt-5">
				<h3 className="text-[14px] font-semibold">Your pending codes</h3>
				{loading ? (
					<p className="mt-2 text-[14px] text-text-2">Loading codes…</p>
				) : pendingInvites.length > 0 ? (
					<Card className="mt-2 gap-0 rounded-2xl p-0 ring-line">
						<CardContent className="p-0">
							<ul className="divide-y divide-line">
								{pendingInvites.map((invite) => (
									<li
										key={invite.code}
										className="flex min-h-14 items-center gap-3 px-3 py-2"
									>
										<span className="font-mono text-[17px] font-semibold tracking-wider">
											{invite.code}
										</span>
										<span className="min-w-0 flex-1 text-[13px] text-text-2">
											{expiresIn(invite.expiresAt, now)}
										</span>
										<Button
											variant="ghost"
											aria-label={`Revoke code ${invite.code}`}
											className="size-11 shrink-0 rounded-full px-0 text-danger hover:bg-danger-soft"
											disabled={revoking !== null}
											onClick={() => void revoke(invite.code)}
										>
											{revoking === invite.code ? (
												<span className="sr-only">Revoking</span>
											) : (
												<X aria-hidden className="size-5" />
											)}
										</Button>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				) : (
					<p className="mt-2 text-[14px] text-text-2">
						{latest ? "No other pending codes." : "No pending codes."}
					</p>
				)}
			</div>
		</Sheet>
	);
}
