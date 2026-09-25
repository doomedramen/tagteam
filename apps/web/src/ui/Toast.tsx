import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

interface ToastInput {
	message: string;
	action?: { label: string; onClick: () => void };
	durationMs?: number;
}

const ToastContext = createContext<{
	show: (toast: ToastInput) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toast, setToast] = useState<(ToastInput & { id: number }) | null>(
		null,
	);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const show = useCallback((next: ToastInput) => {
		clearTimeout(timer.current);
		setToast({ ...next, id: Date.now() });
		timer.current = setTimeout(() => setToast(null), next.durationMs ?? 4000);
	}, []);
	useEffect(() => () => clearTimeout(timer.current), []);
	const value = useMemo(() => ({ show }), [show]);

	return (
		<ToastContext.Provider value={value}>
			{children}
			<div
				role="status"
				aria-live="polite"
				className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4"
			>
				{toast ? (
					<div
						key={toast.id}
						className="pointer-events-auto flex max-w-sm flex-1 items-center gap-3 rounded-2xl bg-text px-4 py-3 text-[14px] text-bg shadow-lg animate-[toast-in_180ms_ease-out]"
					>
						<span className="min-w-0 flex-1 truncate">{toast.message}</span>
						{toast.action ? (
							<button
								type="button"
								className="-my-2 min-h-11 px-2 font-semibold"
								onClick={() => {
									toast.action?.onClick();
									setToast(null);
								}}
							>
								{toast.action.label}
							</button>
						) : null}
					</div>
				) : null}
			</div>
		</ToastContext.Provider>
	);
}

export function useToast() {
	const value = useContext(ToastContext);
	if (!value) throw new Error("useToast needs a ToastProvider");
	return value;
}
