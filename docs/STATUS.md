# Project status

_Last updated: 2026-10-02 (Plan 9 task look complete)._

## Done (on `main`; CI green through Plan 7, Plans 8 and 9 not yet run in CI)

| Plan | Scope | Notes |
|---|---|---|
| 01 core engine | recurrence rules, slots, `deriveTask` (one open occurrence, gaps logged as missed), stats | |
| 02 server foundation | Hono, Better Auth (passkey + password), SQLite, profiles, groups, single-use 6-digit invites | |
| 03 container + CI | esbuild bundle, backup CLI, non-root Docker image, GitHub Actions → `ghcr.io/doomedramen/tagteam` (amd64), README compose | IP rate limits dropped by owner decision |
| 04 sync | per-version due times, Mutation vocabulary, tasks/events tables, push/pull with global seq, SSE `/api/live`, e2e convergence test | |
| 05 app foundation + Today | sign-in, groups, Today, offline sync, PWA, Docker hosting | Local e2e flow and hosted CI passed |
| 06 remaining screens | Team, task history/editing, profile editing, swipe-to-complete | CI passed |
| 07 push notifications | per-device web-push, due/overdue reminders, team nudges, quiet hours | Requires VAPID environment values to send push |
| 08 task suggestions | suggest a task to another member from New task; accept or decline on Today; History and task detail say who suggested it; push for suggested, accepted and declined | Spec: `2026-10-01-task-suggestions-design.md` |
| 09 task look | per-task emoji and color; tinted New/Edit task sheet with emoji picker; emoji and color on Today tiles, task detail and suggestion cards; page header bands; persistent-storage request | Spec: `2026-10-01-task-look-and-emoji-design.md` |

## Complete — Plan 5: `docs/superpowers/plans/2026-09-25-05-app-foundation-today.md`

PWA foundation + the first real screens (Today, Add task). Executed task-by-task with reviews.

| Task | Status |
|---|---|
| 1 scaffold, tokens, icons | done |
| 2 wire types + `withScheduleVersion` in core | done |
| 3 Dexie store, applyLocal / applyPull (rebase) | done |
| 4 API client, auth client, sync engine, live + triggers | done |
| 5 UI kit + app shell | done |
| 6 Today screen | done |
| 7 Add task sheet | done — due-time validation and double-submit guard |
| 8 sign in / sign up / passkeys / session gate + router | implemented; typecheck and 375 × 812 visual checks passed; tests pending |
| 9 welcome (create/join group) + group switcher | implemented; create/join and switcher visually checked; tests pending |
| 10 service worker, server serves SPA, Docker, dev setup | implemented; PWA build, container smoke, and 375 × 812 browser review passed; tests pending |
| 11 Playwright e2e (sign up → offline completion) + CI job | implemented; local e2e, hosted CI, and actionlint passed |

Task 8 wires real routes and screens into the app. Unit tests for Tasks 8–10 remain follow-up work.
Task 11 e2e covers account creation, group setup, task creation, offline completion, and online sync.

## Complete — Plan 6

| Slice | Status |
|---|---|
| Team | Implemented member progress, inline task lists, overdue nudges, and invite code create/share/copy/revoke. Typecheck and 375 × 812 visual review passed. |
| Me passkey status | Shows registered passkey count and offers “Add another passkey”. Typecheck and visual review passed. |
| History | Implemented newest-first group activity by day with member filtering, completion status, misses, nudges, and new tasks. Typecheck and 375 × 812 visual review passed. |
| Task detail/history | Shows stats, a color-coded month grid, occurrence history, completion undo, overdue nudges, and owner actions. Owners can edit task title, repeat schedule, effective date, and due time. |
| Profile editing | Members can edit their display name and avatar color from Me. |
| Swipe-to-complete | Swipe a Today row right to complete it; the existing button remains available. |

Per-task execution ledger (rulings, review findings, deferred minors) lives in the git-ignored
`.superpowers/sdd/2026-09-25-05-app-foundation-today/progress.md` in the working checkout. The
decisions that matter are summarised below.

## Complete — Plan 7: push notifications

