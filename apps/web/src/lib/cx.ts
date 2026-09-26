import { cn } from "cn";

/** Joins conditional classes and resolves Tailwind conflicts. */
export const cx = (...classes: (string | false | null | undefined)[]): string =>
	cn(...classes);
