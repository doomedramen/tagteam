import { Check, ChevronDown, Plus, Ticket } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { useSession } from "../../session/session";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";

export function GroupSwitcher({
	groups,
	activeId,
}: {
	groups: { id: string; name: string }[];
	activeId: string;
}) {
	const { setActiveGroup } = useSession();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const active = groups.find((group) => group.id === activeId);
	const close = useCallback(() => setOpen(false), []);
	const go = (path: string) => {
		close();
		navigate(path);
	};

	return (
		<>
			<button
				type="button"
				aria-haspopup="dialog"
				aria-label={`Switch group. Current group: ${active?.name ?? "none"}`}
				onClick={() => setOpen(true)}
				className="-ml-2 flex min-h-11 max-w-full items-center gap-1 rounded-xl px-2 text-[17px] font-semibold active:bg-surface-2"
			>
				<span className="truncate">{active?.name}</span>
				<ChevronDown aria-hidden className="size-4 shrink-0 text-text-2" />
			</button>
			<Sheet open={open} onClose={close} label="Your groups">
				<h2 className="mb-2 text-[13px] font-medium text-text-2">
					Your groups
				</h2>
				<div
					role="radiogroup"
					aria-label="Your groups"
					className="flex flex-col"
				>
					{[...groups]
						.sort((a, b) => a.name.localeCompare(b.name))
						.map((group) => (
							<label
								key={group.id}
								className="flex min-h-12 cursor-pointer items-center justify-between border-b border-line text-left text-[16px] last:border-0 focus-within:outline focus-within:outline-2 focus-within:outline-accent"
							>
								<input
									type="radio"
									name="active-group"
									value={group.id}
									checked={group.id === activeId}
									aria-checked={group.id === activeId}
									className="peer sr-only"
									onChange={() => {
										close();
										void setActiveGroup(group.id).catch(() => {});
									}}
								/>
								<span className="truncate">{group.name}</span>
								{group.id === activeId ? (
									<Check aria-hidden className="size-5 text-accent" />
								) : null}
							</label>
						))}
				</div>
				<div className="mt-4 flex flex-col gap-2">
					<Button block onClick={() => go("/welcome?mode=create")}>
						<Plus aria-hidden className="size-4" />
						Create group
					</Button>
					<Button block onClick={() => go("/welcome?mode=join")}>
						<Ticket aria-hidden className="size-4" />
						Join with code
					</Button>
				</div>
			</Sheet>
		</>
	);
}