- VAPID configuration enables push for a self-hosted instance; missing keys leave push disabled.
- Authenticated routes register and remove per-device subscriptions and save account-level
  reminder, nudge, and quiet-hour preferences.
- A minute scheduler uses `deriveTask` to send one due and one overdue reminder per occurrence.
  Timed tasks notify at their due time and again one hour later if still open. Untimed tasks notify
  at 09:00 local time and again at 09:00 on the next period boundary. Quiet hours use profile zone.
- Successful task nudges queue push for the owner immediately; sender/task limit stays in sync core.
- Notification logs dedupe by task, occurrence, and kind. Failed deliveries retry with backoff;
  expired push endpoints are removed.
- Me screen provides device opt-in, reminders and nudge toggles, quiet hours, and timezone update.
  Service worker displays notifications and opens Today or Team when tapped.
- Reminder and nudge opt-in starts at enable time; older triggers and newly added devices receive
  no catch-up notifications.
- New tasks skip reminder triggers that predate their creation, preventing an immediate push
  when a task is added after its reminder time. Future due and overdue reminders still apply.
- Typecheck, lint, server bundle, and PWA build pass.

## Complete — Plan 8: task suggestions

- Four sync mutations (`suggestion.create|accept|decline|withdraw`). The `suggestion` table never
  deletes rows (status changes instead, so sync needs no tombstones); `task.suggestedBy` records the
  suggester of an accepted task.
- Pull returns a suggestion only to its sender and recipient. Accept inserts the task and updates the
  suggestion in the one push transaction. Leaving a group withdraws pending suggestions to or from
  the leaver and the declined ones they sent. At most 10 pending per sender and recipient per group.
- Push: "suggested" (to the recipient), "accepted" and "declined" (to the sender); gated by the
  receiving user's nudge toggle, held during their quiet hours, a held "suggested" push is dropped
  if the suggestion is no longer pending, once per suggestion per kind, nothing on withdraw.
  `notification_log.task_id` is now nullable and a `suggestion_id` column dedupes suggestion pushes.
- Migration `0004_task_suggestions.sql` is hand-edited: drizzle-kit's generated rebuild of
  `notification_log` would cascade-delete queued `notification_delivery` rows inside the migrator's
  transaction, so the file parks deliveries in a backup table first. `src/db/migrations.test.ts`
  guards this.
- Web: Dexie `version(2)` `suggestions`. The New task sheet has a "For" select (Me plus other active
  members; hidden with no other active member and when editing). Today shows one suggestions strip
  ("{n} suggestion(s) for you", "Sent by you: {w} waiting, {d} declined"; hidden when nothing is
  pending or declined) that opens a "Suggestions" sheet with "For you" and "Sent by you" sections;
  the sheet closes itself when empty. History and task detail say "{owner} took on {title}" /
  "Suggested by {name}". The Me toggle is "Nudges and suggestions".
- Checks: unit tests, typecheck, lint, and the two-user Playwright flow (WebKit `iphone` and
  `chromium` projects) passed. Visual check at 375 × 812 light and dark passed for the Today strip,
  Suggestions sheet, New task "For" select, and History; the Me toggle label is covered by unit test
  only because the local dev server had no VAPID keys.

## Complete — Plan 9: task look

Plan: `docs/superpowers/plans/2026-10-01-09-task-look.md` (Tasks 1-11 as written, then the owner
follow-ups below). Per-task ledger (rulings, review findings): git-ignored
`.superpowers/sdd/2026-10-01-09-task-look/` in the working checkout.

- Core: `TASK_COLORS`/`TaskColor`, `isEmoji`, `DEFAULT_EMOJI` (bare U+1F4CB), optional `emoji` and
  `color` on `task.create`, `task.update`, `suggestion.create`. Server: nullable columns on `task`
  and `suggestion` (migration `0005_task_look.sql`, generated), per-field LWW clocks for both
  (missing clocks read as 0), the accept path copies both. Web store writes them in `applyLocal`.
