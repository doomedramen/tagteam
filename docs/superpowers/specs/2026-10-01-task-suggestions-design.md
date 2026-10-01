# Task suggestions — design

Status: **approved** 2026-10-01. Extends the main design spec
(`2026-09-25-tagteam-design.md`); where the two differ on ownership, this document wins.

## 1. Summary

A member can suggest a task to another member of the same group. The suggestion stays pending
until the recipient accepts or declines it. Accepting creates an ordinary task owned by the
recipient. Nothing about a pending suggestion counts toward the recipient's history, stats, or
reminders.

The rule "users create and complete their own tasks only" still holds: a suggestion is not a task,
and the task it becomes is created by, and belongs to, the person who accepted it.

### Considered and dropped: teaming up

The second request was to "team up" on a task or a set of tasks. The motivating case was one job
split between two people where one part depends on the other (A strips the bed, B cleans the
mattress). We decided no new functionality is needed: each person owns their own task, B can nudge
A, and they tell each other when a part is done. Dependencies, shared tasks, and task grouping are
out of scope. One known gap is accepted: nudge is only offered on overdue tasks.

## 2. Behaviour

| Topic | Decision |
|---|---|
| Entry point | Existing Add button and New task sheet, with a new "For" control. No new screen |
| What the sender fills in | The full task draft: title, and optionally notes, schedule, start date, due time |
| Recipient's answer | Accept or Decline, one tap each. Accepted tasks can be edited afterwards like any task |
| Start date on accept | The later of the sender's start date and the recipient's today, so a suggestion never arrives with missed occurrences |
| Timezone | The recipient's, taken when they accept |
| Withdraw | The sender can withdraw a pending suggestion. No push is sent |
| Expiry | None. A suggestion stays pending until answered or withdrawn |
| Decline | Final for that suggestion. The sender sees it as declined until they clear it, and can suggest again as a new suggestion |
| Visibility | Sender and recipient only. Other members never receive the data. Declines and withdrawals never appear in group History |
| After accept | The task is visible to the group like any task. History and task detail say who suggested it |
| Cap | At most 10 pending suggestions from one sender to one recipient in a group |
| Leaving a group | Pending suggestions to or from the member who leaves are withdrawn |
| Push | To the recipient when suggested; to the sender when accepted or declined |

## 3. Data model

New server table `suggestion`:

| Column | Notes |
|---|---|
| `id` | client-generated UUID |
| `groupId`, `fromUserId`, `toUserId` | |
| `title`, `notes`, `startDate`, `dueTime`, `rule` | the task draft; same types and limits as `task.create` |
| `status` | `pending`, `accepted`, `declined`, `withdrawn` |
| `taskId` | null until accepted |
| `createdAt`, `resolvedAt` | epoch ms; `resolvedAt` is set on the latest status change |
| `seq` | global sync sequence, bumped on every write |

Indexed on `(groupId, seq)` like `task`. Rows are never deleted; status changes replace deletion,
so sync needs no tombstones.

`task` gains one nullable column, `suggestedBy` (user id), set only when a task is created by
accepting a suggestion. `TaskDto` carries it. No other task field or behaviour changes.

Wire type in core `wire.ts`:

```ts
export interface SuggestionDto {
	id: string;
	groupId: string;
	fromUserId: string;
	toUserId: string;
	title: string;
	notes: string | null;
	startDate: string;
	dueTime: string | null;
	rule: Rule | null;
	status: "pending" | "accepted" | "declined" | "withdrawn";
	taskId: string | null;
	createdAt: number;
	resolvedAt: number | null;
}
```

## 4. Mutations

Four additions to the `Mutation` union in core `mutations.ts`, validated by `mutationErrors` with
the same field rules as their task equivalents.

| Mutation | Fields | Caller | Allowed when | Effect |
|---|---|---|---|---|
| `suggestion.create` | `suggestionId, groupId, toUserId, title, notes, startDate, dueTime, rule` | sender | sender and recipient are active members of `groupId`; recipient is not the sender; `suggestionId` is unused; sender has fewer than 10 pending to this recipient in this group | inserts a pending row |
| `suggestion.accept` | `suggestionId, taskId, timezone, startDate` | recipient | status is pending; caller is still an active member; `taskId` is unused; `startDate` is not before the suggestion's `startDate` | inserts a task and marks the suggestion accepted, in one transaction |
| `suggestion.decline` | `suggestionId` | recipient | status is pending | marks declined |
| `suggestion.withdraw` | `suggestionId` | sender | status is pending or declined | marks withdrawn |

The task inserted by `suggestion.accept` is identical to one made by `task.create`, with:
`ownerId` = the caller, `groupId`, `title`, `notes`, `dueTime`, and `rule` from the suggestion,
`timezone` and `startDate` from the mutation, `createdAt` = the mutation's clamped `at`, and
`suggestedBy` = the suggestion's `fromUserId`. Because `createdAt` is the accept time, the existing
rule that skips reminders predating task creation applies unchanged.

The client computes `startDate` as the later of the suggestion's `startDate` and today in the
recipient's timezone. The server only enforces the lower bound.

`suggestion.withdraw` serves both sender actions in the UI: "Withdraw" on a pending suggestion and
"Clear" on a declined one.

Anything else is rejected: a suggestion the caller cannot see is reported as not found, consistent
with the rule that inaccessible resources look absent. A rejected mutation triggers the existing
full re-pull on that client. That is the whole conflict strategy: if the sender withdraws offline
while the recipient accepts offline, the first to reach the server wins and the other client
resets to server state.

