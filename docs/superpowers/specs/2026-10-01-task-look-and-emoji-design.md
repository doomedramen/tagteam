# Task look and emoji suggestions — design

Status: **approved** 2026-10-01. Extends the main design spec
(`2026-09-25-tagteam-design.md`). Where it differs from `2026-09-28-task-interactions.md` on the
New task sheet's layout, this document wins; keyboard behaviour from that document is unchanged.

## 1. Summary

Every task gets a colour and an emoji. The New task sheet and task detail take on the task's
colour, in the style of the Me+ create sheet the owner chose as reference: a tinted sheet, an emoji
in a circle, a row of round colour options, and one card of settings rows. Shapes are rounded
throughout; anything with equal width and height is a circle.

The emoji is suggested from the task title on the device, offline, by a small embedding model. The
person can always change it. Until a suggestion exists a task shows a default emoji. The colour is
only ever chosen by the person.

Tasks stay standalone. Subtasks, goals, and tags from the reference app are not adopted.

## 2. Decisions

| Topic | Decision |
|---|---|
| Subtasks, goals, tags | Not built. One task is one thing to do |
| Colours | Seven named hues: pink, coral, amber, green, teal, blue, purple. A task stores the name, never a hex value |
| Emoji | One emoji per task, optional. Suggested from the title, changeable in a picker |
| Emoji order of precedence | Default emoji, replaced by the automatic pick if and when one is made, unless the person has picked one by hand. A hand-picked emoji is never changed automatically |
| Who picks | A device belonging to the task's owner picks and stores the result on the task, so every member sees the same emoji. Once a task has a stored emoji nothing changes it except its owner |
| Suggestion, not assignment | The top suggestion fills the emoji circle while the person has not chosen one. The picker lists the top three first |
| Colour | Never picked automatically. A new task starts blue, as in the approved mock-up, and changes only when the person taps a colour |
| Default emoji | A task with no stored emoji shows 📋 (clipboard) everywhere an emoji appears. No stored emoji means "not decided yet". ✅ is avoided because it reads as "done" next to an open task |
| Existing tasks | Never receive an automatic emoji. Tasks that predate this feature show the default emoji, on neutral surfaces with no colour, until their owner picks by hand |
| Suggestions to others | The draft carries emoji and colour. The recipient can change both after accepting |
| Primary action | Moves from the pinned footer to a pill in the sheet header, which already stays above the keyboard |
| Model | `bge-small-en-v1.5` (quantised ONNX) run with transformers.js in a Web Worker. Served from the TagTeam image, never from a third party at runtime |
| Language | English titles only. Other languages get weak suggestions; the picker still works |
| Opt-out | A device-local toggle in Me. Off means no model download on that device |
| Persistent storage | The app asks the browser to keep its data (`navigator.storage.persist()`) after sign-in |

## 3. Palette and shape

### Roles

Each hue has five roles. Body text keeps `--text`, `--text-2`, and `--text-3`.

| Role | Used for |
|---|---|
| `sheet` | background of the New task sheet and task detail |
| `card` | the settings card and other grouped rows on a tinted background |
| `swatch` | colour option fill, emoji circle fill |
| `ring` | 2 px border of a colour option, so it stays visible on the sheet |
| `fg` | tinted text and icons, the header action pill, the selected check |

### Values

Light. `card` is `#ffffff` for every hue.

| Hue | sheet | swatch | ring | fg |
|---|---|---|---|---|
| pink | `#feeaf1` | `#ffcadd` | `#b96989` | `#7c2b50` |
| coral | `#ffece3` | `#fecfba` | `#bc6f4c` | `#803200` |
| amber | `#f9f0da` | `#efd9a2` | `#a2822a` | `#614900` |
| green | `#e4f6e4` | `#bde9bd` | `#59985b` | `#135d1d` |
| teal | `#dcf7f1` | `#a3ecdc` | `#0f9b89` | `#015a4f` |
| blue | `#e7f1fe` | `#c4ddfe` | `#5788c7` | `#154d8c` |
| purple | `#f1eefe` | `#ddd4ff` | `#8b78c1` | `#533c87` |

Dark.