- Palette: seven hues x five roles as `--task-{hue}-{role}` tokens, mapped by `data-task-color`
  onto `--task-sheet|card|swatch|ring|fg` (neutral fallbacks for tasks with no colour). The contrast
  script `apps/web/scripts/check-task-palette.mjs` runs inside `pnpm test` and as
  `pnpm --filter @tagteam/web check:palette` (182 pairs, includes the Today tile pairs). Dark `fg`
  on `swatch` measures about 4.0:1 (spec §3 records this), so the script asserts 3:1 there (graphics,
  icons) and `--text` on swatches at 4.5:1.
- Sheet: close circle + action pill in the header (no footer), a large bare emoji (64 px, no circle; see 11c), heading-style title,
  seven colour radios, one settings card (For / Repeat / Starts / Due by, one open at a time).
  A tinted `Sheet` (`tint`, `action`, `notice`) re-tints with a 200 ms transition. Editing sends one
  `task.update` with only what changed.
- Picker: "Choose emoji" nested sheet, 1,794-emoji catalog (`catalog.json`, built from
  `emojibase-data` 17.0.0 by `pnpm --filter @tagteam/web emoji:catalog`, its own ~183 KB chunk,
  precached by the existing `globPatterns`), name and keyword search, lazy groups, typed/pasted
  emoji field, "Use default" (stores the clipboard). The `EmojiEngine` seam
  (`features/emoji/engine.ts`) is in place with an always-unavailable default; "Suggested" and
  meaning-based search show only when an engine reports `ready`.
- `navigator.storage.persist()` is requested once per app start after sign-in
  (`src/lib/persist-storage.ts`).
- Owner follow-ups made during the visual checks (all on `main`, spec amended; 2026-10-02):
  - 9b `db3873b` emoji circle ringed look (later superseded on Today by 9e); task detail remaps
    `--surface-2` to `--task-sheet` only when coloured so History icons read in dark.
  - 9c `a0b0896`, `a6d49a6` list-card rows span the full card width (padding moved into the rows)
    on Team, Today suggestions, task-detail History, History; Team's task list uses the 16 px inset.
  - 9d `61a08f3`, `d972e0e` History member filter: arrow no longer overlaps; default option is
    "Everyone".
  - 9e `826339f`, `3a65b97` Today is a stack of separate rounded tinted tiles: bare emoji left,
    title + meta, repeat icon, completion checkmark on the right. Tile fill is `sheet` in light and
    `card` in dark; colourless tiles are `bg-card`. `TaskEmoji` sizes: `bare`, `sheet`, `detail`.
  - 9f `3e24623` tile title `font-semibold`, meta `font-medium`.
  - 9g `180570a`, `bf58dc8` shared `PageHeader` band (full bleed, square) on Today, Team, History,
    Me; Today's empty state has it too; progress track `bg-text/15`.
  - 9h `409b186` task detail panel runs flush to the top, square top edge.
  - 9i + 9j `7bb5050` header band colour is `--surface` (matches the bottom nav) with a
    `border-b border-line` hairline. The top bar no longer exists: the group switcher is a "Group"
    section on Me; the sticky top area is only the safe-area strip; `SyncChip` overlays top right
    when syncing or offline.
- Checks: `pnpm test`, typecheck, lint, format, `check:palette`, and the Playwright specs (WebKit
  `iphone` and `chromium`: `app`, `suggestions`, `task-look`, 6 tests) passed on 2026-10-02.
  `task-look.spec.ts` covers: create with an emoji and a colour, the `persist()` spy (called once),
  the tinted tile on Today, task detail, editing the colour, and a fresh browser context (empty
  IndexedDB) that can only learn the emoji and colour from the server.
  - 11b `98052e7` sheet taps work while the keyboard is open: `ui/useKeepKeyboardTaps.ts` handles a
    one-finger tap on a button, link, label or radio on `touchend` (prevent default, then `.click()`)
    when a text field in the same sheet is focused, so iOS no longer dismisses the keyboard and drops
    the tap. Selects, date/time inputs and text fields keep native focus.
  - 11c `3516069` the task sheet shows the emoji large (64 px) with no circle behind it.
- Known flake: three times during this plan a full `pnpm test` run had one web test time out at 5 s
  (twice "builds a custom weekly schedule with a due time" in `AddTaskSheet.test.tsx`); it passed
  alone and on re-run. The likely cause is load: the test makes about 14 sequential `userEvent`
  calls on a heavier sheet, and a full run executes test files in parallel under CPU contention.
  The final-review fix addressed it: `testTimeout` is 15 s in `apps/web/vitest.config.ts`, and that
  test uses `userEvent.setup({ delay: null })` and `fireEvent.change` for the time input.
