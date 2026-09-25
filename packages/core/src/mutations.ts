import {
	isLocalDate,
	isTimeOfDay,
	isTimeZone,
	type LocalDate,
} from "./localDate";
import { type Rule, ruleErrors } from "./rule";

export const MAX_BATCH = 100;
export const MAX_TITLE = 100;
export const MAX_NOTES = 1000;
/** Mutation timestamps later than server time plus this are clamped by the server. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** One nudge per sender per task per this interval. */
export const NUDGE_INTERVAL_MS = 30 * 60 * 1000;

interface Base {
	/** Client-generated UUID; also the id of the event a completion/uncompletion/nudge creates. */
	id: string;
	/** Client wall-clock epoch ms when the user acted. */
	at: number;
}

export type Mutation =
	| (Base & {
			type: "task.create";
			taskId: string;
			groupId: string;
			title: string;
			notes: string | null;
			timezone: string;
			startDate: LocalDate;
			dueTime: string | null;
			rule: Rule | null;
	  })
	| (Base & {
			type: "task.update";
			taskId: string;
			title?: string;
			notes?: string | null;
	  })
	| (Base & {
			type: "task.schedule";
			taskId: string;
			effectiveFrom: LocalDate;
			dueTime: string | null;
			rule: Rule | null;
	  })
	| (Base & { type: "task.archive"; taskId: string; archived: boolean })
	| (Base & { type: "task.complete"; taskId: string; occurrenceKey: LocalDate })
	| (Base & { type: "task.uncomplete"; taskId: string; refEventId: string })
	| (Base & { type: "task.nudge"; taskId: string });

export type MutationType = Mutation["type"];

const FIELDS: Record<MutationType, readonly string[]> = {
	"task.create": [
		"taskId",
		"groupId",
		"title",
		"notes",
		"timezone",
		"startDate",
		"dueTime",
		"rule",
	],
	"task.update": ["taskId", "title", "notes"],
	"task.schedule": ["taskId", "effectiveFrom", "dueTime", "rule"],
	"task.archive": ["taskId", "archived"],
	"task.complete": ["taskId", "occurrenceKey"],
	"task.uncomplete": ["taskId", "refEventId"],
	"task.nudge": ["taskId"],
};

const OPTIONAL = new Set(["task.update:title", "task.update:notes"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isId = (v: unknown): v is string =>
	typeof v === "string" && UUID.test(v);

function fieldError(key: string, v: unknown): string | null {
	switch (key) {
		case "taskId":
		case "groupId":
		case "refEventId":
			return isId(v) ? null : `${key} must be a UUID`;
		case "title": {
			const length = typeof v === "string" ? v.trim().length : 0;
			return length >= 1 && length <= MAX_TITLE
				? null
				: `title must be 1-${MAX_TITLE} characters`;
		}
		case "notes":
			return v === null || (typeof v === "string" && v.length <= MAX_NOTES)
				? null
				: `notes must be null or at most ${MAX_NOTES} characters`;
		case "timezone":
			return isTimeZone(v) ? null : "timezone must be an IANA zone";
		case "startDate":
		case "effectiveFrom":
		case "occurrenceKey":
			return isLocalDate(v) ? null : `${key} must be YYYY-MM-DD`;
		case "dueTime":
			return v === null || isTimeOfDay(v)
				? null
				: "dueTime must be HH:MM or null";
		case "rule": {
			const errors = ruleErrors(v);
			return errors.length > 0 ? `rule: ${errors.join("; ")}` : null;
		}
		case "archived":
			return typeof v === "boolean" ? null : "archived must be a boolean";
		default:
			return null;
	}
}

/** Problems with an untrusted mutation, in a stable order; empty array means valid. */
export function mutationErrors(input: unknown): string[] {
	if (typeof input !== "object" || input === null || Array.isArray(input))
		return ["mutation must be an object"];
	const m = input as Record<string, unknown>;
	if (typeof m.type !== "string" || !Object.hasOwn(FIELDS, m.type))
		return ["type is not a known mutation"];
	const type = m.type as MutationType;
	const fields = FIELDS[type];

	const errors: string[] = [];
	if (!isId(m.id)) errors.push("id must be a UUID");
	if (typeof m.at !== "number" || !Number.isFinite(m.at) || m.at <= 0)
		errors.push("at must be epoch milliseconds");
	for (const key of Object.keys(m)) {
		if (key !== "id" && key !== "at" && key !== "type" && !fields.includes(key))
			errors.push(`unknown field: ${key}`);
	}
	for (const key of fields) {
		if (!(key in m)) {
			if (!OPTIONAL.has(`${type}:${key}`)) errors.push(`${key} is required`);
			continue;
		}
		const problem = fieldError(key, m[key]);
		if (problem) errors.push(problem);
	}
	if (type === "task.update" && !("title" in m) && !("notes" in m))
		errors.push("update must change title or notes");
	return errors;
}