| Hue | sheet | card | swatch | ring | fg |
|---|---|---|---|---|---|
| pink | `#231219` | `#331e26` | `#854760` | `#d084a1` | `#f6b5cd` |
| coral | `#24140c` | `#342017` | `#874c30` | `#d28a69` | `#f8bba0` |
| amber | `#1e1707` | `#2c2410` | `#735a13` | `#b89b51` | `#e0c88e` |
| green | `#0f1c10` | `#1a2a1b` | `#3a6b3d` | `#76af77` | `#aad9ab` |
| teal | `#061d19` | `#0f2b26` | `#046d5f` | `#4bb3a1` | `#8fdccc` |
| blue | `#0f1926` | `#192636` | `#395f8f` | `#73a1dc` | `#a8ceff` |
| purple | `#191525` | `#262235` | `#61538b` | `#a392d6` | `#cec1fa` |

The values come from fixed OKLCH lightness and chroma per role (hues 355, 45, 88, 145, 180, 255,
295), so the seven feel equally weighted. Measured worst cases at design time: every text pair is
at least 4.5:1 (tightest is `--text-3` on a light `sheet`, 4.57:1) and `ring` against `sheet` is at
least 3:1 (tightest 3.07:1, light). Dark `fg` on dark `swatch` is only about 4.0:1, so in dark mode
anything drawn on a `swatch` (the selected check, text) uses `--text`; `fg` there is limited to
graphics, which need 3:1. The plan keeps a script that re-checks all of these.

### Tokens

`index.css` defines `--task-{hue}-{role}` for light and dark. A `data-task-color="{hue}"` attribute
maps them onto five generic variables (`--task-sheet`, `--task-card`, `--task-swatch`,
`--task-ring`, `--task-fg`) that components read. With no attribute the generic variables fall back
to the existing neutral tokens (`--bg`, `--surface`, `--surface-2`, `--text-3`, `--text`), which is
how tasks without a colour render.

The hue names match the avatar palette minus gray, but the task values are their own set: amber
sits closer to yellow and purple further from blue than the avatar tones, so neighbours stay
distinct at pastel strength.

### Shape

- Circles: close button, emoji circle, colour options, row icon holders.
- Pills: header action, row values.
- Large radii: settings card about 26 px, sheet top corners about 32 px.
- Rows in the card are separated by spacing, not divider lines.

Colour is decorative. Several pastels are hard to tell apart with colour-vision deficiency, so the
selected option always shows a check and the emoji and title carry identity.

## 4. Data model

Core gains `TASK_COLORS` (the seven names) and a `TaskColor` type.

`task` gains two nullable columns: `emoji` (text) and `color` (text, one of `TASK_COLORS`).
`TaskDto` carries both. `TaskClocks` gains `emoji` and `color`; a stored clock object without those
keys reads them as 0.

`suggestion` gains the same two nullable columns and `SuggestionDto` carries them.

No Dexie version change for the two fields: neither is indexed. The device-local "awaiting emoji"
list (section 6) is a small set of task ids kept in the web store's existing device metadata; it
is never synced.

Migration `0005` is two plain `ADD COLUMN` pairs. `migrations.test.ts` currently hard-codes the
`0004_` prefix and needs to keep passing.

## 5. Mutations and sync

| Mutation | Change |
|---|---|
| `task.create` | optional `emoji: string \| null`, `color: TaskColor \| null`; absent means null |
| `task.update` | optional `emoji`, `color`; the "must change something" check accepts either |
| `suggestion.create` | optional `emoji`, `color` |
| `suggestion.accept` | unchanged; the server copies `emoji` and `color` from the suggestion into the new task |

Validation in `mutationErrors`:

- `color` is null or one of `TASK_COLORS`.
- `emoji` is null or a string of 1 to 32 UTF-16 code units that is exactly one grapheme cluster
  (`Intl.Segmenter`) and contains an `Extended_Pictographic` or `Regional_Indicator` code point, or
  a keycap sequence.

`task.update` applies `emoji` and `color` with last-writer-wins on their own clocks, like `title`
and `notes`. It stays owner-only.

All new fields are optional so that a device still running the previous web build keeps working:
it sends mutations without them and ignores them in pull responses.

Pull adds the columns to the explicit task and suggestion selects. `applyLocal` writes them for
`task.create`, `task.update`, `suggestion.create`, and `suggestion.accept`.

## 6. Web

### New task and Edit task sheet

One component as now. Top to bottom:

1. **Header.** Close button in a circle on the left. Action pill on the right, filled with `fg`,
   at least 44 px tall: "Create", "Suggest to {name}", or "Save". The header sits above the
   scrolling body, so the on-screen keyboard never covers or moves the action, and the sheet needs
   no footer. A save failure appears as one line directly under the header, so the keyboard cannot
   hide it. Behaviour carried over from the footer button it replaces: pointer-down on the pill
   keeps the title input focused, duplicate submissions are blocked until the local write
   finishes, and Enter in the title still submits.