- Notes for the owner: the active group is now visible only on Me, so a user in several groups
  cannot see which group Today and Team show (owner's request, 7bb5050). Team's Nudge button is
  40 px tall, under the 44 px tap-target rule (pre-existing, not touched).
- Visual check (controller, 2026-10-02, browser pane at 375 x 812, light and dark): New/Edit sheet,
  all screens' header bands, Today tiles, task detail, Team, History and Me checked after each change.
- iOS Simulator (controller, 2026-10-02, iPhone 18 Pro, iOS 27, Safari tab and an earlier spike as
  an installed web app): the sheet opens with the title focused and the keyboard up, header and
  action stay above the keyboard. Before 11b, any tap with the keyboard open only dismissed it (owner
  confirmed); after 11b, colour, Repeat row, Create, emoji circle and picking from the picker's search
  results all work on the first tap and keep the keyboard up.

## Next plans

- **Plan 10: emoji suggestions** — not written. Spec
  `docs/superpowers/specs/2026-10-01-task-look-and-emoji-design.md` (§7 engine, §9 assets, §6 emoji
  behaviour, §11 evaluation): on-device `bge-small-en-v1.5` in a Web Worker, automatic emoji for new
  tasks only, late picks, failure handling. The spike (2026-10-01) measured the model; numbers are in
  the spec §7 and §9, its code is not in the repo and Plan 10 rebuilds the evaluation script.
  Carry-over notes from Plan 9 (also at the end of the plan file):
  - Seam: `features/emoji/engine.ts` (`EmojiEngine`, `EmojiEngineProvider`, `useEmojiEngine`).
    Provide a real engine from `SessionGate`/`SignedIn` and hand out a new object whenever its status
    changes (the picker re-reads through context, there is no subscribe API). The picker already
    calls `engine.suggest(title)` (up to 3, titles of 3+ characters, only while `ready`) and
    `engine.search(q)` (appended after keyword matches).
  - The sheet does not auto-fill yet. Plan 10 adds the 300 ms debounce, the stale-result drop, and
    uses `draft.emojiChosen` (set on pick, typed or "Use default", kept through dismissal) so a
    hand-picked emoji is never overwritten. Edit mode must never auto-fill (`taskDraft` sets
    `emojiChosen` from the stored emoji; Plan 10 must still skip editing explicitly).
  - The catalog is the index's key: `apps/web/src/features/emoji/catalog.json` (1,794 entries, CLDR
    order). `bits.bin`/`int8.bin` must be built from this exact file and order; rebuilding the
    catalog invalidates them. Spec §9 says the catalog is served from `/assets/emoji/{version}/`;
    Plan 9 ships it as a hashed JS chunk instead.
  - Emoji identity: the catalog spells the clipboard U+1F4CB U+FE0F, `DEFAULT_EMOJI` is bare
    U+1F4CB; compare through `emojiKey()`. Any suggested or picked emoji must pass `isEmoji` before a
    mutation is enqueued.
  - The device-local "awaiting emoji" list (spec §6 late pick) is not started: it belongs in the web
    store's device metadata (`MetaKey` in `src/store/db.ts`), never synced. Tasks created by Plan 9
    without an emoji are on no list, so none is late-picked until Plan 10 lists them.
  - Without `Intl.Segmenter` (Firefox before 125) the client skips the grapheme-count check; the
    server always checks, so a two-emoji paste in the typed field is rejected by the server there.
    A client-side guard is optional.
  - A tinted `Sheet` drops the grey swipe handle (swipe still dismisses). The picker is a nested
    drawer inside the add-task sheet; if a future Base UI changes nested stacking, make it a sibling.
    The submit button inside the form is `aria-hidden`, `tabIndex={-1}` on purpose.
  - Not verified: a real iPhone (keyboard behaviour was verified on the iOS 27 Simulator only),
    the installed-PWA `persist()` grant for TagTeam itself, and eviction over days.
  - Open from review: `useKeepKeyboardTaps` ignores taps held longer than 700 ms, so a slow tap with
    the keyboard open still loses the tap; consider raising or dropping that cutoff.
  - Out of scope (spec §13): subtasks, goals, tags, automatic colour, notes in the sheet, per-task
    reminder row, custom emoji, skin tones.