## 5. Sync

- `PullResponse` gains `suggestions: SuggestionDto[]`. A row is returned when its group is visible
  to the caller under the existing cursor rules **and** the caller is its sender or recipient. This
  is the only per-user filter in pull and the only place the privacy rule lives.
- Push applies the four mutations in `applyOne` alongside the task mutations, with the same
  idempotency and `seq` handling.
- Live pokes: suggestion mutations poke the sender and recipient only. `suggestion.accept` also
  pokes the group, because a task appeared.
- Leaving a group marks every pending suggestion to or from that member in that group as
  withdrawn, bumping `seq`, so the other party's lists update. Declined suggestions a departing
  member sent are withdrawn too.
- Older web clients ignore the extra pull field. Mutations of an unknown type cannot be sent by
  them, so no compatibility shim is needed.

## 6. Web

### Store

Dexie `version(2)` adds a `suggestions` table keyed by `id` with a `groupId` index. `applyPull`
upserts it; `removeGroup` clears that group's rows. `applyLocal` handles the four mutations
optimistically, and `suggestion.accept` also writes the task with the local user as owner. The
engine's enqueue transaction includes the new table.

### New task sheet

A "For" control sits under the title: a select, "Me" first and selected by default,
then the other active members of the group. It is hidden when the group has no other active
member and when the sheet is editing an existing task.

With "Me" selected the sheet behaves exactly as it does now. With another member selected the
footer button reads "Suggest to {name}" and submitting enqueues `suggestion.create` instead of
`task.create`. The selection is part of the draft that survives closing the sheet.

If the sender already has 10 pending suggestions to that member, the sheet shows an inline error
next to the footer action and does not enqueue.

### Today

Today shows one **suggestions strip** and nothing else about suggestions. The strip is a single
tappable row (at least 44 px tall) with an inbox icon and a chevron, placed below the date heading and
progress and above the task sections. It also shows in the empty state, above "Add your first task",
which is unaffected by suggestions.

- **Shown** when I have at least one pending incoming suggestion, or at least one suggestion I sent
  that is pending or declined, in the active group. Hidden otherwise. Accepted and withdrawn
  suggestions never count.
- **Text** (status is always words, never colour alone). With incoming suggestions: "{n} suggestion
  for you" or "{n} suggestions for you", and, if I sent any, a second line "Sent by you: {parts}".
  With none incoming: "Sent by you", then "{parts}". `{parts}` joins the non-zero counts with ", "
  in the order "{w} waiting", "{d} declined", for example "2 waiting, 1 declined".
- **Surface.** Accent-tinted when something is incoming, neutral when it only summarises what I sent.

Tapping the strip opens a bottom sheet titled "Suggestions". Its header stays visible while the body
scrolls. It has two sections, each rendered only when it has rows:

- **For you.** Each pending incoming suggestion as a card: the sender's avatar, "{name} suggests",
  the title, a schedule summary, and Decline and Accept buttons. Accept turns it into a task in the
  list; Decline removes the card.
- **Sent by you.** Pending rows read "Waiting for {name}" with a Withdraw action. Declined rows read
  "{name} declined" with a Clear action.

Actions behave as specified elsewhere (same mutations, toasts, double-tap guard, start date and
timezone on accept). When both sections become empty while the sheet is open, the sheet closes.

Accepted and withdrawn suggestions are not shown anywhere.

### History and task detail

A task with `suggestedBy` set changes the wording of its existing "created" activity to
"{owner} took on {title}" with "Suggested by {name}" beneath. Task detail shows
"Suggested by {name}" with the schedule summary. Members who have left still resolve by name from
the members table.

### Me

The nudge toggle is relabelled "Nudges and suggestions". There is no separate setting.

### Interface rules

Existing conventions apply: tap targets of at least 44 px, sentence-case copy without "please" or
exclamation marks, and status carried by text, not colour alone. The "For" control is a labelled
single-select group that works with keyboard and assistive technology.

## 7. Push notifications

| Kind | To | Title | Body |
|---|---|---|---|
| suggested | recipient | "{sender} suggests a task" | task title |
| accepted | sender | "{recipient} accepted your suggestion" | task title |
| declined | sender | "{recipient} declined your suggestion" | task title |

All three open Today (`/`). They are gated by the receiving user's existing nudge toggle and its
enabled-at cutoff. Unlike nudges, they respect quiet hours in the receiving user's profile
timezone and are delivered when quiet hours end. A held "suggested" push is dropped if the
suggestion is no longer pending when it would be delivered. Each kind is sent at most once per
suggestion. Withdraw and Clear send nothing.

## 8. Testing

- **Core:** `mutationErrors` cases for the four mutations.
- **Server:** permission rules for each mutation; the cap; the withdraw-against-accept race;
  accept creating the task and updating the suggestion atomically; leave-group cleanup; pull
  returning suggestions to sender and recipient and to no one else; the three push kinds, the
  toggle, quiet hours, and the dropped held push.
- **Web:** store handling of the four mutations and rebase; the "For" control, button label, and
  cap error in the sheet; the Today strip and Suggestions sheet with their actions;
  History and task detail wording.
- **End to end:** two users in one group; one suggests, the other accepts, and the task appears on
  the recipient's Today and in group History. Visual check at 375 × 812, light and dark.

## 9. Out of scope

Teaming up, dependencies between tasks, and grouped tasks (see §1); suggesting to several members
at once; suggesting changes to an existing task; a reason or message with a decline; expiry;
nudging tasks that are not overdue.