2. **Emoji circle.** 60 px, `swatch` fill. Tapping opens the emoji picker. Its accessible name is
   "Emoji: {name}, change". With no emoji stored it shows the default and the name reads
   "Emoji: clipboard, default, change".
3. **Title.** The existing input, centred and styled as a heading, same placeholder, same focus,
   Enter, and IME behaviour.
4. **Colour options.** A radio group of seven circles: 32 px visible, 44 px target, `swatch` fill,
   `ring` border, a check on the selected one. Each is labelled with its hue name.
5. **Settings card.** One row per setting: icon in a small circle, label, value in a pill. Rows are
   "For" (only when the sheet shows it today), "Repeat", "Starts", and "Due by". Tapping a row opens
   its existing controls inline beneath it; one row is open at a time. Editing opens with "Repeat"
   expanded, as editing opens with the schedule expanded today.

The sheet root carries `data-task-color`, so the whole sheet re-tints when the colour changes, with
a 200 ms colour transition that is skipped under reduced motion.

The draft that survives closing the sheet also keeps emoji, colour, and whether the emoji was
chosen by the person.

### Emoji behaviour

A stored emoji of null means "not decided yet". The automatic picker may only ever change a null
emoji, and only on tasks created with this feature (decided by the owner on 2026-10-01); tasks
that already existed are left alone.

- **In the sheet.** A new draft starts with no emoji, so the circle shows the default. 300 ms
  after the title stops changing, if it has at least three characters and the engine is ready, the
  top suggestion fills the circle. A result for a title that has since changed is dropped.
- **Picked by hand.** Choosing in the picker, or typing an emoji into its keyboard field, marks the
  emoji as chosen. The title no longer changes it, in this sheet or later.
- **Submitting never waits.** The task is created with whatever the sheet shows. If no suggestion
  arrived, it is created with no stored emoji and shows the default.
- **Late pick.** A task can be saved before the picker has anything, for example while the model
  is still downloading on a new device. When this device creates a task with no stored emoji (from
  the sheet, or by accepting a suggestion), it adds the task's id to a device-local "awaiting
  emoji" list. When the engine becomes ready, the device takes each listed task that its user
  still owns, that is not archived, and that still has no stored emoji, suggests an emoji from the
  title, and enqueues an ordinary `task.update` with it. The id leaves the list after one attempt,
  or as soon as the task gains an emoji any other way. Late picks run one at a time in the
  background, change the emoji only, never the colour, and produce no activity entry and no push.
  Tasks that were never on a device's list, which includes every task that predates this feature,
  are never late-picked.
- **Keeping the default on purpose.** "Use default" in the picker stores 📋 as the task's emoji.
  That counts as picked by hand, so a late pick never replaces it.
- **Editing.** The Edit task sheet never fills the emoji automatically, whatever the task's age.
  The picker's "Suggested" row still offers suggestions for the current title, for the person to
  tap.

### Colour behaviour

A new draft starts blue. The colour changes only when the person taps a colour option. Nothing
derives it from the emoji or the title. Tasks that existed before this feature have no colour and
render on neutral surfaces until their owner picks one; opening such a task for editing shows no
option selected.

### Emoji picker

A second sheet, "Choose emoji": a search field, a "Suggested" row with up to three emoji for the
current title (hidden when the engine is not ready), then every emoji grouped by category, and a
"Use default" action. Search matches names and keywords as typed and, when the engine is ready,
adds meaning-based matches after them. Off-screen groups are not rendered until scrolled near.

### Today, task detail, suggestions

- **Today row.** A 36 px emoji circle sits between the complete circle and the title. It is
  decorative and not a separate tap target. A task without a stored emoji shows the default
  emoji, so rows stay aligned.
- **Task detail.** The screen carries `data-task-color`: `sheet` background, `card` surfaces, the
  emoji circle above the title.
- **Suggestion cards.** The emoji shows beside the title. Accepting copies emoji and colour.

History is unchanged.

### Me

A toggle "Emoji suggestions", on by default, stored on the device. Turning it off stops the engine
and deletes the cached model on that device.

## 7. Emoji suggestion engine

A module in `apps/web` behind a small interface (`suggest(title)`, `search(text)`, `status`), so
screens and tests never touch the model directly.

