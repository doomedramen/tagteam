import { Check, ChevronDown, Plus, Ticket } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
			<Button
				variant="ghost"
				aria-haspopup="dialog"
				aria-label={`Switch group. Current group: ${active?.name ?? "none"}`}
				onClick={() => setOpen(true)}
				className="-ml-2 min-h-11 max-w-full justify-start gap-1 rounded-xl px-2 text-[17px] font-semibold text-text hover:bg-surface-2"
			>
				<span className="truncate">{active?.name}</span>
				<ChevronDown aria-hidden className="size-4 shrink-0 text-text-2" />
			</Button>
			<Sheet open={open} onClose={close} label="Your groups">
				<FieldSet className="gap-0">
					<FieldLegend variant="label" className="mb-2 text-text-2">
						Your groups
					</FieldLegend>
					<RadioGroup
						aria-label="Your groups"
						value={activeId}
						onValueChange={(value) => {
							if (!value) return;
							close();
							void setActiveGroup(value).catch(() => {});
						}}
						className="gap-0"
					>
						{[...groups]
							.sort((a, b) => a.name.localeCompare(b.name))
							.map((group) => (
								<FieldLabel
									key={group.id}
									className="min-h-12 w-full items-center justify-between rounded-none border-b border-line py-2 text-left text-[16px] last:border-0 hover:bg-transparent"
								>
									<span className="flex min-w-0 items-center gap-3">
										<RadioGroupItem value={group.id} />
										<span className="truncate">{group.name}</span>
									</span>
									{group.id === activeId ? (
										<Check aria-hidden className="size-5 text-accent" />
									) : null}
								</FieldLabel>
							))}
					</RadioGroup>
				</FieldSet>
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