## Considered and dropped

- "Team up" on shared or dependent tasks was considered and dropped (spec §1): nudges and talking
  cover it.

## Decisions to know (made during execution)

- Offline edits conflict by last-writer-wins on the client's clamped timestamp (±5 min) per field
  group; schedule edits replace everything from their effective date forward.
- Live updates use SSE, not WebSocket. Pull has no pagination (small groups).
- Rejoining a group via invite makes you a `member` even if you were admin.
- Better Auth only checks Origin on cookie-bearing requests; we add our own 403 for untrusted
  Origins on auth POSTs. Brute-force protection for sign-in relies on Cloudflare Access.
- A sync requested while a run is failing is not retried immediately; triggers (online, visibility,
  60 s timer, SSE poke) retry.
- Today computes "done today" in the browser's timezone; tasks carry their own timezone.
- Task circles now support a single tap to complete or reopen; right swipe remains a shortcut.
  A completed task uses neutral blue Reopen feedback. Drag-generated clicks remain suppressed,
  and vertical, short, reversed, and cancelled gestures do not change state.
- The New/Edit task sheet is title-first with a header (close circle, action pill) and one
  settings card (For / Repeat / Starts / Due by, one row open at a time); editing opens with
  "Repeat" expanded. The action pill and inline save failures sit in the header, outside the
  scrolling body (there is no footer).
- The sheet lifts and caps its height using the keyboard inset, keeping its header visible. With
  the keyboard open, taps on buttons, links, labels and radios inside a sheet are handled on
  `touchend` (`useKeepKeyboardTaps`) so the keyboard stays up and the tap is not lost on iOS; the
  older `pointerdown` guard covers mouse input. Extra keyboard scroll padding is suppressed because
  the sheet already clears the keyboard. Drafts survive closing/reopening within the current group and page session.
- Interaction design: `docs/superpowers/specs/2026-09-28-task-interactions.md`.
- Task look: `emoji: null` means "not decided yet" and renders as the clipboard; the app never
  picks a colour (new drafts start blue; editing a colourless task shows no option selected and
  sends no colour until one is tapped). The catalog spells the clipboard with U+FE0F and the stored
  default does not, so emoji are compared through `emojiKey()`. The add-task sheet keeps an
  `aria-hidden` submit button inside its form so Enter in the title submits; the visible action is
  in the header.
- Layout: no top bar. Pages open with a `PageHeader` band (`--surface`, hairline, square, full
  bleed); the group switcher lives on Me. Today tasks are separate tinted tiles, not shared-card
  rows; list cards elsewhere use full-width rows.
- Validation includes 75 web tests, web typecheck, lint, production build, and mobile browser
  coverage for task creation, simulated keyboard geometry, taps, swipes, undo, and offline sync.
  Native iPhone keyboard animation and installed-PWA behavior still require device verification.
- Haptics are omitted because iOS PWA scripted switch clicks are unreliable.
- Suggestions: the recipient's browser computes the accepted task's `startDate` (later of the
  suggestion's start and today) and sends its own timezone; the server only enforces
  `startDate >= suggestion.startDate`. A withdraw racing an accept resolves by arrival order and the
  loser's client re-pulls. After sending a suggestion the New task sheet resets to "Me". History and
  task detail say "Suggested by you" when the viewer is the suggester. Better Auth user ids are not
  UUIDs, so `toUserId` is validated as a bounded non-empty string.

## Remaining follow-ups

- Production push needs stable `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` values.
- `deriveTask` re-runs for every task on each 30 s tick; measure before optimizing if histories grow.
- Native iOS push for the three suggestion kinds, and installed-PWA behaviour of the strip and sheet,
  need device verification.
- Suggestion pushes have no per-sender throttle (the cap counts only pending suggestions; acceptable
  for small trusted groups).
- Suggestion rows are never pruned, so pulls carry the full history between pairs.