- **Model.** `Xenova/bge-small-en-v1.5`, `q8` ONNX, CLS pooling, normalised, raw title as the
  query with no instruction prefix.
- **Catalog.** 1,794 Unicode emoji (gender and direction variants collapsed), each embedded at
  build time from its name plus keywords from `emojibase-data`.
- **Index.** Per emoji, 384 sign bits and 384 int8 values. A query is embedded once, the 40 nearest
  by Hamming distance are shortlisted, and those are re-ranked with the int8 vectors.
- **Auto-pick candidates.** Flags, the symbols group, and clock faces are excluded from automatic
  suggestions because literal word matches on them caused the worst picks in the spike. They remain
  in the picker. This exclusion is adopted only if first-pick accuracy on the evaluation set does
  not drop.
- **Runtime.** A module Web Worker. One thread; no cross-origin isolation headers are added.
- **Loading.** The worker starts when the New task sheet first opens, and about five seconds after
  the first successful sync when the device is online, so the first download happens in the
  background. A failed download is retried on the next app start, not in a loop.

### Failure handling

Rule: the engine can never block, delay, or break creating or editing a task. Every failure ends
in the same safe state, "no suggestions", in which the sheet works exactly as it does with the Me
toggle off: the emoji circle stays as it is, the person can still pick an emoji by hand, and the
task saves. Failures are quiet in the sheet; no error is shown there.

The engine has four states: `off` (toggle), `loading`, `ready`, `unavailable`.

| What goes wrong | Handling |
|---|---|
| Model or wasm files missing, download fails, device offline on first use | `unavailable` for this app start; retried on the next start |
| Browser lacks WebAssembly, module workers, or the Cache API | `unavailable`; not retried |
| Load takes longer than 60 s | worker terminated, `unavailable` |
| Worker throws or posts an error at any time | worker terminated, `unavailable`; no restart in this app start |
| One suggestion takes longer than 2 s, or returns malformed output | that result is dropped; three in a row make the engine `unavailable` |
| Cached model is corrupt or partial (load fails with files present) | this version's Cache API entries are deleted so the next start downloads again |
| Storage quota error while caching | `unavailable`; nothing else in the app is affected because task data is written separately |
| Loading the model crashes or reloads the app (for example memory pressure on an older phone) | a "loading" marker is written before load and cleared after; finding it still set at start counts as a strike. Two strikes turn the Me toggle off on that device with a one-line explanation there |
| Three app starts in a row end `unavailable` | the engine stops trying on that device until the asset version changes or the person toggles it off and on |
| Suggested or picked emoji fails core validation | it is replaced by no emoji before the mutation is enqueued; the task still saves |
| A late pick fails for one task | that task keeps the default; the next task is tried |
| Catalog files fail to load | the picker shows only its keyboard field (below); search and the grid are hidden |

The picker always includes a field that accepts one emoji typed or pasted from the system emoji
keyboard, so choosing an emoji by hand never depends on the model or the catalog.

The background warm-up after sign-in is skipped when the "loading" marker shows a previous crash,
so a device that cannot hold the model does not crash on every launch.

An operator can switch the feature off for everyone by building the image without the model
files: every device then lands in `unavailable`.

Each row above has a web test using a fake worker.

Measured in the spike (79 hand-labelled titles, a small set): right emoji first 57%, in the top
three 80%; keyword lookup without a model 27% and 48%. Bits plus int8 matched full-precision
accuracy; bits alone did not. Model-written task descriptions per emoji gave no measurable gain and
are not used. On the iOS 27 simulator a title took about 9 ms and a cached model loaded in about
0.75 s.

## 8. Colour is the person's choice

Decided by the owner on 2026-10-01: the app never picks a task's colour. Deriving the colour from
the emoji was considered and dropped. There is no code path that sets `color` other than the person
tapping a colour option, apart from the fixed starting colour of a new draft.

## 9. Assets, caching, and build

Served under one versioned path, `/assets/emoji/{version}/`, which the server already marks
immutable because it contains `/assets/`.

| File | Size | In git | Cached on device by |
|---|---|---|---|
| `catalog.json`, `bits.bin`, `int8.bin` | about 0.9 MB | yes | service worker precache |
| model (`model_quantized.onnx`, tokenizer, configs) | 34.7 MB | no | transformers.js, Cache API |
| ONNX Runtime wasm and glue | 14.3 MB | no | transformers.js, Cache API |

