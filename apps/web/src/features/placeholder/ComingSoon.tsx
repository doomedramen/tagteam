import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@/components/ui/empty";

export function ComingSoon({ title }: { title: string }) {
	return (
		<Empty className="mt-20 border-0 p-0">
			<EmptyHeader>
				<EmptyTitle className="text-xl font-semibold">{title}</EmptyTitle>
				<EmptyDescription className="mt-2 text-[14px] text-text-2">
					Coming in the next update.
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
