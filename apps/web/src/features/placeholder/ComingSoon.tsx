export function ComingSoon({ title }: { title: string }) {
	return (
		<div className="mt-20 text-center">
			<h1 className="text-xl font-semibold">{title}</h1>
			<p className="mt-2 text-[14px] text-text-2">Coming in the next update.</p>
		</div>
	);
}