- A script fetches the model at a pinned Hugging Face revision, verifies SHA-256, and copies the
  wasm from `node_modules`. It runs before the web build, so the Docker build and CI need network
  access to huggingface.co. Without the files the app works and the engine reports unavailable.
- A second script rebuilds the catalog files; its output is committed.
- `@huggingface/transformers` is pinned to an exact version and imported only by the worker.
- Serwist's precache glob gains the three catalog files. The model and wasm stay out of it, so
  installing the app is not blocked by a 49 MB download.
- On a version change the engine deletes Cache API entries from older versions.
- The image grows by about 49 MB.

Known library behaviour to encode (found in the spike): `env.localModelPath` must be a path, not
an absolute URL; `env.allowLocalModels` must be set to true and `env.allowRemoteModels` to false;
`env.backends.onnx.wasm.wasmPaths` must point at the self-hosted files, or the library fetches a
27 MB wasm from a CDN.

There is no Content-Security-Policy today. If one is added it must allow WebAssembly compilation
and same-origin workers.

## 10. Persistent storage

After sign-in, once per app start, the app calls `navigator.storage.persist()` when the API exists
and storage is not already persistent. The result is not shown. On iOS this is granted for the
installed Home Screen app and refused in a Safari tab; it exempts the whole origin, including the
outbox of unsynced changes, from storage-pressure eviction.

## 11. Testing and verification

- **Core.** Validator cases for `emoji` and `color` on all three mutations, including absent
  fields.
- **Server.** Push and pull round-trips for the new fields, clock ordering for `task.update`, the
  accept copy, and the migration test.
- **Web.** Draft and sheet tests with a fake engine: auto-fill, stale result dropped, chosen emoji
  not overwritten, colour never changed by a suggestion, submit without waiting, edit mode. Late
  pick: fills listed tasks with no stored emoji, skips hand-picked and "Use default" tasks, skips
  tasks not on the list (including all pre-existing tasks), never touches colour, one attempt per
  task. Edit sheet never auto-fills. Search and re-rank against a small fixture index.
- **Evaluation.** The spike's 79 labelled titles and its harness move into the repo as a script
  run by hand, not in CI. It gates the auto-pick exclusion in section 7.
- **Visual.** 375 × 812, light and dark, all seven hues on the sheet, plus Today and task detail.
- **iOS.** Simulator: model load, suggestion, offline relaunch, and `persist()` in the installed
  app. A real iPhone remains a follow-up for speed and memory.

## 12. Phasing

Two plans, each shippable.

- **Plan 09, task look.** Fields, mutations, migration, tokens, the restyled sheet, the picker with
  name and keyword search, Today and task detail, suggestion cards, `persist()`.
- **Plan 10, emoji suggestions.** Model and wasm delivery, catalog build, the worker and engine,
  automatic emoji in the sheet, late picks, the Me toggle, the evaluation script.

## 13. Out of scope

Subtasks, goals, tags, automatic colour, a notes field in the sheet, a per-task reminder row, custom or uploaded
emoji, skin-tone selection, History changes, non-English suggestion quality, multi-threaded
inference.

## 14. Open decisions and risks

- **A. Starting colour of a new task.** Decided by the owner on 2026-10-01: blue pre-selected, as
  in the approved mock-up. The app never changes it afterwards.
- **D. Automatic emoji for tasks that predate the feature.** Decided by the owner on 2026-10-01:
  no. Only tasks created with this feature receive automatic emoji.
- **B. Where the primary action sits.** Decided by the owner on 2026-10-01: close button top left
  and the action pill top right, replacing the pinned footer button, because the header is clear
  of the on-screen keyboard. The trade-off accepted is a longer one-handed reach than the footer.
  Device verification must confirm the pill stays put and tappable while the keyboard opens,
  closes, and switches to the date and time pickers.
- **C. Which default emoji.** Decided by the owner: when there is no suggestion (model not yet
  loaded, switched off, or any failure) the task shows a default "task" emoji instead of nothing.
  This draft uses 📋. A keyword guess from the catalog was considered and dropped: in the spike it
  answered 62 of 79 titles and was right first on 21 of them. The owner confirmed 📋 as the glyph.
- **Bundling risk.** The spike loaded the library's prebuilt bundle directly. Importing it through
  Vite in a worker is untested and is the first task of Plan 10.
- **Wrong picks.** Roughly one automatic pick in four was clearly wrong in the spike. The mitigation
  is that it is a suggestion one tap from the alternatives.
- **Real-device unknowns.** Speed and memory on an actual iPhone, and eviction behaviour over days.
