# Plan 10 — Emoji Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task's emoji is suggested from its title on the device, offline, by a small embedding model, **but only on a device whose owner chose it**: the model is an opt-in download behind an explicit "Download" button in an "Emoji suggestions" section on Me (owner decision, 2026-10-02: "for now make it an option on the Me page to download the model"). Nothing is ever downloaded automatically, and a device that has not pressed Download behaves exactly like Plan 9. Once downloaded the New task sheet fills the emoji automatically while the person has not picked one; the picker's "Suggested" row and meaning-based search come alive; a task saved before the model is ready gets its emoji afterwards (a "late pick"); "Remove download" deletes the stored model and goes back to the default; every failure ends in "no suggestions" without ever blocking a task from saving. The model and the ONNX Runtime wasm are fetched from Hugging Face at build time at a pinned revision, checksum-verified, and served by the TagTeam image from a versioned, immutable path; the device downloads them from the image only when the person presses Download.

**Architecture:** `@huggingface/transformers` 4.3.0 (exact) is imported by one module Web Worker (`worker.ts`) that Vite bundles. On a Download the worker fetches the six model and runtime files itself (one request each, streamed, with byte progress) into the Cache API under the URLs transformers.js looks them up by, then loads `Xenova/bge-small-en-v1.5` (q8, CLS pooling, normalised) from that cache; on an ordinary start it loads only what is already stored and answers `uncached` instead of ever touching the network. It embeds the title and ranks the catalog with a committed index (`bits.bin` 384 sign bits per emoji for a Hamming shortlist of 40, `int8.bin` for the re-rank) built from the committed `catalog.json`. A pure `worker-core` (testable with fakes) holds the protocol; `search.ts` holds the math and is shared with the build and evaluation scripts. On the main thread an `EmojiController` is the state machine behind the existing `EmojiEngine` seam (`off` for a device that has not opted in, then `loading | ready | unavailable`) and also derives the `DownloadState` the Me section shows (`notDownloaded | updateAvailable | downloading | loading | ready | failed`). It owns the worker, the 60 s stall timeout, the 2 s per-suggestion timeout, the three-bad-results rule, the crash marker with two-strike switch-off, the "three failed starts in a row" stop, and the cache cleanup; its only entry points that can download are `download()` (the Download, Update and Try again buttons) and nothing else. Persisted device state (opted in, which asset version is installed, the switch-off reason, the counters) is in `localStorage`. `EmojiEngineHost` provides the engine and the Me settings to the signed-in app, loads an already-downloaded model in the background five seconds after the first successful sync, and runs the late picks. The New task sheet gains a debounced auto-fill hook; the device-local "awaiting emoji" list lives in the Dexie `meta` table. A build-time script (`fetch-emoji-assets.mjs`) downloads and verifies the model and copies the wasm from `node_modules`; the Dockerfile and CI run it, and the server answers 404 (not the app shell) for a missing `/assets/` file.

**Tech Stack:** existing stack — TypeScript strict, `@tagteam/core`, Hono 4 + Vitest (server), Vite 8 + React 19 + Tailwind 4 + Dexie + Vitest/Testing Library + Playwright + Serwist (web), Biome. New runtime dependency, imported only by the worker: `@huggingface/transformers` pinned to the exact version `4.3.0` (it pulls `onnxruntime-web` `1.31.0-dev.20260914-8d85527a0`).

**Spec:** `docs/superpowers/specs/2026-10-01-task-look-and-emoji-design.md` (approved; binding; §6 emoji behaviour, §7 engine and failure handling, §8 colour, §9 assets/caching/build, §10 persistent storage, §11 testing, §12 phasing, §13 out of scope, §14 decisions and the bundling risk). Executors read the spec sections their task cites together with their task.

## Global Constraints

- **Prerequisite:** run `pnpm install` at the repo root before Task 1. Baseline when this plan was written (2026-10-02, `main` at `2a20271`): `pnpm test` passed (core 103, server 110, web 279 tests), `pnpm typecheck` and `rtk proxy pnpm lint` passed. **Every code block below was written and run in a scratch clone at that commit.** Verified there: the Vite worker import in dev, in the production build, in Chromium and in WebKit with the real model; the fetch script against the real pinned revision (all six checksums); the index build (1,794 emoji, `bits.bin` 86,112 bytes, `int8.bin` 688,896 bytes); the evaluation script on the 79 labelled titles; the full end state (`pnpm test`: core 103, server 113, web 461; typecheck; lint) and the Playwright suite against the production build with the real model (18 tests, WebKit `iphone` and `chromium`). **Not run:** `docker build` (no daemon was available), GitHub Actions, `actionlint`, a real iPhone, the iOS Simulator. Where real code disagrees with a snippet, the real code and the spec win and the difference is reported.
- Work on `main` directly. No feature branches or worktrees. **Never push.**
- Conventional Commits, exactly the message given in the task. **Never** add `Co-authored-by` or any attribution trailer. **Never** use `--no-verify`.
- Sub-agents: Haiku or Sonnet only. Keep `docs/STATUS.md` current (Task 11 finalises it).
- Commands: `pnpm test`, `pnpm typecheck`, `rtk proxy pnpm lint`, `rtk proxy pnpm format` (Biome: tabs, double quotes; plain `pnpm lint` is mangled by a local RTK hook). Before each commit run once: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`. Reformatting plan code with Biome is expected. **Every task ends with the whole repo green** (`pnpm test`, `pnpm typecheck`, lint). The unit tests never need the model files; the browser specs in Tasks 1, 4 and 11 do and say so.
- Instants are epoch ms numbers; calendar dates are `YYYY-MM-DD` strings; times are `HH:MM`.
- Every client write is a `Mutation` → local outbox → `POST /api/sync/push` → `GET /api/sync/pull?cursor=`. **Web must only enqueue mutations that pass `mutationErrors`.** A suggested or picked emoji that fails `isEmoji` is replaced by no emoji before the mutation is enqueued; the task still saves.
- **Model (owner decision, spec §9; do not reopen):** the files are **fetched at build time from Hugging Face, never committed to git.** Model `Xenova/bge-small-en-v1.5` at the pinned revision `ea104dacec62c0de699686887e3f920caeb4f3e3`, dtype `q8`, CLS pooling, normalised, the raw title as the query with no instruction prefix. Files and SHA-256 (verified against the pinned revision on 2026-10-02):

  | File | Bytes | SHA-256 |
  |---|---|---|
  | `onnx/model_quantized.onnx` | 34,014,426 | `6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4` |
  | `tokenizer.json` | 711,396 | `d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66` |
  | `tokenizer_config.json` | 366 | `9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3` |
  | `config.json` | 683 | `fa73f90bf92c8cace1fbcb709626306f2bdbc9ea3e5b5f94b440df9b6aa56350` |
  | `ort-wasm-simd-threaded.mjs` (from `onnxruntime-web`) | 24,381 | `c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f` |
  | `ort-wasm-simd-threaded.wasm` (from `onnxruntime-web`) | 14,264,838 | `06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3` |

  Without the files the app still builds and works and every device reports Download as failing (the files 404) and stays at the default; `SKIP_EMOJI_MODEL=1` skips the fetch on purpose.
- **Library facts to encode (found in the spike and re-proved in Task 1):** `env.allowLocalModels = true`; `env.allowRemoteModels = false`; `env.localModelPath` must be a path like `/assets/emoji/{version}/models/`, never an absolute URL (otherwise the tokenizer silently fails); `env.backends.onnx.wasm.wasmPaths = { mjs, wasm }` must point at the self-hosted plain `ort-wasm-simd-threaded` files (the default is a 26.9 MB wasm from a CDN); `env.useBrowserCache = true` so the Cache API (`transformers-cache`) keeps the model; `device: "wasm"`, one thread (no COOP/COEP headers are added); the worker is a module worker.
- **Search (spike):** per emoji 384 sign bits (48 bytes) and 384 int8 values; the query is embedded once; the 40 nearest by Hamming distance are re-ranked by the dot product of the float query with the int8 vectors; centring and instruction prefixes did not help; doc text per emoji is `"{name}: {tags joined by ', '}"` from the committed `catalog.json` in its CLDR order (model-written descriptions gave no gain and are not used). `bits.bin`/`int8.bin` must be built from that exact file; the engine verifies the index count matches the catalog.
- **Timings and limits (spec §7), exact values:** load timeout 60 s (for a download: 60 s without a single new byte, so a slow download is fine while bytes arrive); one suggestion 2 s; three bad results in a row make the engine `unavailable`; two "loading" strikes switch suggestions off; three app starts in a row that end `unavailable` stop the engine until the asset version changes or the person presses Download again; automatic emoji: 300 ms debounce, titles of at least 3 characters, up to 3 suggestions; background load 5 s after the first successful sync, **only** for a device that has downloaded the model, from its stored copy, and not in an app start that found a crash marker.
- **Emoji behaviour (spec §6):** `emoji: null` means "not decided yet" and renders as 📋 (`DEFAULT_EMOJI`). The automatic pick may only change a null emoji in the New task sheet while the person has not picked one (`draft.emojiChosen`), never in Edit, never the colour. Late picks: one `task.update` with `emoji` only, one task at a time, one attempt per task, only for tasks on this device's awaiting list that its user still owns, that are not archived and still have no stored emoji; never for a task that was never listed (every task that predates Plan 9 and Plan 10 included). "Use default" stores 📋 and counts as picked by hand. Emoji compare through `emojiKey()` (the catalog spells the clipboard with U+FE0F).
- **Opt-in (owner decision, 2026-10-02):** the model is not downloaded unless the person presses "Download" in the "Emoji suggestions" section on Me. No warm-up, sign-in, sheet opening or anything else downloads it. A device that has not opted in has engine status `off`: the sheet shows the default emoji, the picker's "Suggested" row is hidden, no task is listed for a late pick (so tasks created before the person opts in are never late-picked, like every task that predates the feature). Later (owner): "an in-app tutorial for using the app, which can include this download option."
- **UI:** mobile first, tap targets ≥ 44 px, safe-area insets, light/dark via `prefers-color-scheme`, status never colour-only, sentence-case copy without "please" or exclamation marks. Runtime-visible changes get a visual check at 375 × 812 (light and dark) in Task 11, not only tests.
- **Out of scope (spec §13):** descriptions, non-English suggestion quality, multi-threaded inference, automatic colour, subtasks, goals, tags, skin tones.

---

## Decisions made while planning (differences from the brief and the spec, and choices the spec leaves open)

- **Bundling is proved first and may change the approach (Task 1).** It was already trialled: a plain `import { env, pipeline } from "@huggingface/transformers"` in a Vite 8 module worker builds and runs in dev and in the production build, in Chromium and WebKit, with the self-hosted plain wasm. Two things are needed, and Task 1 commits both: `worker: { format: "es" }` (transformers.js code-splits, so the default IIFE worker format cannot be used) and a small Vite plugin (`build-plugins/no-ort-default-wasm.ts`) because the library's ORT bundle names its default wasm with `new URL("ort-wasm-simd-threaded.asyncify.wasm", import.meta.url)` and Vite turns that into an emitted **26.9 MB** asset that the app never loads. The spike's `dist/transformers.min.js` has the same pattern, so there is no reason to alias to it. Later tasks assume only the five facts listed under Task 1 "Interfaces"; if Task 1 has to change the approach it says so in its report and in the header of this plan.
- **Asset folder and version.** Everything the build serves for the model lives under `apps/web/public/assets/emoji/{version}/` (git-ignored): `models/Xenova/bge-small-en-v1.5/{config.json,tokenizer.json,tokenizer_config.json,onnx/model_quantized.onnx}` and `ort/ort-wasm-simd-threaded.{mjs,wasm}`. Vite copies `public/` into `dist/`, and the server already marks every path containing `/assets/` immutable. `{version}` is the first 12 hex digits of a SHA-256 over the checksums of **every model and runtime file** (`assetVersion()` in `scripts/emoji-assets.mjs`), not over the revision: it changes exactly when a byte the device runs changes (the weights, the tokenizer, the ORT glue or wasm), so an immutable cache entry can never be mistaken for a new file, and re-pinning the repository to a new revision with identical files keeps the version, and every device's download, unchanged. (The earlier draft hashed the revision too; that would have forced a 49 MB re-download for a revision bump with identical files.) With the pinned manifest the version is `db5f70d71a67`. `vite.config.ts` and `vitest.config.ts` compute the same value and inject it as `__EMOJI_ASSET_VERSION__`, plus the size of a full download (49,016,090 bytes) as `__EMOJI_DOWNLOAD_BYTES__`.
- **A manifest pins everything.** `apps/web/emoji-assets.json` records the revision, the size and SHA-256 of each file and the transformers.js and `onnxruntime-web` versions. The script refuses an installed transformers.js that differs from the pin. `node scripts/fetch-emoji-assets.mjs --update [revision]` re-pins (default: the model's current `main` revision from the Hugging Face API) and rewrites the manifest; the maintainer reviews the diff.
- **Fetch script behaviour.** Skips each file that already exists with the right size and checksum; downloads the rest with up to 3 attempts for network errors and 5xx (a 4xx fails at once); writes to `*.part` and renames only after the checksum matches; **a checksum mismatch or a download that still fails after the retries exits 1** (a build must never silently ship without the model or with an altered one); removes sibling version folders; `SKIP_EMOJI_MODEL=1` (or `true`) is the explicit opt-out and exits 0 without touching anything. The ORT files are copied from `node_modules` (found by `realpath` of the installed transformers.js, which works with pnpm and with a flat layout) and verified against the manifest.
- **Docker layering.** `RUN node apps/web/scripts/fetch-emoji-assets.mjs` sits right after `pnpm install --frozen-lockfile` and before the source `COPY`s, with only `emoji-assets.json` and the two scripts copied before it. The 49 MB download layer is therefore invalidated only by the lockfile, the manifest or those scripts, never by source changes. `ARG SKIP_EMOJI_MODEL` is the opt-out (`docker build --build-arg SKIP_EMOJI_MODEL=1 …` builds an image whose Download button fails for everyone (the files answer 404)). `.dockerignore` excludes `apps/web/public/assets/emoji` so a developer's local copy can never leak a different version into the image. The image grows by about 49 MB.
- **CI.** The `image` job builds with the Dockerfile and needs nothing else. The `e2e` job runs `pnpm --filter @tagteam/web emoji:assets` (GitHub runners have network access; no `actions/cache` is added, and the script's retries cover a flaky download; add a cache later if Hugging Face rate-limits) and then also runs the worker smoke test with the model required. The first e2e spec (a device that has not downloaded anything never asks for the model) always runs; the model specs are skipped when the files are absent **unless** `CI` is set, where absence fails them. The `test` job needs no model.
- **The server answers 404 for a missing file under `/assets/`.** Until now it fell back to `index.html` with status 200, so a missing `config.json` arrived as HTML (a `SyntaxError` in the library) and, worse, transformers.js would have stored that response in the Cache API as if it were the model. Task 2 fixes it with a real-server test (the `app.request` test harness drops headers set after the body, so the cache header can only be asserted over HTTP).
- **Index files are Vite-hashed assets, not `/assets/emoji/{version}/` files (amends spec §9's table).** `bits.bin` and `int8.bin` are committed under `src/features/emoji/index/`, imported by the worker with `?url` (Vite emits `assets/bits-HASH.bin`), and precached by adding `bin` to the Serwist glob. Their hashed names give cache-busting for free. `catalog.json` stays the hashed chunk Plan 9 shipped. The worker bundle (about 0.5 MB, `.js`) is precached by the existing glob. The model and the wasm are not in the precache, so installing the app is not blocked by 49 MB.
- **A committed `index.json` guards the index, and it is why an old download can never run with a new build.** It records the count, the dimension, the int8 scale, the SHA-256 of `catalog.json`, and `modelFilesDigest` (a digest of the model files' checksums, `modelFilesDigest()` in `emoji-assets.mjs`); a test fails when the catalog or the model files change without `pnpm --filter @tagteam/web emoji:index` being re-run. A change of the revision alone does not change the digest.
- **The search math has no imports** (`search.ts`, `auto-pick.ts`) so the `.mjs` build and evaluation scripts can load the `.ts` files directly through Node's type stripping (Node 24 is the repo's minimum). The scripts therefore evaluate exactly what ships.
- **Worker protocol.** Main → worker: `{ type: "init", id, count, allowNetwork, totalBytes }` and `{ type: "rank", id, text }`. Worker → main: `{ type: "ready", id }`, `{ type: "progress", id, loaded, total }` (once per whole percent), `{ type: "ranked", id, indices, scores }` (at most 40 catalog positions, best first), `{ type: "error", id | null, kind, message }`. With `allowNetwork: false` (every start except the Download button) the worker first checks that all six files are in the Cache API and answers `uncached` otherwise; it never fetches. With `allowNetwork: true` it fetches each missing file itself (`fetch(url, { cache: "no-store" })`, streamed, bytes counted for `progress`) and `cache.put`s it under the absolute URL transformers.js looks it up by, then lets transformers.js load from its cache. Why not transformers.js's own `progress_callback`: it reports only the 34 MB weights, and in Chromium its two requests for the weights with a progress callback produced `net::ERR_CACHE_WRITE_FAILURE` in the trial; one streamed request per file with `no-store` does not, also avoids a second copy in the HTTP cache, and makes a storage quota error surface from `cache.put` as `QuotaExceededError`. The worker never loads `catalog.json`; the main thread maps positions to emoji, drops anything that fails `isEmoji`, de-duplicates by `emojiKey` and applies the auto-pick exclusion. The worker answers requests one at a time. The **2 s timeout lives on the main thread**: a timed-out request resolves `[]` and is removed from the pending map, so a late reply (matched by `id`) is ignored. `kind` is one of `uncached | offline | quota | corrupt | index | load | runtime`.
- **Failure classification.** The worker checks the Cache API for all six files before loading. A load that fails with all files present is `corrupt` (the controller deletes this version's Cache API entries and forgets the download); without them, `uncached` when the network was not allowed, `offline` when `navigator.onLine` is false (not counted as a failed start: a person who presses Download offline has not made the device fail), else `load` (counted). `QuotaExceededError` is `quota`. Any `error` message at any time is fatal: terminate, `unavailable`, no restart this app start. On the Me screen the kinds become five plain reasons: `offline`, `storage`, `load` (everything else), `stopped` (three failed starts) and `unsupported`.
- **Where the engine's state lives: `localStorage`, not Dexie.** It must be readable synchronously at startup, it must survive a tab that crashes while the model loads (the marker is written before the load), and sign-out clears the Dexie store but a device setting is not the user's data. Keys: `tagteam.emoji.optedIn` (the person pressed Download and has not removed it; **default false**), `tagteam.emoji.installed` (the asset version whose download finished and loaded, or absent), `tagteam.emoji.autoOff` (`"crash"` when two crashes switched suggestions off), `tagteam.emoji.state` (`{ version, loading, strikes, failedStarts }`, ignored when `version` differs from the current asset version). **An opt-in only lasts once a download has finished:** at startup `optedIn` without `installed` is reset to false (a first download that failed, was interrupted or crashed leaves the device back at the default; the Me screen showed the failure while the app was open). The awaiting-emoji list, which belongs to a signed-in user, is in the Dexie `meta` table (`MetaKey` `"awaitingEmoji"`) and goes with the rest of the local data at sign-out. All `localStorage` access is wrapped in try/catch.
- **Status and restarts.** Engine status: `off` when the person has not opted in; otherwise `loading`, `ready`, or `unavailable` (not started yet, failed, or an update is pending). There is one start per app start and no restart after a failure; the only things that start a download are the Download button and its siblings (`download()`); `wake()` (the New task sheet opens) and `warmUp()` (5 s after the first successful sync) only load a copy that is already stored for the current version, so they work offline and never use the network. `dispose()` returns the controller to "not started" so a remounted app can wake it. A deliberate stop (Remove, Cancel, dispose) clears the loading marker; a crash cannot, and that is what the next start counts. Strikes reset on a success (not when Download is pressed, so crashes keep adding up across manual retries); the failed-start count also resets on Download. Two strikes switch suggestions off like Remove would, **and delete the stored model** (a device that cannot hold it should not keep 49 MB of it) with the one-line explanation on Me and the Download button again. If the browser evicted the stored copy (`uncached`), the device returns to the default with the note "The browser removed the download to free space." and nothing counts as a failure. Unsupported browsers (no WebAssembly, no Cache API, no module workers) show "This browser can't run emoji suggestions." with no button.
- **`EmojiEngine` grows two optional pieces.** `suggest(title, { autoPick? })` and `wake?()` (loads a stored copy; never downloads). `suggest` returns up to three valid emoji, de-duplicated, best first. **The auto-pick exclusion (flags, symbols, clock faces) applies only when `autoPick` is true**, which the sheet's automatic fill and the late picks pass; the picker's own "Suggested" row and its search stay unfiltered.
- **The exclusion is gated by the evaluation, and the trial says no.** `AUTO_PICK_EXCLUSION` ships as `false`. `emoji:eval` measures the shipped search on the 79 labelled titles with and without the exclusion and prints ADOPT only when first-pick accuracy does not drop. On the committed index it printed 46 → 45 of 79 (REJECT): the exclusion gains "Clean the litter tray" (🧹 instead of 🚮) but loses "Study Spanish" (🇪🇸) and "Drink 2 litres of water" (🚰), and "Take the bins out" and "Take out the recycling" move to the wastebasket, which is also right. Task 10 re-runs it and sets the flag to what the script says.
- **Automatic emoji in the sheet.** A `useAutoEmoji` hook (300 ms debounce, 3+ characters, engine ready, active only while the sheet is New and `emojiChosen` is false). A result for a title that changed or after the person picked is dropped twice (effect cleanup and a check inside the state update). A title that gets shorter again leaves the filled emoji alone (it is not reset). `wake()` is called when a New task sheet opens, not for Edit.
- **Listing for late picks.** A task is listed when the sheet creates it, or the Today screen accepts a suggestion for it, **with no stored emoji and while the engine is not `off`** (`off` is now every device that has not downloaded the model, so tasks created before the person opts in are never listed and never late-picked; tasks created while opted in but still downloading or loading, or while an update is pending, are listed and picked when the engine is ready). The write is fire-and-forget so submitting never waits. The runner (`LatePicks`) works only when the engine is ready **and** a sync has succeeded since the app started (so a task another device already gave an emoji is not overwritten from a stale local copy) and the list is not empty; it also reacts to tasks listed while the engine is already ready (the person tapped Create inside the 300 ms debounce). Each task leaves the list before the engine is asked (one attempt). A late pick stamps `at = Date.now()`, so under last-writer-wins it can overwrite an emoji another device set but not yet synced to this one; the sync-first rule narrows that window.
- **The Me section (replaces the earlier on/off switch).** A section "Emoji suggestions" with the helper "Suggests an emoji while you type a task name. Needs a one-time download of about 49 MB and works offline afterwards. Wi-Fi is best.", one `role="status"` line, an optional detail line, a progress bar while downloading, and one button of at least 44 px: not downloaded → "Emoji suggestions are off." + **Download**; downloading → "Downloading… 42%" (a bar, and the words, so never colour alone) + **Cancel**; loading → "Getting emoji suggestions ready…" + **Remove download**; ready → "Emoji suggestions are on" + "They work offline." + **Remove download**; failed → one sentence (offline / storage / load / stopped) + **Try again**; unsupported → one sentence, no button; an update → "An update is available." + "Suggestions are paused until you download it. It is about 49 MB, so Wi-Fi is best." + **Download**; after two crashes or an eviction → "Emoji suggestions are off." with the explanation and **Download** again. Pressing Download is the opt-in; Remove download (and Cancel) delete every stored version and return to the default. Progress is real: the worker counts the bytes of all six files (49,016,090 in total). Cancel is cheap (terminate the worker; nothing partial is ever stored because a file is `cache.put` only after its last byte) and is included.
- **A new asset version (owner decision, 2026-10-02): the Me section is the only place that says so, and the old download is never used.** When the app ships a new asset version, a device that downloaded the previous one shows "An update is available." in that section, with a **Download** button, and nowhere else: no toast, badge, banner or dot on the Me tab, nothing on Today or in the sheet. Nothing downloads automatically. **Which case applies:** an older download does *not* keep working with a newer app. The asset version changes exactly when the weights, tokenizer, or the ORT glue/wasm change; the committed index is built for specific weights (`modelFilesDigest` in `index.json`, tested) and the worker bundle is bound to one transformers.js and ORT pair, so a new version always means a new index or a new runtime. The controller therefore makes the check explicit: it loads a stored copy only when `installed === version`; any other value is "update available" (status `unavailable`, no worker, no request), covered by tests ("a download from an older asset version is never used by this build"). Suggestions are paused meanwhile and the sheet shows the default emoji; tasks created meanwhile are listed and late-picked after the update. The old files stay on the device, unused, until the update is installed (the controller then deletes the other versions) or the person presses Remove download. A revision bump with identical files does not change the version, so it never shows an update.
- **What changed from the earlier draft of this plan:** default-on and background download after the first sync became opt-in; the on/off switch became the download/remove section above; `enabled` became `optedIn` plus `installed`; `isOnline` left the controller (the background load no longer needs the network); `suggest` failures and the late-pick rules are unchanged; the asset version no longer includes the revision; the worker now downloads and stores the files itself and reports progress.
- **Tests without the model.** Unit tests use a `FakeWorker` driven by hand, a fake `EmojiEngine`/`EmojiController` and in-memory engine storage (`src/test/emoji.ts`). The real model runs in three places only: the worker smoke test (`pnpm --filter @tagteam/web smoke:emoji-worker`, a second Vite entry gated by `EMOJI_SMOKE=1`), `e2e/emoji-suggestions.spec.ts` (production build + real server) and the evaluation script. Because the default is now "not downloaded", the existing specs need no change and never race the model. The model specs press Download on Me first. Playwright's WebKit cannot reload a service-worker page while offline (as in `app.spec.ts`), so the new spec proves "works from the stored copy" in both engines by aborting the network for `/assets/emoji/**` and reloading, and additionally reloads fully offline in Chromium.
- **Spec amendments Task 11 makes:** §2 table ("Opt-out" becomes opt-in), §6 "Me", §7 "Loading" and the failure table's wording (retries, toggle), §9 (index files are hashed assets precached with the `bin` glob, the missing-file 404, the pinned manifest and the version rule), §7 (the exclusion's evaluation result, the measured accuracy on the shipped index). §10 is unaffected.
- **Real code vs spec found while planning:** spec §9 says the three catalog files are served from `/assets/emoji/{version}/` and precached by "the Serwist glob gains the three catalog files"; in fact `catalog.json` has been a hashed chunk since Plan 9 and only `bin` is added to the glob. The spike's 79-title numbers (57% / 80%) reproduce on the repo's catalog and the node-built index as 58% first / 78% in the top three (46 and 62 of 79).

## File Structure

```
apps/web/
  emoji-assets.json                  (new) pinned model revision, sizes, SHA-256s, runtime versions
  emoji-smoke.html                   (new) page for the worker smoke test (only in the EMOJI_SMOKE build)
  playwright.smoke.config.ts         (new) smoke test: preview build in Chromium + WebKit, dev server in Chromium
  package.json                       + @huggingface/transformers 4.3.0; scripts emoji:assets, emoji:index, emoji:eval, smoke:emoji-worker
  vite.config.ts                     worker format es + plugin, __EMOJI_ASSET_VERSION__, glob + bin, EMOJI_SMOKE entry
  vitest.config.ts / tsconfig.json   define, include build-plugins and scripts
  build-plugins/no-ort-default-wasm.ts (+ test)   (new) keeps ORT's 27 MB default wasm out of the build
  e2e-smoke/emoji-worker.spec.ts     (new)
  e2e/emoji-helpers.ts               (new) model path helpers
  e2e/emoji-suggestions.spec.ts      (new) fresh device makes no model request; Download, auto-fill, offline, Remove, late pick, Cancel, update
  public/assets/emoji/{version}/     (git-ignored) models/… and ort/… written by emoji:assets
  scripts/emoji-assets.mjs (+ .d.mts, test)   (new) manifest, version, verify, download, copy, re-pin
  scripts/fetch-emoji-assets.mjs     (new) the command
  scripts/build-emoji-index.mjs      (new) writes src/features/emoji/index/*
  scripts/eval-emoji.mjs             (new) accuracy on the labelled titles; gates the auto-pick exclusion
  scripts/emoji-eval-titles.json (+ test)     (new) the spike's 79 labelled titles
  src/features/emoji/
    assets.ts (+ test)               (new) paths, version, stored files, download size
    search.ts (+ test)               (new) sign bits, quantise, rank
    index/{bits.bin,int8.bin,index.json} + index.test.ts   (new, committed)
    worker-protocol.ts, worker-core.ts (+ test), worker.ts   (new)
    cache.ts, support.ts, engine-storage.ts (+ tests)        (new)
    auto-pick.ts (+ test)            (new) exclusion list and the gated flag
    controller.ts (+ test)           (new) the engine state machine
    engine.ts                        suggest options, wake
    browser-deps.ts, EmojiEngineHost.tsx (+ test)  (new) provider, settings, warm-up, late-pick runner
    awaiting.ts, late-pick.ts, LatePicks.tsx (+ tests)       (new)
  src/features/add-task/useAutoEmoji.ts, AddTaskSheet.tsx, draft.ts (+ tests)
  src/features/today/TodayScreen.tsx (+ accept-emoji test)
  src/features/me/EmojiSuggestionsSettings.tsx (+ test), MeScreen.tsx   the Download / Remove download section
  src/session/SessionGate.tsx        wraps the app in EmojiEngineHost
  src/store/db.ts                    MetaKey "awaitingEmoji"
  src/test/emoji.ts                  (new) FakeWorker, memoryEngineStorage, fakeEmojiEngine, fakeEmojiController
apps/server/src/app.ts, static.test.ts   404 for a missing /assets/ file
Dockerfile, .dockerignore, .gitignore, .github/workflows/ci.yml, README.md
docs/STATUS.md, docs/superpowers/specs/2026-10-01-task-look-and-emoji-design.md
```

Task order: 1 bundling proof → 2 asset pipeline and delivery → 3 index → 4 worker → 5 engine controller → 6 provide the engine, warm-up → 7 Me section (Download, Remove download) → 8 automatic emoji in the sheet → 9 awaiting list and late picks → 10 evaluation and the exclusion gate → 11 end to end, CI, visual and device checks, docs.

**Spec coverage** (each Plan 10 item and the task that implements it): §2 Opt-out → opt-in (Download on Me, default off) → Tasks 5–7; §6 sheet auto-fill, debounce, stale drop, hand-picked/`emojiChosen`, never Edit, never colour, submit never waits → Task 8; late pick and the awaiting list, "Use default", pre-existing tasks and tasks created before opting in never picked → Task 9; §6 Me (now the Download / Remove download section) → Tasks 6–7; §7 engine, model, catalog, index, runtime, loading (a stored copy only, background load 5 s after the first sync, sheet open), auto-pick candidates → Tasks 3–6 and 10; §7 failure table: files missing/download fails/offline → Tasks 4–5 and the Me "failed" states (Task 7), no WebAssembly/workers/Cache API → Tasks 5 and 7 (`support.ts`, controller, "This browser can't run…"), 60 s timeout (a download: 60 s without bytes) → Task 5, worker error → Task 5, 2 s/malformed/three in a row → Task 5, corrupt cache → Tasks 4–5, quota → Tasks 4–5 and 7, crash marker and two strikes (switch-off with the explanation and Download again on Me) → Tasks 5 and 7, three failed starts (until the version changes or Download is pressed) → Tasks 5 and 7, invalid emoji replaced by none → Task 8, late pick failure for one task → Task 9, catalog fails to load → Task 5 (engine) and the existing picker (keyboard field only); new rules: nothing downloads without Download (fresh device makes no request), eviction returns to the default, an update shows only on Me and an old download is never used → Tasks 4, 5, 7 and 11; §9 assets, versioned path, checksum fetch, Docker/CI, precache glob, old-version cleanup, `localModelPath`/`wasmPaths` → Tasks 1–6 and 11; §10 persistent storage was Plan 9; §11 testing (fake worker per failure row, search against a fixture index, late-pick cases, edit never fills, evaluation) → Tasks 3–5, 8–10; §12/§14 bundling risk → Task 1.

---

### Task 1: Prove transformers.js runs in a Vite-built module worker

**Files:**
- Create: `apps/web/build-plugins/no-ort-default-wasm.ts`, `apps/web/emoji-smoke.html`, `apps/web/playwright.smoke.config.ts`, `apps/web/src/features/emoji/worker.ts` (a smoke version that Task 4 replaces)
- Test: `apps/web/build-plugins/no-ort-default-wasm.test.ts`, `apps/web/e2e-smoke/emoji-worker.spec.ts`
- Modify: `apps/web/package.json` (+ `pnpm-lock.yaml`), `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/tsconfig.json`, `.gitignore`

**Interfaces:**
- Consumes: spec §14 "Bundling risk" (the spike loaded the library's prebuilt bundle directly; importing it through Vite in a worker was untested).
- Produces — **the facts every later task assumes.** If this task finds that any of them is false, it changes the approach (for example `worker.format`, `optimizeDeps`, aliasing the bundle entry, or serving the library as a static file and `import()`ing it by URL), records exactly what it did in its report and in the commit message, and edits the affected sentences in the "Decisions made while planning" section above before committing:
  1. `src/features/emoji/worker.ts` may `import { env, pipeline } from "@huggingface/transformers"` (the bare specifier; it resolves to `dist/transformers.web.js`) and Vite bundles it as a module worker when app code (or `emoji-smoke.html`) says `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`. The build config needs `worker: { format: "es" }` and nothing else (no alias, no `optimizeDeps`).
  2. `noOrtDefaultWasm()` from `build-plugins/no-ort-default-wasm.ts` is registered in `worker.plugins`, so `dist/assets` contains no `.wasm` file (without it Vite emits the library's 26,861,777-byte `ort-wasm-simd-threaded.asyncify.wasm`).
  3. In the worker: `env.allowLocalModels = true; env.allowRemoteModels = false; env.localModelPath = "<a path>"; env.useBrowserCache = typeof caches !== "undefined"; env.backends.onnx.wasm.wasmPaths = { mjs, wasm }` (absolute-URL strings built from same-origin paths), and `pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", { dtype: "q8", device: "wasm" })` called with `{ pooling: "cls", normalize: true }` returns a 384-number normalised vector.
  4. With the model files absent, the worker fails with `ModelFileNotFoundError` (production preview server, which answers 404) or `SyntaxError` (the dev server, which answers `index.html` for unknown paths).
  5. `pnpm --filter @tagteam/web smoke:emoji-worker` builds only `emoji-smoke.html` (`EMOJI_SMOKE=1`) into `dist-smoke/` and runs `playwright.smoke.config.ts` against `vite preview` (Chromium and WebKit) and `vite` (Chromium). `EMOJI_SMOKE_REQUIRE_MODEL=1` makes the model files mandatory.

- [ ] **Step 1: Add the dependency, pinned exactly**

Run: `pnpm --filter @tagteam/web add --save-exact @huggingface/transformers@4.3.0`
Expected: `apps/web/package.json` gains `"@huggingface/transformers": "4.3.0"` under `dependencies` (no caret) and `pnpm-lock.yaml` changes by a couple of hundred lines (it adds `onnxruntime-web 1.31.0-dev.20260914-8d85527a0`, `onnxruntime-node` and their dependencies; pnpm's `onlyBuiltDependencies` keeps their install scripts from running).

- [ ] **Step 2: Write the failing test for the Vite plugin**

Create `apps/web/build-plugins/no-ort-default-wasm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rewriteOrtWasmUrls } from "./no-ort-default-wasm";

describe("rewriteOrtWasmUrls", () => {
	it("gives the default wasm URL a base that Vite cannot resolve", () => {
		const code =
			'const wasm = new URL("ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href;';
		expect(rewriteOrtWasmUrls(code)).toBe(
			'const wasm = new URL("ort-wasm-simd-threaded.asyncify.wasm", "http://wasm.invalid/").href;',
		);
	});

	it("rewrites every occurrence, with or without a space after the comma", () => {
		const code =
			'a(new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url));b(new URL("ort-wasm-simd-threaded.jspi.wasm", import.meta.url));';
		const result = rewriteOrtWasmUrls(code);
		expect(result).not.toContain("import.meta.url");
		expect(result?.match(/wasm\.invalid/g)).toHaveLength(2);
	});

	it("leaves other URLs and unrelated code alone", () => {
		expect(
			rewriteOrtWasmUrls('new URL("./worker.ts", import.meta.url)'),
		).toBeNull();
		expect(rewriteOrtWasmUrls("const x = 1;")).toBeNull();
	});
});
```

- [ ] **Step 3: Make Vitest find it, and watch it fail**

In `apps/web/vitest.config.ts` change the `include` line to:

```ts
		include: ["src/**/*.test.{ts,tsx}", "build-plugins/**/*.test.ts"],
```

Run: `pnpm --filter @tagteam/web exec vitest run build-plugins`
Expected: FAIL — `Failed to resolve import "./no-ort-default-wasm"`.

- [ ] **Step 4: Implement the plugin**

Create `apps/web/build-plugins/no-ort-default-wasm.ts`:

```ts
import type { Plugin } from "vite";

// transformers.js bundles onnxruntime-web, which names its default 27 MB wasm file with
// `new URL("ort-wasm-simd-threaded.asyncify.wasm", import.meta.url)`. Vite turns every such
// expression into an emitted asset, which would put that file in dist/ and in the Docker image
// although the app never loads it (the worker points `wasmPaths` at the plain 14 MB runtime
// that scripts/fetch-emoji-assets.mjs copies into public/). Giving the expression a base Vite
// cannot resolve keeps the string in the bundle and the file out of the build.
const ORT_WASM_URL =
	/new URL\(("ort-wasm-[a-z.-]+\.wasm"),\s*import\.meta\.url\)/g;

/** Rewrites each ORT default-wasm URL so Vite does not emit the file. Returns null when nothing matched. */
export function rewriteOrtWasmUrls(code: string): string | null {
	if (!code.includes("ort-wasm-")) return null;
	const rewritten = code.replace(
		ORT_WASM_URL,
		'new URL($1, "http://wasm.invalid/")',
	);
	return rewritten === code ? null : rewritten;
}

export function noOrtDefaultWasm(): Plugin {
	return {
		name: "tagteam:no-ort-default-wasm",
		enforce: "pre",
		transform(code, id) {
			if (
				!id.includes("/onnxruntime-web/") &&
				!id.includes("/@huggingface/transformers/")
			)
				return null;
			const rewritten = rewriteOrtWasmUrls(code);
			return rewritten === null ? null : { code: rewritten, map: null };
		},
	};
}
```

Run: `pnpm --filter @tagteam/web exec vitest run build-plugins`
Expected: PASS (3 tests).

- [ ] **Step 5: Configure Vite, TypeScript and git**

Replace the whole of `apps/web/vite.config.ts` with:

```ts
import { serwist } from "@serwist/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { noOrtDefaultWasm } from "./build-plugins/no-ort-default-wasm.ts";

// `EMOJI_SMOKE=1` builds only emoji-smoke.html into dist-smoke (see playwright.smoke.config.ts).
const smoke = process.env.EMOJI_SMOKE === "1";

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		...(smoke
			? []
			: [
					serwist({
						swSrc: "src/sw.ts",
						swDest: "sw.js",
						globDirectory: "dist",
						globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
						injectionPoint: "self.__SW_MANIFEST",
					}),
				]),
	],
	// The emoji worker imports transformers.js, which code-splits, so workers are built as ES modules.
	worker: { format: "es", plugins: () => [noOrtDefaultWasm()] },
	build: smoke
		? {
				outDir: "dist-smoke",
				rollupOptions: { input: { "emoji-smoke": "emoji-smoke.html" } },
			}
		: {},
	resolve: {
		alias: { "@": new URL("./src", import.meta.url).pathname },
	},
	server: {
		port: 5173,
		// The API server (apps/server) runs on 3000 in development.
		proxy: { "/api": { target: "http://localhost:3000" } },
	},
});
```

Replace the whole of `apps/web/tsconfig.json` with (it adds `allowImportingTsExtensions` for the plugin import in `vite.config.ts`, and the new folders):

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"lib": ["ES2023", "DOM", "DOM.Iterable"],
		"jsx": "react-jsx",
		"allowImportingTsExtensions": true,
		"paths": { "@/*": ["./src/*"] },
		"types": ["vite/client"]
	},
	"include": [
		"src",
		"e2e",
		"e2e-smoke",
		"build-plugins",
		"vite.config.ts",
		"vitest.config.ts",
		"playwright.config.ts",
		"playwright.smoke.config.ts"
	]
}
```

Append to `.gitignore`:

```
dist-smoke/
apps/web/public/assets/emoji/
```

In `apps/web/package.json`, add this script after `emoji:catalog`:

```json
		"smoke:emoji-worker": "EMOJI_SMOKE=1 vite build && playwright test --config playwright.smoke.config.ts"
```

- [ ] **Step 6: Write the smoke page, the smoke worker and the smoke test**

Create `apps/web/emoji-smoke.html`:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title>Emoji worker smoke test</title>
	</head>
	<body>
		<pre id="result">pending</pre>
		<script type="module">
			// Only the smoke build (EMOJI_SMOKE=1) includes this page.
			const worker = new Worker(
				new URL("./src/features/emoji/worker.ts", import.meta.url),
				{ type: "module" },
			);
			const show = (value) => {
				document.getElementById("result").textContent = JSON.stringify(value);
			};
			worker.onmessage = (event) => show(event.data);
			worker.onerror = (event) =>
				show({ ok: false, name: "WorkerError", message: event.message });
			worker.postMessage({ text: "Water the plants" });
		</script>
	</body>
</html>
```

Create `apps/web/src/features/emoji/worker.ts` (a smoke version: it embeds one string and reports; Task 4 replaces it with the real worker):

```ts
// Task 1 smoke version: proves the library loads and runs inside a Vite-built module worker.
// Task 4 replaces this file with the real worker.
import { env, pipeline } from "@huggingface/transformers";

const BASE = "/assets/emoji/smoke/";

env.allowLocalModels = true;
env.allowRemoteModels = false;
// A path, not an absolute URL: with a URL transformers.js 4.3 skips its local-file probe and
// reports the tokenizer as missing.
env.localModelPath = `${BASE}models/`;
env.useBrowserCache = typeof caches !== "undefined";
// Without this the library fetches its 27 MB default wasm from a CDN.
const ortWasm = env.backends.onnx.wasm;
if (!ortWasm) throw new Error("onnxruntime-web is not available");
ortWasm.wasmPaths = {
	mjs: new URL(`${BASE}ort/ort-wasm-simd-threaded.mjs`, self.location.href)
		.href,
	wasm: new URL(`${BASE}ort/ort-wasm-simd-threaded.wasm`, self.location.href)
		.href,
};

interface Scope {
	onmessage: ((event: MessageEvent<{ text: string }>) => void) | null;
	postMessage(message: unknown): void;
}
const scope = self as unknown as Scope;

scope.onmessage = async (event) => {
	try {
		const extractor = await pipeline(
			"feature-extraction",
			"Xenova/bge-small-en-v1.5",
			{
				dtype: "q8",
				device: "wasm",
			},
		);
		const output = await extractor(event.data.text, {
			pooling: "cls",
			normalize: true,
		});
		const vector = Array.from(output.data as Float32Array);
		scope.postMessage({
			ok: true,
			libraryVersion: env.version,
			length: vector.length,
			norm: Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)),
		});
	} catch (error) {
		scope.postMessage({
			ok: false,
			libraryVersion: env.version,
			name: error instanceof Error ? error.name : "unknown",
			message: String(error),
		});
	}
};
```

Create `apps/web/e2e-smoke/emoji-worker.spec.ts`:

```ts
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

interface SmokeResult {
	ok: boolean;
	libraryVersion?: string;
	length?: number;
	norm?: number;
	name?: string;
	message?: string;
}

const requireModel = process.env.EMOJI_SMOKE_REQUIRE_MODEL === "1";

test("transformers.js runs inside the Vite-built module worker with the self-hosted wasm", async ({
	page,
	baseURL,
}) => {
	const origin = new URL(baseURL as string).origin;
	const foreign: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.origin !== origin && url.protocol.startsWith("http"))
			foreign.push(request.url());
	});

	await page.goto("/emoji-smoke.html");
	await page.waitForFunction(
		() => document.getElementById("result")?.textContent !== "pending",
		null,
		{ timeout: 80_000 },
	);
	const result = JSON.parse(
		await page.locator("#result").innerText(),
	) as SmokeResult;

	// The library was imported, initialised, and asked for the model, with nothing from a CDN.
	expect(foreign).toEqual([]);
	expect(result.libraryVersion).toBe("4.3.0");
	if (requireModel) {
		expect(result).toMatchObject({ ok: true, length: 384 });
		expect(result.norm).toBeCloseTo(1, 3);
	} else if (!result.ok) {
		// Without the model files the only acceptable failure is a missing file: a 404 in the
		// preview server, or index.html served in place of config.json by the dev server.
		expect(["ModelFileNotFoundError", "SyntaxError"]).toContain(result.name);
	}
});

test("the production build emits no ONNX Runtime wasm of its own", () => {
	test.skip(
		test.info().project.name.startsWith("dev"),
		"checks the build output",
	);
	const assets = join(import.meta.dirname, "../dist-smoke/assets");
	const files = readdirSync(assets, { withFileTypes: true }).filter((entry) =>
		entry.isFile(),
	);
	expect(files.filter((file) => file.name.endsWith(".wasm"))).toEqual([]);
	const total = files.reduce(
		(sum, file) => sum + statSync(join(assets, file.name)).size,
		0,
	);
	// The worker bundle is about 0.5 MB; a 27 MB wasm would blow this budget.
	expect(total).toBeLessThan(2_000_000);
});
```

Create `apps/web/playwright.smoke.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

const BUILD_URL = "http://localhost:4175";
const DEV_URL = "http://localhost:4176";

// Smoke test for the emoji worker: the production build (preview server) in Chromium and WebKit,
// and the dev server in Chromium. Run with `pnpm --filter @tagteam/web smoke:emoji-worker`.
export default defineConfig({
	testDir: "e2e-smoke",
	timeout: 90_000,
	projects: [
		{
			name: "build-chromium",
			use: {
				...devices["Pixel 7"],
				browserName: "chromium",
				baseURL: BUILD_URL,
			},
		},
		{
			name: "build-webkit",
			use: {
				...devices["iPhone 13"],
				browserName: "webkit",
				baseURL: BUILD_URL,
			},
		},
		{
			name: "dev-chromium",
			use: { ...devices["Pixel 7"], browserName: "chromium", baseURL: DEV_URL },
		},
	],
	webServer: [
		{
			command: "pnpm exec vite preview --port 4175 --strictPort",
			url: `${BUILD_URL}/emoji-smoke.html`,
			env: { EMOJI_SMOKE: "1" },
			reuseExistingServer: false,
		},
		{
			command: "pnpm exec vite --port 4176 --strictPort",
			url: `${DEV_URL}/emoji-smoke.html`,
			env: { EMOJI_SMOKE: "1" },
			reuseExistingServer: false,
		},
	],
});
```

- [ ] **Step 7: Run the smoke test without the model files**

If Playwright's browsers are missing: `pnpm --filter @tagteam/web exec playwright install chromium webkit`.

Run: `pnpm --filter @tagteam/web smoke:emoji-worker`
Expected: the build lists `dist-smoke/assets/worker-….js` of about 540 kB and `emoji-smoke-….js`, and **no** `.wasm`; then PASS in all three projects: 5 passed and 1 skipped (the "production build emits no wasm" test is skipped in the dev project). With no model files each browser test sees a failed load whose `name` is `ModelFileNotFoundError` (preview) or `SyntaxError` (dev) and `libraryVersion` `4.3.0`, which proves the library was imported and ran inside the worker.

- [ ] **Step 8: Prove it with the real model**

This puts the six files where the smoke worker looks (`apps/web/public/assets/emoji/smoke/`, git-ignored; Task 2 replaces this by a script). From the repo root:

```bash
cd apps/web
SMOKE=public/assets/emoji/smoke
REV=ea104dacec62c0de699686887e3f920caeb4f3e3
mkdir -p $SMOKE/models/Xenova/bge-small-en-v1.5/onnx $SMOKE/ort
for f in config.json tokenizer.json tokenizer_config.json onnx/model_quantized.onnx; do
  curl -sSL -o "$SMOKE/models/Xenova/bge-small-en-v1.5/$f" \
    "https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/$REV/$f"
done
ORT="$(node -e 'const fs=require("fs"),p=require("path");console.log(p.join(fs.realpathSync("node_modules/@huggingface/transformers"),"..","..","onnxruntime-web","dist"))')"
cp "$ORT/ort-wasm-simd-threaded.mjs" "$ORT/ort-wasm-simd-threaded.wasm" "$SMOKE/ort/"
(cd $SMOKE && shasum -a 256 models/Xenova/bge-small-en-v1.5/config.json models/Xenova/bge-small-en-v1.5/tokenizer.json models/Xenova/bge-small-en-v1.5/tokenizer_config.json models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx ort/*)
cd ../..
```

Expected checksums, in that order: `fa73f90b…6350`, `d241a60d…5c66`, `9261e7d7…2ab3`, `6c9c6101…dfe4`, `c57ca563…de9f` (`.mjs`), `06ba0577…f9e3` (`.wasm`), equal to the table in Global Constraints. If any differs, stop: the pinned revision or the installed `onnxruntime-web` is not what this plan was written against.

Run: `EMOJI_SMOKE_REQUIRE_MODEL=1 pnpm --filter @tagteam/web smoke:emoji-worker`
Expected: 5 passed, 1 skipped. Each browser test now sees `ok: true`, a vector of 384 numbers with norm 1 (± 0.001), and no request to any other origin. This is the proof that the self-hosted plain wasm works with the library's webgpu-flavoured ORT bundle that Vite resolves, in dev, in the production build, in Chromium and in WebKit.

- [ ] **Step 9: Record the result**

In the task report, state: the import form used, the Vite config needed and whether anything in "Interfaces → Produces" had to change.

- [ ] **Step 10: Repo checks and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (web gains the 3 plugin tests).

```bash
git add .gitignore pnpm-lock.yaml apps/web/package.json apps/web/vite.config.ts apps/web/vitest.config.ts apps/web/tsconfig.json apps/web/build-plugins apps/web/emoji-smoke.html apps/web/playwright.smoke.config.ts apps/web/e2e-smoke apps/web/src/features/emoji/worker.ts
git commit -m "feat(web): bundle transformers.js in a module worker and smoke-test it"
```

---

### Task 2: Fetch, verify and serve the model files (asset pipeline)

**Files:**
- Create: `apps/web/emoji-assets.json`, `apps/web/scripts/emoji-assets.mjs`, `apps/web/scripts/emoji-assets.d.mts`, `apps/web/scripts/fetch-emoji-assets.mjs`, `apps/web/src/features/emoji/assets.ts`
- Test: `apps/web/scripts/emoji-assets.test.ts`, `apps/web/src/features/emoji/assets.test.ts`, `apps/server/src/static.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/tsconfig.json`, `apps/web/package.json`, `Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: the manifest values in Global Constraints; the installed `@huggingface/transformers` 4.3.0 (Task 1).
- Produces:
  - `emoji-assets.json` (`{ model: { id, revision, files: [{ path, sha256, bytes }] }, runtime: { transformers, onnxruntimeWeb, files: [...] } }`).
  - `scripts/emoji-assets.mjs`: `loadManifest(path?)`, `assetVersion(manifest): string` (12 hex; a digest of every model and runtime file checksum, **not** of the revision), `modelFilesDigest(manifest): string` (64 hex; model files only, recorded in the index), `downloadBytes(manifest): number` (49,016,090), `modelUrl(manifest, file)`, `sha256Of(bytes)`, `checkFile(path, entry): "ok" | "missing" | "bad"`, `download(url, opts)`, `findOrtDist(webRoot?)`, `installedTransformersVersion(webRoot?)`, `fetchEmojiAssets({ manifest, root?, ortDist, transformersVersion, fetchImpl?, attempts?, retryDelayMs?, log? }): Promise<{ version, dir, downloaded, kept, copied, pruned }>`, `buildManifest({ manifest, revision, ortDist, transformersVersion, ortVersion, ... })`, constants `MANIFEST_PATH`, `ASSETS_ROOT`, `WEB_ROOT`; typed by `emoji-assets.d.mts`.
  - Command `pnpm --filter @tagteam/web emoji:assets` (`-- --update [revision]` re-pins; `SKIP_EMOJI_MODEL=1` opts out). Output folder `apps/web/public/assets/emoji/<version>/{models/Xenova/bge-small-en-v1.5/…, ort/…}`.
  - `src/features/emoji/assets.ts`: `EMOJI_MODEL_ID`, `EMOJI_ASSET_VERSION`, `EMOJI_DOWNLOAD_BYTES`, `EMOJI_ASSET_BASE` (`/assets/emoji/<version>/`), `EMOJI_MODEL_PATH` (`…/models/`), `EMOJI_ORT_MJS_PATH`, `EMOJI_ORT_WASM_PATH`, `EMOJI_STORED_PATHS` (the six files a device stores), `EMOJI_ASSETS_ROOT` (`/assets/emoji/`), `EMOJI_CACHE_NAME` (`"transformers-cache"`), with the globals `__EMOJI_ASSET_VERSION__` and `__EMOJI_DOWNLOAD_BYTES__` defined by Vite and Vitest.
  - The server answers 404 for a missing `/assets/…` file.

- [ ] **Step 1: Write the failing server test**

Create `apps/server/src/static.test.ts` (it uses a real HTTP server because the `app.request` harness loses headers set after the body):

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RunningServer, startServer } from "./server";
import { TEST_CONFIG } from "./test/harness";

describe("static web app", () => {
	let dir: string;
	let server: RunningServer;
	let base: string;
	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "tagteam-web-"));
		mkdirSync(join(dir, "assets", "emoji", "v1"), { recursive: true });
		writeFileSync(join(dir, "index.html"), '<div id="root"></div>');
		writeFileSync(join(dir, "assets", "app.js"), "export {};");
		writeFileSync(join(dir, "assets", "emoji", "v1", "config.json"), "{}");
		server = await startServer({
			...TEST_CONFIG,
			port: 0,
			webDir: dir,
			databasePath: join(dir, "tagteam.db"),
		});
		base = `http://localhost:${server.port}`;
	});
	afterEach(async () => {
		await server.stop();
		rmSync(dir, { recursive: true, force: true });
	});

	it("serves files under /assets/ as immutable", async () => {
		for (const path of ["/assets/app.js", "/assets/emoji/v1/config.json"]) {
			const res = await fetch(`${base}${path}`);
			expect(res.status, path).toBe(200);
			expect(res.headers.get("cache-control"), path).toBe(
				"public, max-age=31536000, immutable",
			);
		}
	});

	it("answers 404, not the app shell, for a missing file under /assets/", async () => {
		// A model file served as index.html would be cached by the browser as if it were the model.
		const res = await fetch(`${base}/assets/emoji/v1/missing.onnx`);
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).not.toContain("text/html");
	});

	it("serves the app shell with no-cache for other paths", async () => {
		const res = await fetch(`${base}/today`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-cache");
		expect(await res.text()).toContain('id="root"');
	});
});
```

Run: `pnpm --filter @tagteam/server exec vitest run src/static.test.ts`
Expected: FAIL only in "answers 404, not the app shell, for a missing file under /assets/" (`expected 200 to be 404`); the other two pass.

- [ ] **Step 2: Make the server answer 404 for a missing `/assets/` file**

In `apps/server/src/app.ts`, inside `if (webDir) {`, after the `isApi` line add:

```ts
		// A missing built file must answer 404. Falling back to the app shell would hand the
		// browser index.html in place of a script or a model file, and it would cache it.
		const isAsset = (path: string) => path.startsWith("/assets/");
```

and change the second `app.on(["GET", "HEAD"], "*", …)` handler to:

```ts
		app.on(["GET", "HEAD"], "*", (c, next) =>
			isApi(c.req.path) || isAsset(c.req.path) ? next() : appShell(c, next),
		);
```

Run: `pnpm --filter @tagteam/server exec vitest run src/static.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Write the failing script tests**

Create `apps/web/scripts/emoji-assets.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assetVersion,
	buildManifest,
	checkFile,
	downloadBytes,
	type EmojiAssetManifest,
	fetchEmojiAssets,
	loadManifest,
	modelFilesDigest,
	sha256Of,
} from "./emoji-assets.mjs";

const bytes = (text: string) => Buffer.from(text);
const entry = (path: string, text: string) => ({
	path,
	sha256: sha256Of(bytes(text)),
	bytes: bytes(text).length,
});

const REVISION = "a".repeat(40);
const manifest: EmojiAssetManifest = {
	model: {
		id: "Org/tiny-model",
		revision: REVISION,
		files: [entry("config.json", "{}"), entry("onnx/model.onnx", "weights")],
	},
	runtime: {
		transformers: "9.9.9",
		onnxruntimeWeb: "1.0.0",
		files: [entry("ort.mjs", "glue"), entry("ort.wasm", "wasm")],
	},
};
const CONTENT: Record<string, string> = {
	"config.json": "{}",
	"onnx/model.onnx": "weights",
};

let root: string;
let ortDist: string;
beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "emoji-assets-"));
	root = join(dir, "emoji");
	ortDist = join(dir, "ort-dist");
	mkdirSync(ortDist);
	writeFileSync(join(ortDist, "ort.mjs"), "glue");
	writeFileSync(join(ortDist, "ort.wasm"), "wasm");
});
afterEach(() => rmSync(join(root, ".."), { recursive: true, force: true }));

function fakeFetch(overrides: Record<string, () => Response> = {}) {
	return vi.fn(async (url: string) => {
		const path = url.replace(
			`https://huggingface.co/Org/tiny-model/resolve/${REVISION}/`,
			"",
		);
		const override = overrides[path];
		if (override) return override();
		return new Response(CONTENT[path] ?? "", {
			status: path in CONTENT ? 200 : 404,
		});
	});
}
const run = (fetchImpl: ReturnType<typeof fakeFetch>, extra = {}) =>
	fetchEmojiAssets({
		manifest,
		root,
		ortDist,
		transformersVersion: "9.9.9",
		fetchImpl,
		retryDelayMs: 0,
		...extra,
	});

describe("assetVersion", () => {
	it("is 12 hex digits and does not depend on file order", () => {
		const version = assetVersion(manifest);
		expect(version).toMatch(/^[0-9a-f]{12}$/);
		const reordered = {
			...manifest,
			model: { ...manifest.model, files: [...manifest.model.files].reverse() },
		};
		expect(assetVersion(reordered)).toBe(version);
	});

	it("changes with any file checksum, but not with the revision alone", () => {
		const version = assetVersion(manifest);
		expect(
			assetVersion({
				...manifest,
				model: { ...manifest.model, revision: "b".repeat(40) },
			}),
		).toBe(version);
		expect(
			assetVersion({
				...manifest,
				runtime: {
					...manifest.runtime,
					files: [entry("ort.mjs", "glue"), entry("ort.wasm", "other wasm")],
				},
			}),
		).not.toBe(version);
		expect(
			assetVersion({
				...manifest,
				model: {
					...manifest.model,
					files: [
						entry("config.json", "{}"),
						entry("onnx/model.onnx", "new weights"),
					],
				},
			}),
		).not.toBe(version);
	});
});

describe("modelFilesDigest and downloadBytes", () => {
	it("digest only the model files, so a runtime change keeps the index valid", () => {
		const digest = modelFilesDigest(manifest);
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		expect(
			modelFilesDigest({
				...manifest,
				runtime: { ...manifest.runtime, files: [entry("ort.wasm", "other")] },
			}),
		).toBe(digest);
		expect(
			modelFilesDigest({
				...manifest,
				model: { ...manifest.model, files: [entry("onnx/model.onnx", "new")] },
			}),
		).not.toBe(digest);
	});

	it("add up every file a device downloads", () => {
		expect(downloadBytes(manifest)).toBe(2 + 7 + 4 + 4);
	});
});

describe("committed manifest", () => {
	it("pins a full revision and a checksum and size for every file", () => {
		const committed = loadManifest();
		expect(committed.model.revision).toMatch(/^[0-9a-f]{40}$/);
		expect(committed.model.files.map((file) => file.path).sort()).toEqual([
			"config.json",
			"onnx/model_quantized.onnx",
			"tokenizer.json",
			"tokenizer_config.json",
		]);
		for (const file of [...committed.model.files, ...committed.runtime.files]) {
			expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
			expect(file.bytes, file.path).toBeGreaterThan(0);
		}
		expect(committed.runtime.files.map((file) => file.path).sort()).toEqual([
			"ort-wasm-simd-threaded.mjs",
			"ort-wasm-simd-threaded.wasm",
		]);
	});
});

describe("fetchEmojiAssets", () => {
	it("downloads the model, copies the runtime and verifies every file", async () => {
		const fetchImpl = fakeFetch();
		const result = await run(fetchImpl);
		expect(result.downloaded).toEqual(["config.json", "onnx/model.onnx"]);
		expect(result.copied).toEqual(["ort.mjs", "ort.wasm"]);
		const dir = join(root, assetVersion(manifest));
		expect(result.dir).toBe(dir);
		expect(
			readFileSync(join(dir, "models/Org/tiny-model/onnx/model.onnx"), "utf8"),
		).toBe("weights");
		expect(readFileSync(join(dir, "ort/ort.wasm"), "utf8")).toBe("wasm");
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("skips files that are present and pass their checksum", async () => {
		await run(fakeFetch());
		const fetchImpl = fakeFetch();
		const result = await run(fetchImpl);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result.downloaded).toEqual([]);
		expect(result.kept).toHaveLength(4);
	});

	it("downloads again a file that is damaged or the wrong size", async () => {
		const first = await run(fakeFetch());
		const damaged = join(first.dir, "models/Org/tiny-model/config.json");
		writeFileSync(damaged, "{x}");
		expect(checkFile(damaged, manifest.model.files[0])).toBe("bad");
		const fetchImpl = fakeFetch();
		const result = await run(fetchImpl);
		expect(result.downloaded).toEqual(["config.json"]);
		expect(readFileSync(damaged, "utf8")).toBe("{}");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("rejects a download whose checksum differs and leaves nothing behind", async () => {
		const fetchImpl = fakeFetch({
			"onnx/model.onnx": () => new Response("tampered"),
		});
		await expect(run(fetchImpl)).rejects.toThrow(
			/checksum mismatch for onnx\/model\.onnx/,
		);
		const target = join(
			root,
			assetVersion(manifest),
			"models/Org/tiny-model/onnx/model.onnx",
		);
		expect(existsSync(target)).toBe(false);
		expect(existsSync(`${target}.part`)).toBe(false);
	});

	it("rejects a runtime file that no longer matches the manifest", async () => {
		writeFileSync(join(ortDist, "ort.wasm"), "different runtime");
		await expect(run(fakeFetch())).rejects.toThrow(
			/checksum mismatch for ort\.wasm/,
		);
	});

	it("rejects an installed transformers.js that is not the pinned version", async () => {
		await expect(
			run(fakeFetch(), { transformersVersion: "9.9.8" }),
		).rejects.toThrow(
			/9\.9\.8 is installed but emoji-assets\.json pins 9\.9\.9/,
		);
	});

	it("retries a server error and gives up at once on a 404", async () => {
		let calls = 0;
		const flaky = fakeFetch({
			"config.json": () =>
				++calls < 3 ? new Response("", { status: 503 }) : new Response("{}"),
		});
		await run(flaky);
		expect(calls).toBe(3);

		const missing = fakeFetch({
			"config.json": () => new Response("", { status: 404 }),
		});
		await expect(run(missing, { root: join(root, "other") })).rejects.toThrow(
			/HTTP 404/,
		);
		expect(missing).toHaveBeenCalledTimes(1);
	});

	it("removes folders of other versions", async () => {
		mkdirSync(join(root, "old-version"), { recursive: true });
		writeFileSync(join(root, "old-version", "file"), "x");
		const result = await run(fakeFetch());
		expect(result.pruned).toEqual(["old-version"]);
		expect(existsSync(join(root, "old-version"))).toBe(false);
	});
});

describe("buildManifest", () => {
	it("records the size and checksum of each file at the given revision", async () => {
		const next = await buildManifest({
			manifest,
			revision: "c".repeat(40),
			ortDist,
			transformersVersion: "9.9.9",
			ortVersion: "1.0.0",
			fetchImpl: vi.fn(async (url: string) => {
				expect(url).toContain(`/resolve/${"c".repeat(40)}/`);
				return new Response(url.endsWith("config.json") ? "{}" : "weights");
			}),
			retryDelayMs: 0,
		});
		expect(next.model.revision).toBe("c".repeat(40));
		expect(next.model.files).toEqual(manifest.model.files);
		expect(next.runtime.files).toEqual(manifest.runtime.files);
	});
});

describe("the command", () => {
	it("does nothing and succeeds when SKIP_EMOJI_MODEL=1", () => {
		const output = execFileSync(
			process.execPath,
			[join(import.meta.dirname, "fetch-emoji-assets.mjs")],
			{ encoding: "utf8", env: { ...process.env, SKIP_EMOJI_MODEL: "1" } },
		);
		expect(output).toContain("SKIP_EMOJI_MODEL is set");
	});
});
```

In `apps/web/vitest.config.ts` change `include` to:

```ts
		include: [
			"src/**/*.test.{ts,tsx}",
			"build-plugins/**/*.test.ts",
			"scripts/**/*.test.ts",
		],
```

In `apps/web/tsconfig.json` add `"scripts",` to `include` (after `"build-plugins",`).

Run: `pnpm --filter @tagteam/web exec vitest run scripts`
Expected: FAIL — `Failed to resolve import "./emoji-assets.mjs"`.

- [ ] **Step 4: Implement the manifest and the helpers**

Create `apps/web/emoji-assets.json`:

```json
{
	"model": {
		"id": "Xenova/bge-small-en-v1.5",
		"revision": "ea104dacec62c0de699686887e3f920caeb4f3e3",
		"files": [
			{
				"path": "config.json",
				"sha256": "fa73f90bf92c8cace1fbcb709626306f2bdbc9ea3e5b5f94b440df9b6aa56350",
				"bytes": 683
			},
			{
				"path": "tokenizer.json",
				"sha256": "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
				"bytes": 711396
			},
			{
				"path": "tokenizer_config.json",
				"sha256": "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
				"bytes": 366
			},
			{
				"path": "onnx/model_quantized.onnx",
				"sha256": "6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4",
				"bytes": 34014426
			}
		]
	},
	"runtime": {
		"transformers": "4.3.0",
		"onnxruntimeWeb": "1.31.0-dev.20260914-8d85527a0",
		"files": [
			{
				"path": "ort-wasm-simd-threaded.mjs",
				"sha256": "c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f",
				"bytes": 24381
			},
			{
				"path": "ort-wasm-simd-threaded.wasm",
				"sha256": "06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3",
				"bytes": 14264838
			}
		]
	}
}
```

Create `apps/web/scripts/emoji-assets.mjs`:

```js
// Fetching and checking the emoji model files. Used by scripts/fetch-emoji-assets.mjs (the command),
// by vite.config.ts and vitest.config.ts (for the asset version) and by tests.
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const WEB_ROOT = join(import.meta.dirname, "..");
export const MANIFEST_PATH = join(WEB_ROOT, "emoji-assets.json");
export const ASSETS_ROOT = join(WEB_ROOT, "public/assets/emoji");

export const loadManifest = (path = MANIFEST_PATH) =>
	JSON.parse(readFileSync(path, "utf8"));

const digestOf = (files) =>
	createHash("sha256")
		.update(
			files
				.map((file) => `${file.path}:${file.sha256}`)
				.sort()
				.join("\n"),
		)
		.digest("hex");

/**
 * A digest of the model files' checksums. The committed index is built for exactly these files
 * (index.json records the digest), so a model that digests differently needs a rebuilt index.
 */
export const modelFilesDigest = (manifest) => digestOf(manifest.model.files);

/**
 * The folder name under /assets/emoji/: the first 12 hex digits of a digest of every model and
 * runtime file checksum. It changes exactly when a byte the device runs changes (the model, the
 * tokenizer, or the ONNX Runtime glue and wasm), so a cached copy of one version is never used
 * as another, and re-pinning the model repository to a new revision with identical files keeps
 * the version, and the device's download, as it is.
 */
export function assetVersion(manifest) {
	return digestOf([...manifest.model.files, ...manifest.runtime.files]).slice(
		0,
		12,
	);
}

/** Bytes a device downloads for one version: every model and runtime file. */
export const downloadBytes = (manifest) =>
	[...manifest.model.files, ...manifest.runtime.files].reduce(
		(sum, file) => sum + file.bytes,
		0,
	);

export const modelUrl = (manifest, file) =>
	`https://huggingface.co/${manifest.model.id}/resolve/${manifest.model.revision}/${file.path}`;

export const sha256Of = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");

/** "ok" when the file exists with the expected size and checksum, "missing" when absent, "bad" otherwise. */
export function checkFile(path, entry) {
	if (!existsSync(path)) return "missing";
	if (statSync(path).size !== entry.bytes) return "bad";
	return sha256Of(readFileSync(path)) === entry.sha256 ? "ok" : "bad";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Downloads `url`, retrying network failures and server errors. Returns the bytes. */
export async function download(
	url,
	{ fetchImpl = fetch, attempts = 3, retryDelayMs = 2000 } = {},
) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const response = await fetchImpl(url);
			if (response.ok) return Buffer.from(await response.arrayBuffer());
			lastError = new Error(`${url}: HTTP ${response.status}`);
			if (response.status < 500) break;
		} catch (error) {
			lastError = error;
		}
		if (attempt < attempts) await sleep(retryDelayMs);
	}
	throw lastError;
}

function writeVerified(path, bytes, entry) {
	if (bytes.length !== entry.bytes || sha256Of(bytes) !== entry.sha256)
		throw new Error(
			`checksum mismatch for ${entry.path}: expected ${entry.sha256} (${entry.bytes} bytes), got ${sha256Of(bytes)} (${bytes.length} bytes)`,
		);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.part`;
	writeFileSync(temporary, bytes);
	renameSync(temporary, path);
}

/** The folder onnxruntime-web's files live in: next to transformers.js in node_modules, whatever the package manager. */
export function findOrtDist(webRoot = WEB_ROOT) {
	const transformers = realpathSync(
		join(webRoot, "node_modules/@huggingface/transformers"),
	);
	return join(transformers, "..", "..", "onnxruntime-web", "dist");
}

export function installedTransformersVersion(webRoot = WEB_ROOT) {
	const transformers = realpathSync(
		join(webRoot, "node_modules/@huggingface/transformers"),
	);
	return JSON.parse(readFileSync(join(transformers, "package.json"), "utf8"))
		.version;
}

/**
 * Puts every file of the manifest under `<root>/<version>/` (models/<id>/<path> and ort/<file>),
 * keeps files that already pass their checksum, removes folders of other versions, and returns
 * what it did. Throws on a checksum mismatch or when a file cannot be fetched.
 */
export async function fetchEmojiAssets({
	manifest,
	root = ASSETS_ROOT,
	ortDist,
	transformersVersion,
	fetchImpl = fetch,
	attempts,
	retryDelayMs,
	log = () => {},
}) {
	if (transformersVersion !== manifest.runtime.transformers)
		throw new Error(
			`@huggingface/transformers ${transformersVersion} is installed but emoji-assets.json pins ${manifest.runtime.transformers}; run \`pnpm --filter @tagteam/web emoji:assets -- --update\``,
		);
	const version = assetVersion(manifest);
	const dir = join(root, version);
	const result = {
		version,
		dir,
		downloaded: [],
		kept: [],
		copied: [],
		pruned: [],
	};

	for (const file of manifest.model.files) {
		const destination = join(dir, "models", manifest.model.id, file.path);
		if (checkFile(destination, file) === "ok") {
			result.kept.push(file.path);
			continue;
		}
		log(`downloading ${file.path} (${file.bytes} bytes)`);
		const bytes = await download(modelUrl(manifest, file), {
			fetchImpl,
			attempts,
			retryDelayMs,
		});
		writeVerified(destination, bytes, file);
		result.downloaded.push(file.path);
	}

	for (const file of manifest.runtime.files) {
		const destination = join(dir, "ort", file.path);
		if (checkFile(destination, file) === "ok") {
			result.kept.push(file.path);
			continue;
		}
		log(`copying ${file.path} from onnxruntime-web`);
		writeVerified(destination, readFileSync(join(ortDist, file.path)), file);
		result.copied.push(file.path);
	}

	if (existsSync(root))
		for (const entry of readdirSync(root, { withFileTypes: true }))
			if (entry.name !== version) {
				rmSync(join(root, entry.name), { recursive: true, force: true });
				result.pruned.push(entry.name);
			}
	return result;
}

/**
 * Rebuilds the manifest for `revision`: downloads each model file at that revision and copies
 * the runtime files, recording size and checksum. A maintainer runs it when bumping the model
 * or `@huggingface/transformers`, then reviews the diff.
 */
export async function buildManifest({
	manifest,
	revision,
	ortDist,
	transformersVersion,
	ortVersion,
	fetchImpl = fetch,
	attempts,
	retryDelayMs,
}) {
	const pinned = { ...manifest.model, revision };
	const describe = (path, bytes) => ({
		path,
		sha256: sha256Of(bytes),
		bytes: bytes.length,
	});
	const modelFiles = [];
	for (const file of manifest.model.files)
		modelFiles.push(
			describe(
				file.path,
				await download(modelUrl({ model: pinned }, file), {
					fetchImpl,
					attempts,
					retryDelayMs,
				}),
			),
		);
	const runtimeFiles = manifest.runtime.files.map((file) =>
		describe(file.path, readFileSync(join(ortDist, file.path))),
	);
	return {
		model: { id: manifest.model.id, revision, files: modelFiles },
		runtime: {
			transformers: transformersVersion,
			onnxruntimeWeb: ortVersion,
			files: runtimeFiles,
		},
	};
}
```

Create `apps/web/scripts/emoji-assets.d.mts`:

```ts
export interface AssetFile {
	path: string;
	sha256: string;
	bytes: number;
}

export interface EmojiAssetManifest {
	model: { id: string; revision: string; files: AssetFile[] };
	runtime: {
		transformers: string;
		onnxruntimeWeb: string;
		files: AssetFile[];
	};
}

export interface FetchOptions {
	fetchImpl?: (url: string) => Promise<Response>;
	attempts?: number;
	retryDelayMs?: number;
}

export interface FetchResult {
	version: string;
	dir: string;
	downloaded: string[];
	kept: string[];
	copied: string[];
	pruned: string[];
}

export const MANIFEST_PATH: string;
export const ASSETS_ROOT: string;
export const WEB_ROOT: string;
export function loadManifest(path?: string): EmojiAssetManifest;
export function assetVersion(manifest: EmojiAssetManifest): string;
export function modelFilesDigest(manifest: EmojiAssetManifest): string;
export function downloadBytes(manifest: EmojiAssetManifest): number;
export function modelUrl(
	manifest: Pick<EmojiAssetManifest, "model">,
	file: AssetFile,
): string;
export function sha256Of(bytes: Uint8Array): string;
export function checkFile(
	path: string,
	entry: AssetFile,
): "ok" | "missing" | "bad";
export function download(url: string, options?: FetchOptions): Promise<Buffer>;
export function findOrtDist(webRoot?: string): string;
export function installedTransformersVersion(webRoot?: string): string;
export function fetchEmojiAssets(
	options: FetchOptions & {
		manifest: EmojiAssetManifest;
		root?: string;
		ortDist: string;
		transformersVersion: string;
		log?: (message: string) => void;
	},
): Promise<FetchResult>;
export function buildManifest(
	options: FetchOptions & {
		manifest: EmojiAssetManifest;
		revision: string;
		ortDist: string;
		transformersVersion: string;
		ortVersion: string;
	},
): Promise<EmojiAssetManifest>;
```

Run: `pnpm --filter @tagteam/web exec vitest run scripts`
Expected: 14 passed and 1 failed. The failing one is "the command … does nothing and succeeds when SKIP_EMOJI_MODEL=1" (`Cannot find module … fetch-emoji-assets.mjs`); Step 5 fixes it.

- [ ] **Step 5: The command**

Create `apps/web/scripts/fetch-emoji-assets.mjs`:

```js
// Puts the emoji model and the ONNX Runtime wasm under apps/web/public/assets/emoji/<version>/.
//
//   pnpm --filter @tagteam/web emoji:assets             fetch (skips files that already pass their checksum)
//   pnpm --filter @tagteam/web emoji:assets -- --update [revision]
//                                                       re-pin: rewrite emoji-assets.json for a revision
//                                                       (default: the model's current main) and review the diff
//
// SKIP_EMOJI_MODEL=1 does nothing and exits 0: the app then builds without the model files and
// every device reports the emoji engine as unavailable. Any other failure, including a checksum
// mismatch, exits 1 so that a build never ships a half-fetched or altered model.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildManifest,
	fetchEmojiAssets,
	findOrtDist,
	installedTransformersVersion,
	loadManifest,
	MANIFEST_PATH,
} from "./emoji-assets.mjs";

async function main(argv, env) {
	if (env.SKIP_EMOJI_MODEL === "1" || env.SKIP_EMOJI_MODEL === "true") {
		console.log(
			"emoji assets: SKIP_EMOJI_MODEL is set, not fetching the model",
		);
		return;
	}
	const manifest = loadManifest();
	const ortDist = findOrtDist();
	const transformersVersion = installedTransformersVersion();

	if (argv.includes("--update")) {
		const given = argv[argv.indexOf("--update") + 1];
		const revision =
			given && !given.startsWith("--")
				? given
				: (
						await (
							await fetch(
								`https://huggingface.co/api/models/${manifest.model.id}`,
							)
						).json()
					).sha;
		const ortVersion = JSON.parse(
			readFileSync(join(ortDist, "..", "package.json"), "utf8"),
		).version;
		const next = await buildManifest({
			manifest,
			revision,
			ortDist,
			transformersVersion,
			ortVersion,
		});
		writeFileSync(MANIFEST_PATH, `${JSON.stringify(next, null, "\t")}\n`);
		console.log(`emoji assets: pinned ${manifest.model.id} at ${revision}`);
		return;
	}

	const result = await fetchEmojiAssets({
		manifest,
		ortDist,
		transformersVersion,
		log: (message) => console.log(`emoji assets: ${message}`),
	});
	console.log(
		`emoji assets: ${result.version} ready (${result.downloaded.length} downloaded, ${result.copied.length} copied, ${result.kept.length} already present${result.pruned.length ? `, removed ${result.pruned.join(", ")}` : ""})`,
	);
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
	main(process.argv.slice(2), process.env).catch((error) => {
		console.error(`emoji assets: ${error.message}`);
		process.exit(1);
	});
```

In `apps/web/package.json` add after `emoji:catalog`:

```json
		"emoji:assets": "node scripts/fetch-emoji-assets.mjs",
```

Run: `pnpm --filter @tagteam/web exec vitest run scripts`
Expected: PASS (15 tests).

- [ ] **Step 6: Fetch for real, twice**

Run: `pnpm --filter @tagteam/web emoji:assets`
Expected (needs network): four `downloading …` lines, two `copying … from onnxruntime-web` lines and `emoji assets: db5f70d71a67 ready (4 downloaded, 2 copied, 0 already present, removed smoke)` (the `removed smoke` part appears only if Task 1's manual `smoke/` folder exists). `find apps/web/public/assets/emoji -type f` lists six files under `db5f70d71a67/`; if the printed version differs, the manifest differs from this plan's: stop and compare it with the table in Global Constraints.

Run it again. Expected: `db5f70d71a67 ready (0 downloaded, 0 copied, 6 already present)`.

Run: `SKIP_EMOJI_MODEL=1 node apps/web/scripts/fetch-emoji-assets.mjs`
Expected: `emoji assets: SKIP_EMOJI_MODEL is set, not fetching the model` and exit status 0.

- [ ] **Step 7: Write the failing asset-path test**

Create `apps/web/src/features/emoji/assets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	assetVersion,
	downloadBytes,
	loadManifest,
} from "../../../scripts/emoji-assets.mjs";
import {
	EMOJI_ASSET_BASE,
	EMOJI_ASSET_VERSION,
	EMOJI_DOWNLOAD_BYTES,
	EMOJI_MODEL_ID,
	EMOJI_MODEL_PATH,
	EMOJI_ORT_MJS_PATH,
	EMOJI_ORT_WASM_PATH,
	EMOJI_STORED_PATHS,
} from "./assets";

describe("emoji asset paths", () => {
	const manifest = loadManifest();

	it("uses the version derived from the manifest", () => {
		expect(EMOJI_ASSET_VERSION).toBe(assetVersion(manifest));
		expect(EMOJI_ASSET_VERSION).toMatch(/^[0-9a-f]{12}$/);
	});

	it("serves everything from one immutable folder", () => {
		expect(EMOJI_ASSET_BASE).toBe(`/assets/emoji/${EMOJI_ASSET_VERSION}/`);
		expect(EMOJI_MODEL_PATH).toBe(`${EMOJI_ASSET_BASE}models/`);
		expect(EMOJI_ORT_MJS_PATH).toBe(
			`${EMOJI_ASSET_BASE}ort/ort-wasm-simd-threaded.mjs`,
		);
		expect(EMOJI_ORT_WASM_PATH).toBe(
			`${EMOJI_ASSET_BASE}ort/ort-wasm-simd-threaded.wasm`,
		);
	});

	it("lists the six stored files and the download size from the manifest", () => {
		expect(EMOJI_STORED_PATHS).toHaveLength(6);
		for (const path of EMOJI_STORED_PATHS)
			expect(path.startsWith(EMOJI_ASSET_BASE)).toBe(true);
		expect(EMOJI_DOWNLOAD_BYTES).toBe(downloadBytes(manifest));
		expect(EMOJI_DOWNLOAD_BYTES).toBeGreaterThan(49_000_000);
	});

	it("names the model the manifest pins", () => {
		expect(EMOJI_MODEL_ID).toBe(manifest.model.id);
	});
});
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/assets.test.ts`
Expected: FAIL — `Failed to resolve import "./assets"`.

- [ ] **Step 8: Define the version for Vite and Vitest, and add the paths**

Create `apps/web/src/features/emoji/assets.ts`:

```ts
// `__EMOJI_ASSET_VERSION__` is defined by vite.config.ts and vitest.config.ts from emoji-assets.json
// (the same function scripts/fetch-emoji-assets.mjs uses to name the folder it writes).
declare const __EMOJI_ASSET_VERSION__: string;
declare const __EMOJI_DOWNLOAD_BYTES__: number;

export const EMOJI_MODEL_ID = "Xenova/bge-small-en-v1.5";
export const EMOJI_ASSET_VERSION: string = __EMOJI_ASSET_VERSION__;
/** Bytes a device downloads for this version (every model and runtime file); the denominator of the progress. */
export const EMOJI_DOWNLOAD_BYTES: number = __EMOJI_DOWNLOAD_BYTES__;
/** Where the build serves the model files; the server marks everything under /assets/ immutable. */
export const EMOJI_ASSET_BASE = `/assets/emoji/${EMOJI_ASSET_VERSION}/`;
/** transformers.js `env.localModelPath`: a path, never an absolute URL. */
export const EMOJI_MODEL_PATH = `${EMOJI_ASSET_BASE}models/`;
export const EMOJI_ORT_MJS_PATH = `${EMOJI_ASSET_BASE}ort/ort-wasm-simd-threaded.mjs`;
export const EMOJI_ORT_WASM_PATH = `${EMOJI_ASSET_BASE}ort/ort-wasm-simd-threaded.wasm`;
/** The six files a device stores for this version, as paths under the site root. */
export const EMOJI_STORED_PATHS = [
	`${EMOJI_MODEL_PATH}${EMOJI_MODEL_ID}/config.json`,
	`${EMOJI_MODEL_PATH}${EMOJI_MODEL_ID}/tokenizer.json`,
	`${EMOJI_MODEL_PATH}${EMOJI_MODEL_ID}/tokenizer_config.json`,
	`${EMOJI_MODEL_PATH}${EMOJI_MODEL_ID}/onnx/model_quantized.onnx`,
	EMOJI_ORT_MJS_PATH,
	EMOJI_ORT_WASM_PATH,
] as const;
/** Every emoji model file of every version is under this folder; the engine cleans up through it. */
export const EMOJI_ASSETS_ROOT = "/assets/emoji/";
/** The Cache API cache transformers.js keeps the model and the wasm in (`env.cacheKey`). */
export const EMOJI_CACHE_NAME = "transformers-cache";
```

In `apps/web/vite.config.ts` add under the imports:

```ts
import {
	assetVersion,
	downloadBytes,
	loadManifest,
} from "./scripts/emoji-assets.mjs";
```

and as the first property of the `defineConfig({` object:

```ts
	// The folder of the emoji model files under /assets/emoji/ and the size of the download,
	// both derived from emoji-assets.json.
	define: {
		__EMOJI_ASSET_VERSION__: JSON.stringify(assetVersion(loadManifest())),
		__EMOJI_DOWNLOAD_BYTES__: JSON.stringify(downloadBytes(loadManifest())),
	},
```

In `apps/web/vitest.config.ts` add the same import under the existing imports and the same `define` block as the first property of `defineConfig({`.

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/assets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Docker**

In `Dockerfile`, replace

```dockerfile
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
```

with

```dockerfile
RUN pnpm install --frozen-lockfile
# Emoji model files: fetched from Hugging Face at the revision pinned in emoji-assets.json and
# checksum-verified. This layer depends only on the lockfile, the manifest and these two scripts,
# so source changes never download the 49 MB again. `--build-arg SKIP_EMOJI_MODEL=1` builds an image
# without them (the Download button on Me then fails for everyone, because the files answer 404).
ARG SKIP_EMOJI_MODEL=
COPY apps/web/emoji-assets.json apps/web/emoji-assets.json
COPY apps/web/scripts/emoji-assets.mjs apps/web/scripts/fetch-emoji-assets.mjs apps/web/scripts/
RUN SKIP_EMOJI_MODEL="$SKIP_EMOJI_MODEL" node apps/web/scripts/fetch-emoji-assets.mjs
COPY tsconfig.base.json ./
```

Append to `.dockerignore`:

```
apps/web/public/assets/emoji
**/dist-smoke
```

There is no Docker daemon in some environments; if you can build, run `docker build -t tagteam:local .` and confirm the build output has `emoji assets: db5f70d71a67 ready`, then `docker run --rm --entrypoint sh tagteam:local -c 'ls /app/web/assets/emoji/*/ort'` lists the two ORT files. If you cannot, say so in the report. The layer logic was simulated: a directory holding only the manifests, `pnpm-lock.yaml`, `emoji-assets.json` and the two scripts, after `pnpm install --frozen-lockfile`, runs the script successfully.

- [ ] **Step 10: Repo checks and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (server 113 tests, web 301: 279 + 3 plugin + 15 script + 4 asset-path tests; the smoke worker test is not part of `pnpm test`).

```bash
git add Dockerfile .dockerignore apps/server/src/app.ts apps/server/src/static.test.ts apps/web/emoji-assets.json apps/web/package.json apps/web/scripts apps/web/src/features/emoji/assets.ts apps/web/src/features/emoji/assets.test.ts apps/web/tsconfig.json apps/web/vite.config.ts apps/web/vitest.config.ts
git commit -m "feat(web): fetch and verify the emoji model at build time, serve it from a versioned path"
```

---

### Task 3: The search math and the committed emoji index

**Files:**
- Create: `apps/web/src/features/emoji/search.ts`, `apps/web/scripts/build-emoji-index.mjs`, `apps/web/src/features/emoji/index/bits.bin`, `apps/web/src/features/emoji/index/int8.bin`, `apps/web/src/features/emoji/index/index.json` (the three generated, committed)
- Test: `apps/web/src/features/emoji/search.test.ts`, `apps/web/src/features/emoji/index.test.ts`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `catalog.json` (1,794 entries `{ e, n, t, g }` in CLDR order, Plan 9); the model files from Task 2; `loadManifest`/`assetVersion`/`WEB_ROOT` from `scripts/emoji-assets.mjs`.
- Produces:
  - `search.ts` (no imports): `DIM = 384`, `BIT_BYTES = 48`, `SHORTLIST = 40`, `interface EmojiIndex { count: number; bits: Uint8Array; int8: Int8Array }`, `interface Ranked { indices: number[]; scores: number[] }`, `signBits(vector, offset?): Uint8Array`, `quantiseIndex(embeddings: Float32Array): { bits: Uint8Array; int8: Int8Array; scale: number }`, `rank(query, index, shortlist?): Ranked`.
  - Index layout: emoji `i` has its 48 sign-bit bytes at `bits[i*48 .. i*48+47]` (bit `k` is byte `k >> 3`, bit `k & 7`) and its 384 int8 values at `int8[i*384 ..]`; the int8 scale is one global `127 / max|x|`.
  - `index/index.json`: `{ count, dim, shortlist, int8Scale, catalogSha256, modelId, modelFilesDigest, modelRevision, docText }`. `modelFilesDigest` (from `modelFilesDigest(manifest)`) is what ties the index to the model: the test compares it with the manifest, and it is why a new asset version can never reuse an older download.
  - Command `pnpm --filter @tagteam/web emoji:index`.

- [ ] **Step 1: Write the failing search tests**

Create `apps/web/src/features/emoji/search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	BIT_BYTES,
	DIM,
	type EmojiIndex,
	quantiseIndex,
	rank,
	SHORTLIST,
	signBits,
} from "./search";

/** A repeatable pseudo-random vector with values in [-1, 1]. */
function vector(seed: number): Float32Array {
	let state = seed * 2654435761 + 1;
	const out = new Float32Array(DIM);
	for (let k = 0; k < DIM; k++) {
		state = (state * 1664525 + 1013904223) >>> 0;
		out[k] = (state / 2 ** 32) * 2 - 1;
	}
	return out;
}

function indexOf(vectors: Float32Array[]): EmojiIndex {
	const all = new Float32Array(vectors.length * DIM);
	vectors.forEach((v, i) => {
		all.set(v, i * DIM);
	});
	const { bits, int8 } = quantiseIndex(all);
	return { count: vectors.length, bits, int8 };
}

describe("signBits", () => {
	it("sets bit k of byte k >> 3 when the value is above zero", () => {
		const v = new Float32Array(DIM);
		v[0] = 0.5; // byte 0, bit 0
		v[9] = 0.1; // byte 1, bit 1
		v[383] = 2; // byte 47, bit 7
		v[10] = -3;
		v[11] = 0;
		const bits = signBits(v);
		expect(bits).toHaveLength(BIT_BYTES);
		expect(bits[0]).toBe(0b00000001);
		expect(bits[1]).toBe(0b00000010);
		expect(bits[47]).toBe(0b10000000);
		const set = bits.reduce(
			(sum, byte) => sum + byte.toString(2).replaceAll("0", "").length,
			0,
		);
		expect(set).toBe(3);
	});

	it("reads from an offset", () => {
		const two = new Float32Array(DIM * 2);
		two[DIM + 2] = 1;
		expect(signBits(two, DIM)[0]).toBe(0b00000100);
		expect(signBits(two, 0)[0]).toBe(0);
	});
});

describe("quantiseIndex", () => {
	it("scales the largest absolute value to 127 and keeps signs", () => {
		const v = new Float32Array(DIM);
		v[0] = 0.5;
		v[1] = -0.3;
		const { int8, scale, bits } = quantiseIndex(v);
		expect(scale).toBeCloseTo(254);
		expect(int8[0]).toBe(127);
		expect(int8[1]).toBe(-76);
		expect(int8[2]).toBe(0);
		expect(bits[0]).toBe(0b00000001);
	});

	it("lays rows out one after another", () => {
		const { bits, int8 } = quantiseIndex(
			Float32Array.from([...vector(1), ...vector(2)]),
		);
		expect(bits).toHaveLength(2 * BIT_BYTES);
		expect(int8).toHaveLength(2 * DIM);
	});

	it("rejects partial vectors", () => {
		expect(() => quantiseIndex(new Float32Array(DIM + 1))).toThrow(
			/whole vectors/,
		);
	});
});

describe("rank", () => {
	const vectors = Array.from({ length: 200 }, (_, i) => vector(i + 1));
	const index = indexOf(vectors);

	it("puts an emoji first for a query equal to its vector", () => {
		for (const i of [0, 17, 133, 199])
			expect(rank(vectors[i], index).indices[0]).toBe(i);
	});

	it("returns at most the shortlist, best score first", () => {
		const { indices, scores } = rank(vectors[5], index);
		expect(indices).toHaveLength(SHORTLIST);
		expect(new Set(indices).size).toBe(SHORTLIST);
		for (let i = 1; i < scores.length; i++)
			expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
	});

	it("returns fewer when the catalog is smaller than the shortlist", () => {
		const small = indexOf(vectors.slice(0, 3));
		expect(rank(vectors[1], small).indices).toHaveLength(3);
	});

	it("re-ranks the shortlist by the int8 dot product, not by bits", () => {
		// Same sign pattern, so the same bits; the first is half as large, so it scores lower.
		const base = vector(7);
		const half = base.map((value) => value / 2);
		const swapped = indexOf([half, base]);
		const ranked = rank(base, swapped);
		expect(ranked.indices).toEqual([1, 0]);
		expect(ranked.scores[0]).toBeGreaterThan(ranked.scores[1]);
	});

	it("keeps catalog order for equal scores", () => {
		const base = vector(9);
		const twins = indexOf([base, base, base]);
		expect(rank(base, twins).indices).toEqual([0, 1, 2]);
	});

	it("rejects a query of the wrong length", () => {
		expect(() => rank(new Float32Array(10), index)).toThrow(/384/);
	});
});
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/search.test.ts`
Expected: FAIL — `Failed to resolve import "./search"`.

- [ ] **Step 2: Implement the search math**

Create `apps/web/src/features/emoji/search.ts`:

```ts
// The search math, with no imports so the build and evaluation scripts can load it directly
// (Node strips the types). Used by the worker and by scripts/build-emoji-index.mjs and
// scripts/eval-emoji.mjs.

/** bge-small-en-v1.5 embeds into 384 dimensions. */
export const DIM = 384;
/** One sign bit per dimension. */
export const BIT_BYTES = DIM / 8;
/** How many emoji the Hamming pass keeps for the int8 re-rank. */
export const SHORTLIST = 40;

/**
 * The emoji index. Entry `i` is the i-th emoji of catalog.json: `bits` holds its 384 sign bits
 * (bit `k` is byte `i * 48 + (k >> 3)`, bit `k & 7`, set when the value is above zero) and `int8`
 * its 384 values, each the float value times one global scale, rounded.
 */
export interface EmojiIndex {
	count: number;
	bits: Uint8Array;
	int8: Int8Array;
}

export interface Ranked {
	/** Catalog positions, best first. At most SHORTLIST of them. */
	indices: number[];
	/** The score of each one (dot product of the query with the int8 vector). Only the order matters. */
	scores: number[];
}

const POPCOUNT = new Uint8Array(256);
for (let i = 1; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

export function signBits(vector: ArrayLike<number>, offset = 0): Uint8Array {
	const bytes = new Uint8Array(BIT_BYTES);
	for (let k = 0; k < DIM; k++)
		if (vector[offset + k] > 0) bytes[k >> 3] |= 1 << (k & 7);
	return bytes;
}

/**
 * Builds the index from `count` float embeddings laid out one after another. The int8 scale is
 * one number for the whole catalog (127 over the largest absolute value), so ranking by the
 * dot product with the int8 vectors equals ranking by the dot product with the floats.
 */
export function quantiseIndex(embeddings: Float32Array): {
	bits: Uint8Array;
	int8: Int8Array;
	scale: number;
} {
	if (embeddings.length % DIM !== 0)
		throw new Error(`embeddings must hold whole vectors of ${DIM} numbers`);
	const count = embeddings.length / DIM;
	const bits = new Uint8Array(count * BIT_BYTES);
	for (let i = 0; i < count; i++)
		bits.set(signBits(embeddings, i * DIM), i * BIT_BYTES);
	let largest = 0;
	for (const value of embeddings) largest = Math.max(largest, Math.abs(value));
	const scale = largest === 0 ? 1 : 127 / largest;
	const int8 = new Int8Array(embeddings.length);
	for (let i = 0; i < embeddings.length; i++)
		int8[i] = Math.max(-127, Math.min(127, Math.round(embeddings[i] * scale)));
	return { bits, int8, scale };
}

/**
 * The emoji nearest to `query` (a normalised 384-number embedding): the SHORTLIST nearest by
 * Hamming distance of sign bits, re-ranked by the dot product of the float query with the int8
 * vectors. Ties keep catalog order.
 */
export function rank(
	query: ArrayLike<number>,
	index: EmojiIndex,
	shortlist = SHORTLIST,
): Ranked {
	if (query.length !== DIM)
		throw new Error(`query must hold ${DIM} numbers, got ${query.length}`);
	const queryBits = signBits(query);
	const distance = new Uint16Array(index.count);
	for (let i = 0, offset = 0; i < index.count; i++, offset += BIT_BYTES) {
		let sum = 0;
		for (let j = 0; j < BIT_BYTES; j++)
			sum += POPCOUNT[index.bits[offset + j] ^ queryBits[j]];
		distance[i] = sum;
	}
	const nearest = Array.from({ length: index.count }, (_, i) => i)
		.sort((a, b) => distance[a] - distance[b] || a - b)
		.slice(0, shortlist);
	const scored = nearest.map((i) => {
		let dot = 0;
		const offset = i * DIM;
		for (let k = 0; k < DIM; k++) dot += index.int8[offset + k] * query[k];
		return { i, dot };
	});
	scored.sort((a, b) => b.dot - a.dot || a.i - b.i);
	return { indices: scored.map((s) => s.i), scores: scored.map((s) => s.dot) };
}
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/search.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 3: Write the failing index test**

Create `apps/web/src/features/emoji/index.test.ts`:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	loadManifest,
	modelFilesDigest,
} from "../../../scripts/emoji-assets.mjs";
import { BIT_BYTES, DIM, type EmojiIndex, rank } from "./search";

const dir = import.meta.dirname;
const read = (path: string) => readFileSync(join(dir, path));
const catalogBytes = read("catalog.json");
const catalog = JSON.parse(catalogBytes.toString("utf8")) as unknown[];
const meta = JSON.parse(read("index/index.json").toString("utf8")) as {
	count: number;
	dim: number;
	shortlist: number;
	int8Scale: number;
	catalogSha256: string;
	modelFilesDigest: string;
};
const bitsFile = read("index/bits.bin");
const int8File = read("index/int8.bin");
const index: EmojiIndex = {
	count: meta.count,
	bits: new Uint8Array(bitsFile),
	int8: new Int8Array(int8File.buffer, int8File.byteOffset, int8File.length),
};

describe("the committed emoji index", () => {
	it("has one bit row and one int8 row for every catalog entry", () => {
		expect(meta.dim).toBe(DIM);
		expect(meta.count).toBe(catalog.length);
		expect(bitsFile.length).toBe(catalog.length * BIT_BYTES);
		expect(int8File.length).toBe(catalog.length * DIM);
	});

	it("was built from this catalog.json (rebuild it with `emoji:index` after changing the catalog)", () => {
		expect(meta.catalogSha256).toBe(
			createHash("sha256").update(catalogBytes).digest("hex"),
		);
	});

	it("was built for the model files the manifest pins (a different model needs a rebuilt index)", () => {
		expect(meta.modelFilesDigest).toBe(modelFilesDigest(loadManifest()));
	});

	it("has sign bits that agree with the int8 values", () => {
		let checked = 0;
		for (let i = 0; i < index.count; i += 7)
			for (let k = 0; k < DIM; k++) {
				const value = index.int8[i * DIM + k];
				if (Math.abs(value) < 2) continue;
				const bit = (index.bits[i * BIT_BYTES + (k >> 3)] >> (k & 7)) & 1;
				expect(bit, `emoji ${i}, dimension ${k}`).toBe(value > 0 ? 1 : 0);
				checked++;
			}
		expect(checked).toBeGreaterThan(50_000);
	});

	it("finds an emoji from its own stored vector", () => {
		for (const i of [0, 100, 777, 1500, catalog.length - 1]) {
			const query = Float32Array.from(
				index.int8.subarray(i * DIM, (i + 1) * DIM),
				(value) => value / meta.int8Scale,
			);
			expect(rank(query, index).indices[0], `emoji ${i}`).toBe(i);
		}
	});
});
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/index.test.ts`
Expected: FAIL — `ENOENT … index/index.json`.

- [ ] **Step 4: The build script**

Create `apps/web/scripts/build-emoji-index.mjs`:

```js
// Rebuilds src/features/emoji/index/{bits.bin,int8.bin,index.json} from catalog.json. The output is committed.
// Run after `pnpm --filter @tagteam/web emoji:assets` whenever catalog.json or the pinned model changes:
//   pnpm --filter @tagteam/web emoji:index
// Each emoji is embedded as "<name>: <keyword, keyword, ...>" with the pinned model (q8, CLS pooling,
// normalised), so the index and the on-device queries use the same model.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { DIM, quantiseIndex, SHORTLIST } from "../src/features/emoji/search.ts";
import {
	assetVersion,
	loadManifest,
	modelFilesDigest,
	WEB_ROOT,
} from "./emoji-assets.mjs";

const manifest = loadManifest();
const modelsDir = join(
	WEB_ROOT,
	"public/assets/emoji",
	assetVersion(manifest),
	"models",
);
if (
	!existsSync(join(modelsDir, manifest.model.id, "onnx/model_quantized.onnx"))
) {
	console.error(
		"emoji index: model files not found; run `pnpm --filter @tagteam/web emoji:assets` first",
	);
	process.exit(1);
}

const catalogPath = join(WEB_ROOT, "src/features/emoji/catalog.json");
const catalogBytes = readFileSync(catalogPath);
const catalog = JSON.parse(catalogBytes.toString("utf8"));
const texts = catalog.map((entry) => `${entry.n}: ${entry.t.join(", ")}`);

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = modelsDir;
const extractor = await pipeline("feature-extraction", manifest.model.id, {
	dtype: "q8",
});

const embeddings = new Float32Array(texts.length * DIM);
const BATCH = 32;
for (let start = 0; start < texts.length; start += BATCH) {
	const output = await extractor(texts.slice(start, start + BATCH), {
		pooling: "cls",
		normalize: true,
	});
	embeddings.set(output.data, start * DIM);
	if ((start / BATCH) % 16 === 15 || start + BATCH >= texts.length)
		console.log(
			`emoji index: embedded ${Math.min(start + BATCH, texts.length)} of ${texts.length}`,
		);
}

const { bits, int8, scale } = quantiseIndex(embeddings);
const outDir = join(WEB_ROOT, "src/features/emoji/index");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "bits.bin"), bits);
writeFileSync(join(outDir, "int8.bin"), Buffer.from(int8.buffer));
writeFileSync(
	join(outDir, "index.json"),
	`${JSON.stringify(
		{
			count: catalog.length,
			dim: DIM,
			shortlist: SHORTLIST,
			int8Scale: scale,
			catalogSha256: createHash("sha256").update(catalogBytes).digest("hex"),
			modelId: manifest.model.id,
			modelFilesDigest: modelFilesDigest(manifest),
			modelRevision: manifest.model.revision,
			docText: "name: keywords",
		},
		null,
		"\t",
	)}\n`,
);
console.log(
	`emoji index: wrote ${catalog.length} emoji (bits.bin ${bits.length} bytes, int8.bin ${int8.length} bytes)`,
);
```

In `apps/web/package.json` add after `emoji:assets`:

```json
		"emoji:index": "node scripts/build-emoji-index.mjs",
```

- [ ] **Step 5: Build the index and run the test**

Needs the model files from Task 2 (`pnpm --filter @tagteam/web emoji:assets`).

Run: `pnpm --filter @tagteam/web emoji:index`
Expected (about 7 s): progress lines every 512 emoji and `emoji index: wrote 1794 emoji (bits.bin 86112 bytes, int8.bin 688896 bytes)`. `apps/web/src/features/emoji/index/index.json` reads `"count": 1794`, `"dim": 384`, `"shortlist": 40`, `"catalogSha256": "a6705eb14b1e529d41ddb752c0fb1b6a63f0dc2281eac204abcfe93283771cd3"`, `"modelFilesDigest": "080def9216e3db03431b08399663c9e1655a7334feec997b5cddf0909a929d30"`, `"modelRevision": "ea104dacec62c0de699686887e3f920caeb4f3e3"` and an `int8Scale` near 292 (it was 291.9 in the trial; it can differ in the last digits between machines). If `catalogSha256` differs, `catalog.json` is not the file this plan was written against: stop and report.

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/index.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Repo checks and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (web 301 + 11 + 5 = 317). Biome does not lint the binary files.

```bash
git add apps/web/package.json apps/web/scripts/build-emoji-index.mjs apps/web/src/features/emoji/search.ts apps/web/src/features/emoji/search.test.ts apps/web/src/features/emoji/index.test.ts apps/web/src/features/emoji/index
git commit -m "feat(web): build the emoji search index from the catalog and test the search math"
```

---

### Task 4: The emoji worker

**Files:**
- Create: `apps/web/src/features/emoji/worker-protocol.ts`, `apps/web/src/features/emoji/worker-core.ts`
- Test: `apps/web/src/features/emoji/worker-core.test.ts`
- Modify (full replacement): `apps/web/src/features/emoji/worker.ts` (Task 1's smoke version), `apps/web/emoji-smoke.html`, `apps/web/e2e-smoke/emoji-worker.spec.ts`
- Modify: `apps/web/vite.config.ts`

**Interfaces:**
- Consumes: `search.ts` (`rank`, `BIT_BYTES`, `DIM`, `EmojiIndex`), `assets.ts` paths, `index/bits.bin` and `index/int8.bin`, the five facts from Task 1.
- Produces:
  - `worker-protocol.ts`: `WorkerRequest = { type: "init"; id; count; allowNetwork: boolean; totalBytes: number } | { type: "rank"; id; text }`; `FailureKind = "uncached" | "offline" | "quota" | "corrupt" | "index" | "load" | "runtime"`; `WorkerReply = { type: "ready"; id } | { type: "progress"; id; loaded; total } | { type: "ranked"; id; indices: number[]; scores: number[] } | { type: "error"; id: number | null; kind: FailureKind; message: string }`.
  - `worker-core.ts`: `interface Embedder { embed(text): Promise<Float32Array> }`, `interface WorkerDeps { filesCached(): Promise<boolean>; loadIndex(): Promise<{ bits: Uint8Array; int8: Int8Array }>; loadEmbedder(onBytes: (loaded: number) => void): Promise<Embedder>; isOnline(): boolean; post(reply): void }`, `classifyFailure(error, { filesCached, online }): FailureKind`, `createWorkerCore(deps): (request) => Promise<void>`. It answers one request at a time, in order. `init` first checks `filesCached()`: **with `allowNetwork` false and the files not all stored it answers `uncached` and loads nothing**; it verifies `bits.length === count * 48` and `int8.length === count * 384`, loads the model (forwarding byte counts as `progress`, once per whole percent of `totalBytes`, never above it), warms it with one embedding, then replies `ready`.
  - `worker.ts`: the module worker. It is the only importer of `@huggingface/transformers`. `filesCached()` is true only when all six files (`EMOJI_STORED_PATHS`) are in the Cache API. `loadEmbedder` first stores any missing file itself (`storeFiles`: `fetch(url, { cache: "no-store" })`, streamed, byte-counted, `cache.put` under the absolute URL), then calls `pipeline(...)`, which finds everything in its cache.
  - Serwist precache glob includes `bin`.

- [ ] **Step 1: Write the failing worker-core tests**

Create `apps/web/src/features/emoji/worker-core.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { BIT_BYTES, DIM, quantiseIndex } from "./search";
import {
	classifyFailure,
	createWorkerCore,
	type WorkerDeps,
} from "./worker-core";
import type { WorkerReply } from "./worker-protocol";

/** Three emoji whose vectors point along axes 0, 1 and 2. */
function axisVectors(count: number): Float32Array[] {
	return Array.from({ length: count }, (_, i) => {
		const v = new Float32Array(DIM);
		v[i] = 1;
		return v;
	});
}
function indexFiles(vectors: Float32Array[]) {
	const all = new Float32Array(vectors.length * DIM);
	vectors.forEach((v, i) => {
		all.set(v, i * DIM);
	});
	const { bits, int8 } = quantiseIndex(all);
	return { bits, int8 };
}

const init = (id: number, count: number, allowNetwork = true) =>
	({ type: "init", id, count, allowNetwork, totalBytes: 1000 }) as const;

function setup(overrides: Partial<WorkerDeps> = {}) {
	const vectors = axisVectors(3);
	const replies: WorkerReply[] = [];
	const embed = vi.fn(async (text: string) => {
		const axis = text.startsWith("axis ") ? Number(text.slice(5)) : 0;
		return vectors[axis];
	});
	const deps: WorkerDeps = {
		filesCached: async () => false,
		loadIndex: async () => indexFiles(vectors),
		loadEmbedder: async (_onBytes) => ({ embed }),
		isOnline: () => true,
		post: (reply) => replies.push(reply),
		...overrides,
	};
	return { handle: createWorkerCore(deps), replies, embed };
}

describe("the worker core", () => {
	it("loads the index and the model, warms up once, and says ready", async () => {
		const { handle, replies, embed } = setup();
		await handle(init(1, 3));
		expect(replies).toEqual([{ type: "ready", id: 1 }]);
		expect(embed).toHaveBeenCalledTimes(1);
		expect(embed).toHaveBeenCalledWith("warm up");
	});

	it("ranks by the embedding of the text", async () => {
		const { handle, replies } = setup();
		await handle(init(1, 3));
		await handle({ type: "rank", id: 2, text: "axis 2" });
		const reply = replies.at(-1);
		expect(reply).toMatchObject({ type: "ranked", id: 2 });
		expect(reply?.type === "ranked" && reply.indices[0]).toBe(2);
		expect(reply?.type === "ranked" && reply.indices).toHaveLength(3);
	});

	it("answers requests one at a time, in order", async () => {
		let release: () => void = () => {};
		const slow = new Promise<void>((resolve) => {
			release = resolve;
		});
		const vectors = axisVectors(3);
		const { handle, replies } = setup({
			loadEmbedder: async (_onBytes) => ({
				embed: async (text: string) => {
					if (text === "axis 1") await slow;
					return vectors[text === "axis 1" ? 1 : 0];
				},
			}),
		});
		await handle(init(1, 3));
		const first = handle({ type: "rank", id: 2, text: "axis 1" });
		const second = handle({ type: "rank", id: 3, text: "axis 0" });
		release();
		await Promise.all([first, second]);
		expect(replies.map((reply) => reply.id)).toEqual([1, 2, 3]);
	});

	it("loads a model that is stored on the device without the network, and never downloads when it is not", async () => {
		const stored = setup({ filesCached: async () => true });
		await stored.handle(init(1, 3, false));
		expect(stored.replies).toEqual([{ type: "ready", id: 1 }]);

		const loadEmbedder = vi.fn(async () => ({
			embed: async () => new Float32Array(DIM),
		}));
		const absent = setup({ filesCached: async () => false, loadEmbedder });
		await absent.handle(init(1, 3, false));
		expect(absent.replies[0]).toMatchObject({
			type: "error",
			id: 1,
			kind: "uncached",
		});
		expect(loadEmbedder).not.toHaveBeenCalled();

		const download = setup({ filesCached: async () => false });
		await download.handle(init(1, 3, true));
		expect(download.replies).toEqual([{ type: "ready", id: 1 }]);
	});

	it("reports download progress once per whole percent, never above the total", async () => {
		const { handle, replies } = setup({
			loadEmbedder: async (onBytes) => {
				for (const bytes of [0, 4, 9, 10, 500, 505, 2000]) onBytes(bytes);
				return { embed: async () => new Float32Array(DIM) };
			},
		});
		await handle(init(1, 3));
		const progress = replies.filter((reply) => reply.type === "progress");
		expect(
			progress.map((reply) => reply.type === "progress" && reply.loaded),
		).toEqual([0, 10, 500, 1000]);
		expect(
			progress.every(
				(reply) => reply.type === "progress" && reply.total === 1000,
			),
		).toBe(true);
	});

	it("refuses an index that does not match the catalog", async () => {
		const { handle, replies } = setup();
		await handle(init(1, 4));
		expect(replies[0]).toMatchObject({ type: "error", id: 1, kind: "index" });
	});

	it("reports a runtime error for a rank before init and for an embedding that throws", async () => {
		const early = setup();
		await early.handle({ type: "rank", id: 5, text: "x" });
		expect(early.replies[0]).toMatchObject({
			type: "error",
			id: 5,
			kind: "runtime",
		});

		const vectors = axisVectors(3);
		let fail = false;
		const later = setup({
			loadEmbedder: async (_onBytes) => ({
				embed: async () => {
					if (fail) throw new Error("session lost");
					return vectors[0];
				},
			}),
		});
		await later.handle(init(1, 3));
		fail = true;
		await later.handle({ type: "rank", id: 2, text: "x" });
		expect(later.replies.at(-1)).toMatchObject({
			type: "error",
			id: 2,
			kind: "runtime",
		});
	});

	it("classifies a failed load by what the device had", async () => {
		const failing = (extra: Partial<WorkerDeps>) =>
			setup({
				loadEmbedder: async () => {
					throw new Error("could not load");
				},
				...extra,
			});
		const cached = failing({ filesCached: async () => true });
		await cached.handle(init(1, 3));
		expect(cached.replies[0]).toMatchObject({ kind: "corrupt" });

		const offline = failing({ isOnline: () => false });
		await offline.handle(init(1, 3));
		expect(offline.replies[0]).toMatchObject({ kind: "offline" });

		const missing = failing({});
		await missing.handle(init(1, 3));
		expect(missing.replies[0]).toMatchObject({ kind: "load" });
	});
});

describe("classifyFailure", () => {
	const none = { filesCached: false, online: true };
	it("recognises a storage quota error by name or message, whatever else is true", () => {
		const named = new Error("x");
		named.name = "QuotaExceededError";
		expect(classifyFailure(named, { filesCached: true, online: false })).toBe(
			"quota",
		);
		expect(classifyFailure(new Error("Storage quota exceeded"), none)).toBe(
			"quota",
		);
	});

	it("prefers corrupt over offline when files were stored", () => {
		expect(
			classifyFailure(new Error("bad"), { filesCached: true, online: false }),
		).toBe("corrupt");
	});

	it("handles values that are not errors", () => {
		expect(classifyFailure("nope", none)).toBe("load");
	});
});

describe("index layout", () => {
	it("is 48 bytes of bits and 384 int8 values per emoji", () => {
		const files = indexFiles(axisVectors(3));
		expect(files.bits).toHaveLength(3 * BIT_BYTES);
		expect(files.int8).toHaveLength(3 * DIM);
	});
});
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/worker-core.test.ts`
Expected: FAIL — `Failed to resolve import "./worker-core"`.

- [ ] **Step 2: Implement the protocol and the core**

Create `apps/web/src/features/emoji/worker-protocol.ts`:

```ts
/** Messages between the main thread (engine.ts) and the emoji worker (worker.ts). */

export type WorkerRequest =
	/**
	 * Load the index and the model, then answer `ready`. `count` is the number of catalog entries
	 * the index must have. With `allowNetwork` false the worker only loads a model that is already
	 * stored on the device and answers `uncached` otherwise: nothing is downloaded. `totalBytes` is
	 * the size of a full download, for `progress`.
	 */
	| {
			type: "init";
			id: number;
			count: number;
			allowNetwork: boolean;
			totalBytes: number;
	  }
	/** Embed `text` and answer `ranked`. */
	| { type: "rank"; id: number; text: string };

/**
 * Why the worker failed.
 * - `uncached`: a load that may not use the network found the model is not stored on the device.
 * - `offline`: files were not stored on the device and the device is offline.
 * - `quota`: the browser refused to store the files.
 * - `corrupt`: files were stored on the device and loading them still failed.
 * - `index`: index.bin files do not match the catalog.
 * - `load`: loading failed for any other reason (a missing file, a failed download, no memory).
 * - `runtime`: the worker failed while answering.
 */
export type FailureKind =
	| "uncached"
	| "offline"
	| "quota"
	| "corrupt"
	| "index"
	| "load"
	| "runtime";

export type WorkerReply =
	| { type: "ready"; id: number }
	/** Bytes downloaded so far (at most `total`), sent when the whole-number percentage changes. */
	| { type: "progress"; id: number; loaded: number; total: number }
	/** Catalog positions, best first, with their scores. */
	| { type: "ranked"; id: number; indices: number[]; scores: number[] }
	/** `id` is null for a failure that belongs to no request (an uncaught error). */
	| { type: "error"; id: number | null; kind: FailureKind; message: string };
```

Create `apps/web/src/features/emoji/worker-core.ts`:

```ts
import { BIT_BYTES, DIM, type EmojiIndex, rank } from "./search";
import type {
	FailureKind,
	WorkerReply,
	WorkerRequest,
} from "./worker-protocol";

export interface Embedder {
	/** The normalised 384-number embedding of `text`. */
	embed(text: string): Promise<Float32Array>;
}

/** What the worker needs from its environment. Real implementations are in worker.ts; tests pass fakes. */
export interface WorkerDeps {
	/** True when every file of the model and the runtime is already stored in the Cache API. Never throws. */
	filesCached(): Promise<boolean>;
	loadIndex(): Promise<{ bits: Uint8Array; int8: Int8Array }>;
	/** Loads the model; `onBytes(n)` reports the bytes downloaded so far. */
	loadEmbedder(onBytes: (loaded: number) => void): Promise<Embedder>;
	isOnline(): boolean;
	post(reply: WorkerReply): void;
}

class NotCachedError extends Error {
	constructor() {
		super("the model is not stored on this device");
		this.name = "NotCachedError";
	}
}

class IndexMismatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IndexMismatchError";
	}
}

export function classifyFailure(
	error: unknown,
	context: { filesCached: boolean; online: boolean },
): FailureKind {
	const name = error instanceof Error ? error.name : "";
	const message = error instanceof Error ? error.message : String(error);
	if (name === "QuotaExceededError" || /quota/i.test(message)) return "quota";
	if (name === "NotCachedError") return "uncached";
	if (name === "IndexMismatchError") return "index";
	if (context.filesCached) return "corrupt";
	if (!context.online) return "offline";
	return "load";
}

const messageOf = (error: unknown) =>
	error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** Returns the function that handles one request. Requests are answered one at a time, in order. */
export function createWorkerCore(
	deps: WorkerDeps,
): (request: WorkerRequest) => Promise<void> {
	let index: EmojiIndex | null = null;
	let embedder: Embedder | null = null;
	let queue: Promise<void> = Promise.resolve();

	async function init(
		id: number,
		count: number,
		allowNetwork: boolean,
		totalBytes: number,
	) {
		const filesCached = await deps.filesCached();
		try {
			if (!allowNetwork && !filesCached) throw new NotCachedError();
			const files = await deps.loadIndex();
			if (
				files.bits.length !== count * BIT_BYTES ||
				files.int8.length !== count * DIM
			)
				throw new IndexMismatchError(
					`index holds ${files.bits.length / BIT_BYTES} emoji, catalog has ${count}`,
				);
			let percent = -1;
			const loaded = await deps.loadEmbedder((bytes) => {
				const done = Math.min(Math.max(bytes, 0), totalBytes);
				const next = totalBytes > 0 ? Math.floor((done / totalBytes) * 100) : 0;
				if (next === percent) return;
				percent = next;
				deps.post({ type: "progress", id, loaded: done, total: totalBytes });
			});
			await loaded.embed("warm up");
			index = { count, bits: files.bits, int8: files.int8 };
			embedder = loaded;
			deps.post({ type: "ready", id });
		} catch (error) {
			deps.post({
				type: "error",
				id,
				kind: classifyFailure(error, {
					filesCached,
					online: deps.isOnline(),
				}),
				message: messageOf(error),
			});
		}
	}

	async function search(id: number, text: string) {
		try {
			if (!index || !embedder) throw new Error("the worker is not initialised");
			const ranked = rank(await embedder.embed(text), index);
			deps.post({ type: "ranked", id, ...ranked });
		} catch (error) {
			deps.post({
				type: "error",
				id,
				kind: "runtime",
				message: messageOf(error),
			});
		}
	}

	return (request) => {
		queue = queue.then(() =>
			request.type === "init"
				? init(
						request.id,
						request.count,
						request.allowNetwork,
						request.totalBytes,
					)
				: search(request.id, request.text),
		);
		return queue;
	};
}
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/worker-core.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 3: Replace the smoke worker with the real worker**

Replace the whole of `apps/web/src/features/emoji/worker.ts`:

```ts
// The emoji worker: loads bge-small-en-v1.5 (q8) with transformers.js from same-origin files, then
// answers `rank` requests with the nearest emoji (sign-bit shortlist, int8 re-rank).
// The library is imported here and nowhere else.
import { env, pipeline } from "@huggingface/transformers";
import {
	EMOJI_CACHE_NAME,
	EMOJI_MODEL_ID,
	EMOJI_MODEL_PATH,
	EMOJI_ORT_MJS_PATH,
	EMOJI_ORT_WASM_PATH,
	EMOJI_STORED_PATHS,
} from "./assets";
import bitsUrl from "./index/bits.bin?url";
import int8Url from "./index/int8.bin?url";
import { createWorkerCore, type WorkerDeps } from "./worker-core";
import type { WorkerReply, WorkerRequest } from "./worker-protocol";

interface Scope {
	location: { href: string };
	onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
	onunhandledrejection: ((event: PromiseRejectionEvent) => void) | null;
	postMessage(message: WorkerReply): void;
}
const scope = self as unknown as Scope;

// Nothing may leave this origin: the model is the one in the image, never Hugging Face.
env.allowLocalModels = true;
env.allowRemoteModels = false;
// A path, not an absolute URL: with a URL transformers.js 4.3 skips its local-file probe and
// reports the tokenizer as missing.
env.localModelPath = EMOJI_MODEL_PATH;
// The Cache API keeps the model between visits ("transformers-cache"); absent on insecure origins.
env.useBrowserCache = typeof caches !== "undefined";
env.cacheKey = EMOJI_CACHE_NAME;
// Without this the library fetches its 27 MB default wasm from a CDN.
const ortWasm = env.backends.onnx.wasm;
if (!ortWasm) throw new Error("onnxruntime-web is not available");
ortWasm.wasmPaths = {
	mjs: new URL(EMOJI_ORT_MJS_PATH, scope.location.href).href,
	wasm: new URL(EMOJI_ORT_WASM_PATH, scope.location.href).href,
};

async function fetchBytes(url: string): Promise<ArrayBuffer> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response.arrayBuffer();
}

/**
 * Puts every file that is not stored yet into the Cache API under the URL transformers.js looks it
 * up by, counting the bytes as they arrive. transformers.js then finds all six files in its cache
 * and makes no request of its own. Fetching them here gives one progress bar for the whole 49 MB
 * (the library reports only the model weights) and one request per file; `no-store` keeps the
 * browser's HTTP cache from keeping a second copy. A storage quota error from `cache.put`
 * surfaces as `QuotaExceededError`; an HTML answer (a dev server's fallback page) is refused.
 */
async function storeFiles(onBytes: (loaded: number) => void) {
	if (typeof caches === "undefined") return;
	const cache = await caches.open(EMOJI_CACHE_NAME);
	let loaded = 0;
	for (const path of EMOJI_STORED_PATHS) {
		const url = new URL(path, scope.location.href).href;
		if ((await cache.match(url)) !== undefined) continue;
		const response = await fetch(url, { cache: "no-store" });
		if (!response.ok || !response.body)
			throw new Error(`${path}: HTTP ${response.status}`);
		// A server that answers an unknown path with its app shell must not get stored as a model file.
		if (response.headers.get("content-type")?.includes("text/html"))
			throw new Error(`${path}: the server sent a web page, not the file`);
		const reader = response.body.getReader();
		const chunks: Uint8Array<ArrayBuffer>[] = [];
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value as Uint8Array<ArrayBuffer>);
			loaded += value.length;
			onBytes(loaded);
		}
		await cache.put(
			url,
			new Response(new Blob(chunks), {
				headers: {
					"content-type":
						response.headers.get("content-type") ?? "application/octet-stream",
				},
			}),
		);
	}
}

const deps: WorkerDeps = {
	async filesCached() {
		try {
			if (typeof caches === "undefined") return false;
			const cache = await caches.open(EMOJI_CACHE_NAME);
			for (const path of EMOJI_STORED_PATHS)
				if (
					(await cache.match(new URL(path, scope.location.href).href)) ===
					undefined
				)
					return false;
			return true;
		} catch {
			return false;
		}
	},
	async loadIndex() {
		const [bits, int8] = await Promise.all([
			fetchBytes(bitsUrl),
			fetchBytes(int8Url),
		]);
		return { bits: new Uint8Array(bits), int8: new Int8Array(int8) };
	},
	async loadEmbedder(onBytes) {
		await storeFiles(onBytes);
		const extractor = await pipeline("feature-extraction", EMOJI_MODEL_ID, {
			dtype: "q8",
			device: "wasm",
		});
		return {
			async embed(text) {
				const output = await extractor(text, {
					pooling: "cls",
					normalize: true,
				});
				return Float32Array.from(output.data as Float32Array);
			},
		};
	},
	isOnline: () => navigator.onLine,
	post: (reply) => scope.postMessage(reply),
};

const handle = createWorkerCore(deps);
scope.onmessage = (event) => void handle(event.data);
scope.onunhandledrejection = (event) =>
	deps.post({
		type: "error",
		id: null,
		kind: "runtime",
		message: String(event.reason),
	});
```

- [ ] **Step 4: Drive the real worker from the smoke page**

Replace the whole of `apps/web/emoji-smoke.html`:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title>Emoji worker smoke test</title>
	</head>
	<body>
		<pre id="result">pending</pre>
		<script type="module">
			// Only the smoke build (EMOJI_SMOKE=1) includes this page. It drives the real worker.
			import index from "./src/features/emoji/index/index.json";

			const worker = new Worker(
				new URL("./src/features/emoji/worker.ts", import.meta.url),
				{ type: "module" },
			);
			const show = (value) => {
				document.getElementById("result").textContent = JSON.stringify(value);
			};
			worker.onmessage = ({ data }) => {
				if (data.type === "progress") return;
				if (data.type === "ready")
					worker.postMessage({ type: "rank", id: 2, text: "Water the plants" });
				else if (data.type === "ranked")
					show({ ok: true, indices: data.indices });
				else show({ ok: false, kind: data.kind, message: data.message });
			};
			worker.onerror = (event) =>
				show({ ok: false, kind: "worker", message: event.message });
			worker.postMessage({
				type: "init",
				id: 1,
				count: index.count,
				allowNetwork: true,
				totalBytes: 49016090,
			});
		</script>
	</body>
</html>
```

Replace the whole of `apps/web/e2e-smoke/emoji-worker.spec.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

type SmokeResult =
	| { ok: true; indices: number[] }
	| { ok: false; kind: string; message: string };

const requireModel = process.env.EMOJI_SMOKE_REQUIRE_MODEL === "1";
const catalog = JSON.parse(
	readFileSync(
		join(import.meta.dirname, "../src/features/emoji/catalog.json"),
		"utf8",
	),
) as { e: string; n: string }[];

test("the real emoji worker loads, with the self-hosted wasm, inside the Vite build", async ({
	page,
	baseURL,
}) => {
	const origin = new URL(baseURL as string).origin;
	const foreign: string[] = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.origin !== origin && url.protocol.startsWith("http"))
			foreign.push(request.url());
	});

	await page.goto("/emoji-smoke.html");
	await page.waitForFunction(
		() => document.getElementById("result")?.textContent !== "pending",
		null,
		{ timeout: 80_000 },
	);
	const result = JSON.parse(
		await page.locator("#result").innerText(),
	) as SmokeResult;

	// Nothing came from a CDN or from Hugging Face.
	expect(foreign).toEqual([]);
	if (requireModel) {
		expect(result.ok, JSON.stringify(result)).toBe(true);
		if (!result.ok) return;
		expect(result.indices).toHaveLength(40);
		const top = result.indices
			.slice(0, 3)
			.map((index) => catalog[index].e.replace("️", ""));
		// "Water the plants": any of potted plant, seedling, droplet, herb.
		expect(top.some((emoji) => ["🪴", "🌱", "💧", "🌿"].includes(emoji))).toBe(
			true,
		);
	} else if (!result.ok) {
		// Without the model files the worker must fail with a plain load error, not a bundling one.
		expect(result.kind).toBe("load");
	}
});

test("the production build emits no ONNX Runtime wasm of its own", () => {
	test.skip(
		test.info().project.name.startsWith("dev"),
		"checks the build output",
	);
	const assets = join(import.meta.dirname, "../dist-smoke/assets");
	const files = readdirSync(assets, { withFileTypes: true }).filter((entry) =>
		entry.isFile(),
	);
	expect(files.filter((file) => file.name.endsWith(".wasm"))).toEqual([]);
	const total = files.reduce(
		(sum, file) => sum + statSync(join(assets, file.name)).size,
		0,
	);
	// The worker bundle is about 0.5 MB and the index about 0.8 MB; a 27 MB wasm would blow this budget.
	expect(total).toBeLessThan(2_500_000);
});
```

In `apps/web/vite.config.ts` change the Serwist glob to include the index files:

```ts
						globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,bin}"],
```

- [ ] **Step 5: Run the smoke test against the real worker**

Needs the model files (`pnpm --filter @tagteam/web emoji:assets`).

Run: `EMOJI_SMOKE_REQUIRE_MODEL=1 pnpm --filter @tagteam/web smoke:emoji-worker`
Expected: the build lists `worker-….js` (about 540 kB), `bits-….bin` (86 kB), `int8-….bin` (689 kB) and no `.wasm`; then 5 passed, 1 skipped. In each browser `init` (with `allowNetwork: true`) is answered `ready`, with each of the six files requested exactly once, then `rank` for "Water the plants" returns 40 catalog positions and at least one of the first three is 🪴, 🌱, 💧 or 🌿.

Run it without the variable too: `pnpm --filter @tagteam/web smoke:emoji-worker` with `apps/web/public/assets/emoji` moved away temporarily. Expected: 5 passed, 1 skipped, the failing branch being `kind: "load"`. Put the folder back.

- [ ] **Step 6: Repo checks and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (web 317 + 12 = 329). A normal `pnpm --filter @tagteam/web exec vite build` still lists 12 precache entries: nothing in the app references the worker yet (Task 6).

```bash
git add apps/web/emoji-smoke.html apps/web/e2e-smoke apps/web/src/features/emoji/worker.ts apps/web/src/features/emoji/worker-core.ts apps/web/src/features/emoji/worker-core.test.ts apps/web/src/features/emoji/worker-protocol.ts apps/web/vite.config.ts
git commit -m "feat(web): emoji worker that loads the model and ranks the catalog"
```

---

### Task 5: The engine controller and its failure handling

**Files:**
- Create: `apps/web/src/features/emoji/cache.ts`, `support.ts`, `engine-storage.ts`, `auto-pick.ts`, `controller.ts`, `apps/web/src/test/emoji.ts`
- Test: `apps/web/src/features/emoji/cache.test.ts`, `support.test.ts`, `engine-storage.test.ts`, `auto-pick.test.ts`, `controller.test.ts`
- Modify: `apps/web/src/features/emoji/engine.ts`

**Interfaces:**
- Consumes: `worker-protocol.ts` (Task 4), `search.ts` `SHORTLIST`, `assets.ts` (`EMOJI_ASSETS_ROOT`, `EMOJI_CACHE_NAME`), `catalog.ts` (`EmojiEntry`, `emojiKey`), core `isEmoji` and `MAX_TITLE`, `lib/storage.ts` `readFlag`/`writeFlag`.
- Produces:
  - `engine.ts`: `SuggestOptions { autoPick?: boolean }`; `EmojiEngine` gains `suggest(title, options?)` and optional `wake?()` (loads a stored copy; never downloads).
  - `cache.ts`: `type CacheScope = "otherVersions" | "thisVersion" | "all"`, `deleteEmojiCache(scope, version, storage?)`.
  - `support.ts`: `detectSupport(env?): boolean` (WebAssembly, Cache API and module workers).
  - `engine-storage.ts`: `PersistedState { version; loading; strikes; failedStarts }`, `EngineStorage { readOptedIn/writeOptedIn (default false); readAutoOff/writeAutoOff; readInstalled/writeInstalled (an asset version or null); readState(version)/writeState(state) }`, `createLocalStorageEngineStorage()`. Keys `tagteam.emoji.optedIn`, `tagteam.emoji.autoOff`, `tagteam.emoji.installed`, `tagteam.emoji.state`.
  - `auto-pick.ts` (no imports): `AUTO_PICK_EXCLUSION` (ships `false`, see Task 10), `isAutoPickExcluded({ n, g })`.
  - `controller.ts`: `WorkerLike`; `ControllerDeps { version; downloadBytes; storage; createWorker; loadCatalog; supported; deleteCaches(scope); autoPickExclusion?; loadTimeoutMs?; suggestTimeoutMs? }`; `FailureReason = "offline" | "storage" | "load" | "stopped" | "unsupported"`; `DownloadState = { kind: "notDownloaded"; note: "crash" | "evicted" | null } | { kind: "updateAvailable" } | { kind: "downloading"; progress: number | null } | { kind: "loading" } | { kind: "ready" } | { kind: "failed"; reason: FailureReason }`; `EmojiSnapshot { engine; optedIn; download }`; `EmojiController { getSnapshot(); subscribe(listener); wake(); warmUp(); download(): Promise<void>; remove(): Promise<void>; dispose() }`; `createEmojiController(deps)`; `LOAD_TIMEOUT_MS = 60_000`; `SUGGEST_TIMEOUT_MS = 2_000`.
  - Semantics (the owner's opt-in decision): engine status is `off` until the person presses Download; `download()` is the only way anything is fetched (it opts in, then loads with `allowNetwork: true`); `wake()` and `warmUp()` only load a stored copy for the current version (`allowNetwork: false`; the worker answers `uncached` if the browser removed it, which returns the device to the default with the note `evicted` and counts nothing); an opt-in without a finished download lapses at the next start; a stored copy of another asset version is never used (`updateAvailable`, no worker, no request) until `download()` replaces it; `remove()` also serves as Cancel; two crash strikes opt out, delete the stored model and set the `crash` note; pressing Download clears the note and the failed-start count but not the strikes.
  - `src/test/emoji.ts` (this task's version): `FakeWorker`, `memoryEngineStorage(initial?)` (`optedIn`, `autoOff`, `installed`, `state`), `fakeEmojiEngine(overrides?)`.
  - Every row of the spec §7 failure table that concerns the engine has a test in `controller.test.ts` using a `FakeWorker`:

    | Spec row | Test |
    |---|---|
    | files missing, download fails, offline | "says why it failed, in one of four plain reasons, and Try again downloads again"; "does not count an offline failure as a failed start"; "a failed first download lapses the opt-in at the next app start" |
    | no WebAssembly / module workers / Cache API | "in a browser without WebAssembly, module workers or the Cache API says so…"; "is unavailable, and never tries again, in a browser without…" (+ `support.test.ts`) |
    | load longer than 60 s | "terminates a worker that takes longer than 60 seconds to load"; "allows a slow download as long as bytes keep arriving, and gives up after 60 seconds of silence" |
    | worker throws or posts an error at any time | "terminates the worker … when it throws while loading"; "… posts an error after it was ready…" |
    | suggestion over 2 s or malformed; three in a row | "drops a suggestion that takes longer than 2 seconds…"; "goes unavailable after three bad results in a row…"; "treats malformed output as a bad result…" |
    | corrupt or partial cache | "deletes this version's stored files, and forgets the download, when loading fails with files present" |
    | quota error while caching | "goes unavailable on a storage quota error and touches nothing else" |
    | loading marker, two strikes | the five "loading marker" tests |
    | three starts in a row end unavailable | the four "stopping after repeated failures" tests |
    | catalog files fail to load | "catalog files that fail to load end the download as a plain load failure"; "goes unavailable when the catalog cannot be loaded…" (the picker's own fallback exists since Plan 9) |
    | opt-in rules (new) | "a device that has not opted in…"; "a download from an older asset version…" (two tests); "goes back to the default… when the browser removed the stored copy"; "Remove download…" |

- [ ] **Step 1: Extend the engine seam**

In `apps/web/src/features/emoji/engine.ts` replace the `EmojiEngine` interface and its doc comment (everything from `/**\n * What the screens know…` to the closing `}` of the interface) with:

```ts
export interface SuggestOptions {
	/**
	 * True for an emoji that will be stored without the person choosing it (the New task sheet's
	 * automatic fill and late picks). The engine then leaves out what auto-pick.ts excludes.
	 * The picker's "Suggested" row leaves this off.
	 */
	autoPick?: boolean;
}

/**
 * What the screens know about the on-device emoji model. The real engine is provided through
 * `EmojiEngineProvider` by `EmojiEngineHost` (a new engine object whenever the status changes);
 * until then, and in tests, the engine is unavailable. Screens never touch the model directly.
 */
export interface EmojiEngine {
	status: EmojiEngineStatus;
	/**
	 * Up to three emoji for a task title, best first, each a valid emoji and none repeated.
	 * Resolves to `[]` when there is nothing to say (not ready, too short, a timeout).
	 */
	suggest(title: string, options?: SuggestOptions): Promise<string[]>;
	/** Emoji whose meaning matches the text, best first. */
	search(text: string): Promise<string[]>;
	/** Start loading the model if it has not started. Cheap to call again. The New task sheet calls it when it opens. */
	wake?(): void;
}
```

- [ ] **Step 2: Test helpers**

Create `apps/web/src/test/emoji.ts`:

```ts
import { vi } from "vitest";
import type { WorkerLike } from "../features/emoji/controller";
import type { EmojiEngine } from "../features/emoji/engine";
import type {
	EngineStorage,
	PersistedState,
} from "../features/emoji/engine-storage";
import type { WorkerRequest } from "../features/emoji/worker-protocol";

/** A Web Worker the test drives by hand: `reply()` is the worker talking, `sent` is what the engine asked. */
export class FakeWorker implements WorkerLike {
	sent: WorkerRequest[] = [];
	terminated = false;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	onmessageerror: ((event: unknown) => void) | null = null;
	postMessage(request: WorkerRequest) {
		this.sent.push(request);
	}
	terminate() {
		this.terminated = true;
	}
	reply(data: unknown) {
		this.onmessage?.({ data });
	}
	/** The most recent request of a type. */
	last<T extends WorkerRequest["type"]>(type: T) {
		return this.sent.filter((request) => request.type === type).at(-1) as
			| Extract<WorkerRequest, { type: T }>
			| undefined;
	}
}

/** EngineStorage in memory, so tests can set the crash marker and read what the engine wrote. */
export function memoryEngineStorage(
	initial: {
		optedIn?: boolean;
		autoOff?: "crash" | null;
		installed?: string | null;
		state?: Partial<PersistedState>;
	} = {},
): EngineStorage & {
	optedIn: boolean;
	autoOff: "crash" | null;
	installed: string | null;
	state: PersistedState | null;
} {
	const store = {
		optedIn: initial.optedIn ?? false,
		autoOff: initial.autoOff ?? null,
		installed: initial.installed ?? null,
		state: initial.state
			? ({
					version: "v1",
					loading: false,
					strikes: 0,
					failedStarts: 0,
					...initial.state,
				} as PersistedState)
			: null,
	};
	return Object.assign(store, {
		readOptedIn: () => store.optedIn,
		writeOptedIn: (value: boolean) => {
			store.optedIn = value;
		},
		readAutoOff: () => store.autoOff,
		writeAutoOff: (value: "crash" | null) => {
			store.autoOff = value;
		},
		readInstalled: () => store.installed,
		writeInstalled: (value: string | null) => {
			store.installed = value;
		},
		readState: (version: string): PersistedState =>
			store.state && store.state.version === version
				? { ...store.state }
				: { version, loading: false, strikes: 0, failedStarts: 0 },
		writeState: (state: PersistedState) => {
			store.state = { ...state };
		},
	});
}

/** An EmojiEngine for screen tests. Ready by default; `suggest` answers with the emoji given. */
export function fakeEmojiEngine(
	overrides: Partial<EmojiEngine> = {},
): EmojiEngine & {
	suggest: ReturnType<typeof vi.fn>;
	search: ReturnType<typeof vi.fn>;
	wake: ReturnType<typeof vi.fn>;
} {
	return {
		status: "ready",
		suggest: vi.fn(async () => [] as string[]),
		search: vi.fn(async () => [] as string[]),
		wake: vi.fn(),
		...overrides,
	} as EmojiEngine & {
		suggest: ReturnType<typeof vi.fn>;
		search: ReturnType<typeof vi.fn>;
		wake: ReturnType<typeof vi.fn>;
	};
}
```

- [ ] **Step 3: Write the failing tests**

Create these five test files.

`apps/web/src/features/emoji/cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EMOJI_CACHE_NAME } from "./assets";
import { deleteEmojiCache } from "./cache";

/** A CacheStorage with one cache, keyed by URL. */
function fakeStorage(urls: string[]) {
	const entries = new Set(urls);
	const cache = {
		keys: async () => [...entries].map((url) => new Request(url)),
		delete: async (request: Request) => entries.delete(request.url),
	};
	const storage = {
		has: async (name: string) => name === EMOJI_CACHE_NAME,
		open: async () => cache,
	} as unknown as CacheStorage;
	return { storage, entries };
}

const ORIGIN = "https://tagteam.example";
const url = (version: string, file: string) =>
	`${ORIGIN}/assets/emoji/${version}/${file}`;
const OTHER_APP_FILE = `${ORIGIN}/assets/app.js`;

describe("deleteEmojiCache", () => {
	const seed = () =>
		fakeStorage([
			url("old", "models/m/onnx/model_quantized.onnx"),
			url("old", "ort/ort.wasm"),
			url("new", "models/m/config.json"),
			OTHER_APP_FILE,
		]);

	it("removes other versions and keeps this one", async () => {
		const { storage, entries } = seed();
		await deleteEmojiCache("otherVersions", "new", storage);
		expect([...entries]).toEqual([
			url("new", "models/m/config.json"),
			OTHER_APP_FILE,
		]);
	});

	it("removes only this version", async () => {
		const { storage, entries } = seed();
		await deleteEmojiCache("thisVersion", "new", storage);
		expect(entries.has(url("new", "models/m/config.json"))).toBe(false);
		expect(entries.size).toBe(3);
	});

	it("removes every version, and never anything outside /assets/emoji/", async () => {
		const { storage, entries } = seed();
		await deleteEmojiCache("all", "new", storage);
		expect([...entries]).toEqual([OTHER_APP_FILE]);
	});

	it("does nothing without a Cache API or without a model cache", async () => {
		await expect(
			deleteEmojiCache("all", "v", undefined),
		).resolves.toBeUndefined();
		const empty = { has: async () => false } as unknown as CacheStorage;
		await expect(deleteEmojiCache("all", "v", empty)).resolves.toBeUndefined();
	});
});
```

`apps/web/src/features/emoji/support.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectSupport } from "./support";

class ModuleWorker {
	constructor(_url: string, options?: WorkerOptions) {
		void options?.type;
	}
	terminate() {}
}
class ClassicWorker {
	terminate() {}
}
const env = (patch: Record<string, unknown>) =>
	({
		WebAssembly: {},
		caches: {},
		Worker: ModuleWorker,
		...patch,
	}) as unknown as typeof globalThis;

describe("detectSupport", () => {
	it("is true when WebAssembly, the Cache API and module workers exist", () => {
		expect(detectSupport(env({}))).toBe(true);
	});

	it("is false without WebAssembly", () => {
		expect(detectSupport(env({ WebAssembly: undefined }))).toBe(false);
	});

	it("is false without the Cache API", () => {
		const { caches: _omit, ...rest } = {
			WebAssembly: {},
			caches: {},
			Worker: ModuleWorker,
		};
		expect(detectSupport(rest as unknown as typeof globalThis)).toBe(false);
	});

	it("is false without workers, or with workers that ignore the module type", () => {
		expect(detectSupport(env({ Worker: undefined }))).toBe(false);
		expect(detectSupport(env({ Worker: ClassicWorker }))).toBe(false);
	});

	it("is false when creating the probe worker throws", () => {
		class Throwing {
			constructor() {
				throw new Error("blocked");
			}
		}
		expect(detectSupport(env({ Worker: Throwing }))).toBe(false);
	});
});
```

`apps/web/src/features/emoji/engine-storage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalStorageEngineStorage } from "./engine-storage";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the engine's device storage", () => {
	it("is not opted in by default, and remembers the choice", () => {
		const storage = createLocalStorageEngineStorage();
		expect(storage.readOptedIn()).toBe(false);
		storage.writeOptedIn(true);
		expect(createLocalStorageEngineStorage().readOptedIn()).toBe(true);
		storage.writeOptedIn(false);
		expect(createLocalStorageEngineStorage().readOptedIn()).toBe(false);
	});

	it("remembers why suggestions were switched off", () => {
		const storage = createLocalStorageEngineStorage();
		expect(storage.readAutoOff()).toBeNull();
		storage.writeAutoOff("crash");
		expect(storage.readAutoOff()).toBe("crash");
		storage.writeAutoOff(null);
		expect(storage.readAutoOff()).toBeNull();
	});

	it("remembers which asset version was downloaded", () => {
		const storage = createLocalStorageEngineStorage();
		expect(storage.readInstalled()).toBeNull();
		storage.writeInstalled("abc123");
		expect(storage.readInstalled()).toBe("abc123");
		storage.writeInstalled(null);
		expect(storage.readInstalled()).toBeNull();
	});

	it("keeps counters for the current asset version only", () => {
		const storage = createLocalStorageEngineStorage();
		const state = { version: "v1", loading: true, strikes: 1, failedStarts: 2 };
		storage.writeState(state);
		expect(storage.readState("v1")).toEqual(state);
		expect(storage.readState("v2")).toEqual({
			version: "v2",
			loading: false,
			strikes: 0,
			failedStarts: 0,
		});
	});

	it("starts afresh from damaged data", () => {
		const storage = createLocalStorageEngineStorage();
		localStorage.setItem("tagteam.emoji.state", "{not json");
		expect(storage.readState("v1").strikes).toBe(0);
		localStorage.setItem(
			"tagteam.emoji.state",
			JSON.stringify({
				version: "v1",
				loading: "yes",
				strikes: -3,
				failedStarts: 1.5,
			}),
		);
		expect(storage.readState("v1")).toEqual({
			version: "v1",
			loading: false,
			strikes: 0,
			failedStarts: 0,
		});
	});

	it("keeps working when localStorage throws", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		const storage = createLocalStorageEngineStorage();
		expect(storage.readOptedIn()).toBe(false);
		expect(storage.readAutoOff()).toBeNull();
		expect(storage.readInstalled()).toBeNull();
		expect(storage.readState("v1").strikes).toBe(0);
		expect(() => storage.writeState(storage.readState("v1"))).not.toThrow();
		expect(() => storage.writeAutoOff("crash")).not.toThrow();
		expect(() => storage.writeInstalled("v1")).not.toThrow();
	});
});
```

`apps/web/src/features/emoji/auto-pick.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAutoPickExcluded } from "./auto-pick";
import catalog from "./catalog.json";

const entries = catalog as { e: string; n: string; g: string }[];
const named = (name: string) => {
	const entry = entries.find((candidate) => candidate.n === name);
	if (!entry) throw new Error(`no emoji named ${name}`);
	return entry;
};

describe("isAutoPickExcluded", () => {
	it("excludes every flag and every symbol", () => {
		const flags = entries.filter((entry) => entry.g === "flags");
		const symbols = entries.filter((entry) => entry.g === "symbols");
		expect(flags.length).toBeGreaterThan(200);
		expect(symbols.length).toBeGreaterThan(200);
		expect([...flags, ...symbols].every(isAutoPickExcluded)).toBe(true);
	});

	it("excludes the 24 clock faces and nothing else near them", () => {
		const excluded = entries
			.filter((entry) => entry.g === "travel & places")
			.filter(isAutoPickExcluded);
		expect(excluded).toHaveLength(24);
		expect(excluded.map((entry) => entry.n)).toContain("six o’clock");
		expect(excluded.map((entry) => entry.n)).toContain("twelve-thirty");
		for (const name of ["alarm clock", "watch", "stopwatch", "hourglass done"])
			expect(isAutoPickExcluded(named(name)), name).toBe(false);
	});

	it("keeps ordinary emoji", () => {
		for (const name of ["potted plant", "dog", "wastebasket", "shower", "bed"])
			expect(isAutoPickExcluded(named(name)), name).toBe(false);
	});

	it("excludes only flags, symbols and clock faces", () => {
		const excluded = entries.filter(isAutoPickExcluded);
		expect(
			excluded.every((entry) =>
				["flags", "symbols", "travel & places"].includes(entry.g),
			),
		).toBe(true);
	});
});
```

`apps/web/src/features/emoji/controller.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWorker, memoryEngineStorage } from "../../test/emoji";
import type { EmojiEntry } from "./catalog";
import {
	type ControllerDeps,
	createEmojiController,
	LOAD_TIMEOUT_MS,
	SUGGEST_TIMEOUT_MS,
} from "./controller";

const catalog: EmojiEntry[] = [
	{ e: "\u{1FAB4}", n: "potted plant", t: ["plant"], g: "animals & nature" },
	{ e: "\u{1F331}", n: "seedling", t: ["plant"], g: "animals & nature" },
	{ e: "\u{1F4A7}", n: "droplet", t: ["water"], g: "travel & places" },
	{ e: "\u{1F1EA}\u{1F1F8}", n: "flag: Spain", t: ["flag"], g: "flags" },
	{ e: "\u{1F6AE}", n: "litter in bin sign", t: ["bin"], g: "symbols" },
	{ e: "\u{1F555}️", n: "six o’clock", t: ["time"], g: "travel & places" },
	// The same emoji spelled with and without the presentation selector.
	{ e: "\u{1F4CB}", n: "clipboard", t: [], g: "objects" },
	{ e: "\u{1F4CB}️", n: "clipboard", t: [], g: "objects" },
];
const [PLANT, SEEDLING, DROPLET, FLAG, LITTER, CLOCK] = catalog.map((e) => e.e);
const TOTAL = 1000;

type Storage = ReturnType<typeof memoryEngineStorage>;

/** By default the person has downloaded version "v1" on this device. */
const downloaded = (extra: Parameters<typeof memoryEngineStorage>[0] = {}) =>
	memoryEngineStorage({ optedIn: true, installed: "v1", ...extra });

function setup(
	options: { storage?: Storage; deps?: Partial<ControllerDeps> } = {},
) {
	const storage = options.storage ?? downloaded();
	const workers: FakeWorker[] = [];
	const deleteCaches = vi.fn(async () => {});
	const controller = createEmojiController({
		version: "v1",
		downloadBytes: TOTAL,
		storage,
		createWorker: () => {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker;
		},
		loadCatalog: async () => catalog,
		supported: () => true,
		deleteCaches,
		autoPickExclusion: true,
		...options.deps,
	});
	const statuses: string[] = [];
	controller.subscribe(() =>
		statuses.push(controller.getSnapshot().engine.status),
	);
	return { controller, storage, workers, deleteCaches, statuses };
}
type Context = ReturnType<typeof setup>;

const status = (c: Context) => c.controller.getSnapshot().engine.status;
const state = (c: Context) => c.controller.getSnapshot().download;
const tick = () => vi.advanceTimersByTimeAsync(0);

/** wake(), let the catalog load, and answer `ready` (a load of the stored copy). */
async function ready(c: Context) {
	c.controller.wake();
	await tick();
	const worker = c.workers.at(-1) as FakeWorker;
	worker.reply({ type: "ready", id: 0 });
	return worker;
}

/** Presses Download and lets the worker start. */
async function startDownload(c: Context) {
	await c.controller.download();
	await tick();
	return c.workers.at(-1) as FakeWorker;
}

/** Asks for suggestions and answers the worker's rank request with `indices`. */
async function suggestWith(
	c: Context,
	worker: FakeWorker,
	indices: number[],
	title = "Water the plants",
	autoPick = false,
) {
	const result = c.controller.getSnapshot().engine.suggest(title, { autoPick });
	worker.reply({
		type: "ranked",
		id: worker.last("rank")?.id,
		indices,
		scores: indices.map(() => 1),
	});
	return result;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a device that has not opted in", () => {
	it("is off and never starts, whatever wakes it, so nothing is downloaded", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		expect(status(c)).toBe("off");
		expect(state(c)).toEqual({ kind: "notDownloaded", note: null });
		c.controller.wake();
		c.controller.warmUp();
		await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS * 2);
		expect(c.workers).toHaveLength(0);
		expect(c.deleteCaches).not.toHaveBeenCalled();
		expect(
			await c.controller.getSnapshot().engine.suggest("Water the plants"),
		).toEqual([]);
		expect(await c.controller.getSnapshot().engine.search("plant")).toEqual([]);
	});

	it("does not let an opt-in stand when no download ever finished", () => {
		const storage = memoryEngineStorage({ optedIn: true, installed: null });
		const c = setup({ storage });
		expect(storage.optedIn).toBe(false);
		expect(c.controller.getSnapshot().optedIn).toBe(false);
		expect(status(c)).toBe("off");
	});
});

describe("starting from the stored copy", () => {
	it("is unavailable until woken, then loads without the network, then is ready", async () => {
		const c = setup();
		expect(status(c)).toBe("unavailable");
		expect(state(c)).toEqual({ kind: "ready" });
		c.controller.wake();
		expect(status(c)).toBe("loading");
		expect(state(c)).toEqual({ kind: "loading" });
		await tick();
		const worker = c.workers[0];
		expect(worker.sent).toEqual([
			{
				type: "init",
				id: 0,
				count: catalog.length,
				allowNetwork: false,
				totalBytes: TOTAL,
			},
		]);
		worker.reply({ type: "ready", id: 0 });
		expect(status(c)).toBe("ready");
		expect(state(c)).toEqual({ kind: "ready" });
		expect(c.statuses).toEqual(["loading", "ready"]);
	});

	it("hands out a new engine object whenever the status changes, and the same one otherwise", async () => {
		const c = setup();
		const first = c.controller.getSnapshot().engine;
		expect(c.controller.getSnapshot().engine).toBe(first);
		await ready(c);
		const second = c.controller.getSnapshot().engine;
		expect(second).not.toBe(first);
		expect(second.status).toBe("ready");
	});

	it("starts once per app start however often it is woken", async () => {
		const c = setup();
		await ready(c);
		c.controller.wake();
		c.controller.warmUp();
		await tick();
		expect(c.workers).toHaveLength(1);
	});

	it("loads the stored copy in the background even when the device is offline: it never needs the network", async () => {
		const c = setup();
		c.controller.warmUp();
		await tick();
		expect(c.workers).toHaveLength(1);
		expect(c.workers[0].sent[0]).toMatchObject({ allowNetwork: false });
	});

	it("deletes the stored files of older versions once this one is loaded", async () => {
		const c = setup();
		await ready(c);
		expect(c.deleteCaches).toHaveBeenCalledWith("otherVersions");
	});

	it("goes back to the default, without counting a failure, when the browser removed the stored copy", async () => {
		const c = setup();
		c.controller.wake();
		await tick();
		c.workers[0].reply({
			type: "error",
			id: 0,
			kind: "uncached",
			message: "gone",
		});
		await tick();
		expect(state(c)).toEqual({ kind: "notDownloaded", note: "evicted" });
		expect(status(c)).toBe("off");
		expect(c.storage).toMatchObject({ optedIn: false, installed: null });
		expect(c.storage.state?.failedStarts).toBe(0);
		expect(c.workers[0].terminated).toBe(true);
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(1);
	});
});

describe("a download from an older asset version", () => {
	it("is never used by this build: no worker starts and the Me screen offers an update", async () => {
		const c = setup({ storage: downloaded({ installed: "v0" }) });
		expect(status(c)).toBe("unavailable");
		expect(state(c)).toEqual({ kind: "updateAvailable" });
		c.controller.wake();
		c.controller.warmUp();
		await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
		expect(c.workers).toHaveLength(0);
		expect(c.deleteCaches).not.toHaveBeenCalled();
		expect(
			await c.controller.getSnapshot().engine.suggest("Water the plants"),
		).toEqual([]);
	});

	it("is replaced when the person presses Download, and only then is the old copy deleted", async () => {
		const c = setup({ storage: downloaded({ installed: "v0" }) });
		const worker = await startDownload(c);
		expect(worker.sent[0]).toMatchObject({ allowNetwork: true });
		expect(c.deleteCaches).not.toHaveBeenCalled();
		worker.reply({ type: "ready", id: 0 });
		expect(c.storage.installed).toBe("v1");
		expect(state(c)).toEqual({ kind: "ready" });
		expect(c.deleteCaches).toHaveBeenCalledWith("otherVersions");
	});
});

describe("downloading", () => {
	it("starts only when the person presses Download, opts in, and reports progress", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		expect(c.storage.optedIn).toBe(true);
		expect(status(c)).toBe("loading");
		expect(state(c)).toEqual({ kind: "downloading", progress: null });
		expect(worker.sent).toEqual([
			{
				type: "init",
				id: 0,
				count: catalog.length,
				allowNetwork: true,
				totalBytes: TOTAL,
			},
		]);
		worker.reply({ type: "progress", id: 0, loaded: 250, total: TOTAL });
		expect(state(c)).toEqual({ kind: "downloading", progress: 0.25 });
		worker.reply({ type: "progress", id: 0, loaded: 5000, total: TOTAL });
		expect(state(c)).toEqual({ kind: "downloading", progress: 1 });
		worker.reply({ type: "ready", id: 0 });
		expect(state(c)).toEqual({ kind: "ready" });
		expect(status(c)).toBe("ready");
		expect(c.storage.installed).toBe("v1");
		expect(c.storage.state).toMatchObject({
			loading: false,
			strikes: 0,
			failedStarts: 0,
		});
	});

	it("presses of Download while it is already downloading or ready change nothing", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		await startDownload(c);
		await c.controller.download();
		await tick();
		expect(c.workers).toHaveLength(1);
		c.workers[0].reply({ type: "ready", id: 0 });
		await c.controller.download();
		await tick();
		expect(c.workers).toHaveLength(1);
	});

	it("allows a slow download as long as bytes keep arriving, and gives up after 60 seconds of silence", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
		worker.reply({ type: "progress", id: 0, loaded: 10, total: TOTAL });
		await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
		expect(status(c)).toBe("loading");
		await vi.advanceTimersByTimeAsync(1);
		expect(status(c)).toBe("unavailable");
		expect(state(c)).toEqual({ kind: "failed", reason: "load" });
		expect(worker.terminated).toBe(true);
	});

	it("says why it failed, in one of four plain reasons, and Try again downloads again", async () => {
		const cases = [
			["offline", "offline"],
			["quota", "storage"],
			["load", "load"],
			["runtime", "load"],
		] as const;
		for (const [kind, reason] of cases) {
			const c = setup({ storage: memoryEngineStorage() });
			const worker = await startDownload(c);
			worker.reply({ type: "error", id: 0, kind, message: kind });
			await tick();
			expect(state(c), kind).toEqual({ kind: "failed", reason });
			expect(status(c)).toBe("unavailable");
			expect(worker.terminated).toBe(true);

			const retry = await startDownload(c);
			expect(retry).not.toBe(worker);
			expect(state(c)).toEqual({ kind: "downloading", progress: null });
			retry.reply({ type: "ready", id: 0 });
			expect(state(c)).toEqual({ kind: "ready" });
		}
	});

	it("does not count an offline failure as a failed start", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "error", id: 0, kind: "offline", message: "offline" });
		await tick();
		expect(c.storage.state?.failedStarts).toBe(0);
	});

	it("a failed first download lapses the opt-in at the next app start", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "error", id: 0, kind: "load", message: "x" });
		await tick();
		expect(c.storage.optedIn).toBe(true);
		const next = setup({ storage: c.storage });
		expect(next.controller.getSnapshot().optedIn).toBe(false);
		expect(next.controller.getSnapshot().download).toEqual({
			kind: "notDownloaded",
			note: null,
		});
	});

	it("in a browser without WebAssembly, module workers or the Cache API says so, opts in to nothing and starts nothing", async () => {
		const c = setup({
			storage: memoryEngineStorage(),
			deps: { supported: () => false },
		});
		await c.controller.download();
		await tick();
		expect(state(c)).toEqual({ kind: "failed", reason: "unsupported" });
		expect(c.workers).toHaveLength(0);
		expect(c.storage.optedIn).toBe(false);
	});

	it("cancel and remove stop a download, delete what arrived, and return to the default", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "progress", id: 0, loaded: 100, total: TOTAL });
		await c.controller.remove();
		expect(worker.terminated).toBe(true);
		expect(c.deleteCaches).toHaveBeenCalledWith("all");
		expect(state(c)).toEqual({ kind: "notDownloaded", note: null });
		expect(status(c)).toBe("off");
		expect(c.storage).toMatchObject({ optedIn: false, installed: null });
		expect(c.storage.state?.loading).toBe(false);
		// A reply from the stopped worker is ignored.
		worker.reply({ type: "ready", id: 0 });
		expect(status(c)).toBe("off");
	});

	it("catalog files that fail to load end the download as a plain load failure", async () => {
		const c = setup({
			storage: memoryEngineStorage(),
			deps: { loadCatalog: async () => Promise.reject(new Error("offline")) },
		});
		await c.controller.download();
		await tick();
		expect(state(c)).toEqual({ kind: "failed", reason: "load" });
		expect(c.workers).toHaveLength(0);
	});
});

describe("Remove download", () => {
	it("stops the worker, deletes every stored version and returns to the default", async () => {
		const c = setup();
		const worker = await ready(c);
		await c.controller.remove();
		expect(worker.terminated).toBe(true);
		expect(c.deleteCaches).toHaveBeenCalledWith("all");
		expect(status(c)).toBe("off");
		expect(state(c)).toEqual({ kind: "notDownloaded", note: null });
		expect(c.storage).toMatchObject({ optedIn: false, installed: null });
		expect(
			await c.controller.getSnapshot().engine.suggest("Water the plants"),
		).toEqual([]);
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(1);
	});
});

describe("suggestions", () => {
	it("returns up to three valid emoji, best first, without repeats", async () => {
		const c = setup();
		const worker = await ready(c);
		// 6 and 7 are the clipboard with and without U+FE0F: one emoji.
		expect(await suggestWith(c, worker, [1, 0, 6, 7, 2])).toEqual([
			SEEDLING,
			PLANT,
			"\u{1F4CB}",
		]);
	});

	it("leaves flags, symbols and clock faces out of an automatic pick only", async () => {
		const c = setup();
		const worker = await ready(c);
		expect(await suggestWith(c, worker, [3, 4, 5, 2], "x1x", true)).toEqual([
			DROPLET,
		]);
		expect(await suggestWith(c, worker, [3, 4, 5, 2], "x1x", false)).toEqual([
			FLAG,
			LITTER,
			CLOCK,
		]);
	});

	it("keeps them for an automatic pick when the exclusion is off", async () => {
		const c = setup({ deps: { autoPickExclusion: false } });
		const worker = await ready(c);
		expect(await suggestWith(c, worker, [3, 2], "x1x", true)).toEqual([
			FLAG,
			DROPLET,
		]);
	});

	it("answers search with every distinct valid match", async () => {
		const c = setup();
		const worker = await ready(c);
		const result = c.controller.getSnapshot().engine.search("plant");
		worker.reply({
			type: "ranked",
			id: worker.last("rank")?.id,
			indices: [0, 1, 0],
			scores: [3, 2, 1],
		});
		expect(await result).toEqual([PLANT, SEEDLING]);
	});

	it("says nothing for a short title, a short search, or before it is ready", async () => {
		const c = setup();
		expect(
			await c.controller.getSnapshot().engine.suggest("Water the plants"),
		).toEqual([]);
		const worker = await ready(c);
		const engine = c.controller.getSnapshot().engine;
		expect(await engine.suggest("ab")).toEqual([]);
		expect(await engine.search("a")).toEqual([]);
		expect(worker.last("rank")).toBeUndefined();
	});

	it("trims the title before asking", async () => {
		const c = setup();
		const worker = await ready(c);
		const pending = c.controller.getSnapshot().engine.suggest("  Water  ");
		expect(worker.last("rank")?.text).toBe("Water");
		worker.reply({
			type: "ranked",
			id: worker.last("rank")?.id,
			indices: [],
			scores: [],
		});
		await pending;
	});
});

describe("failure handling when loading the stored copy", () => {
	it("goes unavailable for this app start when the worker reports a load failure, and does not restart", async () => {
		const c = setup();
		c.controller.wake();
		await tick();
		c.workers[0].reply({ type: "error", id: 0, kind: "load", message: "x" });
		await tick();
		expect(status(c)).toBe("unavailable");
		expect(state(c)).toEqual({ kind: "failed", reason: "load" });
		expect(c.workers[0].terminated).toBe(true);
		expect(c.storage.state?.failedStarts).toBe(1);
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(1);
	});

	it("is unavailable, and never tries again, in a browser without WebAssembly, module workers or the Cache API", async () => {
		const c = setup({ deps: { supported: () => false } });
		c.controller.wake();
		await tick();
		expect(state(c)).toEqual({ kind: "failed", reason: "unsupported" });
		expect(c.workers).toHaveLength(0);
		expect(c.storage.state).toBeNull();
	});

	it("terminates a worker that takes longer than 60 seconds to load", async () => {
		const c = setup();
		c.controller.wake();
		await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
		expect(status(c)).toBe("loading");
		await vi.advanceTimersByTimeAsync(1);
		expect(status(c)).toBe("unavailable");
		expect(c.workers[0].terminated).toBe(true);
	});

	it("terminates the worker and goes unavailable when it throws while loading", async () => {
		const c = setup();
		c.controller.wake();
		await tick();
		c.workers[0].onerror?.({});
		await tick();
		expect(status(c)).toBe("unavailable");
		expect(c.workers[0].terminated).toBe(true);
	});

	it("terminates the worker and goes unavailable when it posts an error after it was ready, and answers what was waiting with nothing", async () => {
		const c = setup();
		const worker = await ready(c);
		const waiting = c.controller
			.getSnapshot()
			.engine.suggest("Water the plants");
		worker.reply({ type: "error", id: null, kind: "runtime", message: "boom" });
		await tick();
		expect(await waiting).toEqual([]);
		expect(status(c)).toBe("unavailable");
		expect(worker.terminated).toBe(true);
	});

	it("drops a suggestion that takes longer than 2 seconds, and ignores its late reply", async () => {
		const c = setup();
		const worker = await ready(c);
		const slow = c.controller.getSnapshot().engine.suggest("Water the plants");
		const id = worker.last("rank")?.id;
		await vi.advanceTimersByTimeAsync(SUGGEST_TIMEOUT_MS);
		expect(await slow).toEqual([]);
		worker.reply({ type: "ranked", id, indices: [0], scores: [1] });
		expect(status(c)).toBe("ready");
	});

	it("goes unavailable after three bad results in a row, but not when a good one comes between", async () => {
		const c = setup();
		const worker = await ready(c);
		const timeOut = async () => {
			const pending = c.controller
				.getSnapshot()
				.engine.suggest("Water the plants");
			await vi.advanceTimersByTimeAsync(SUGGEST_TIMEOUT_MS);
			await pending;
		};
		await timeOut();
		await timeOut();
		expect(await suggestWith(c, worker, [0])).toEqual([PLANT]);
		await timeOut();
		await timeOut();
		expect(status(c)).toBe("ready");
		await timeOut();
		expect(status(c)).toBe("unavailable");
		expect(worker.terminated).toBe(true);
	});

	it("treats malformed output as a bad result: dropped, and three in a row make the engine unavailable", async () => {
		const malformed = [
			{ indices: "not a list" },
			{ indices: [0, 99] },
			{ indices: [0.5] },
			{ indices: Array.from({ length: 41 }, () => 0) },
		];
		for (const reply of malformed) {
			const c = setup();
			const worker = await ready(c);
			for (let attempt = 1; attempt <= 3; attempt++) {
				const pending = c.controller
					.getSnapshot()
					.engine.suggest("Water the plants");
				worker.reply({
					type: "ranked",
					id: worker.last("rank")?.id,
					scores: [],
					...reply,
				});
				expect(await pending).toEqual([]);
				expect(status(c), JSON.stringify(reply)).toBe(
					attempt < 3 ? "ready" : "unavailable",
				);
			}
		}
	});

	it("deletes this version's stored files, and forgets the download, when loading fails with files present", async () => {
		const c = setup();
		c.controller.wake();
		await tick();
		c.workers[0].reply({
			type: "error",
			id: 0,
			kind: "corrupt",
			message: "bad onnx",
		});
		await tick();
		expect(c.deleteCaches).toHaveBeenCalledWith("thisVersion");
		expect(c.storage.installed).toBeNull();
		expect(status(c)).toBe("unavailable");
		expect(state(c)).toEqual({ kind: "failed", reason: "load" });
	});

	it("goes unavailable on a storage quota error and touches nothing else", async () => {
		const c = setup({ storage: memoryEngineStorage() });
		const worker = await startDownload(c);
		worker.reply({ type: "error", id: 0, kind: "quota", message: "quota" });
		await tick();
		expect(state(c)).toEqual({ kind: "failed", reason: "storage" });
		expect(c.deleteCaches).not.toHaveBeenCalled();
	});

	it("goes unavailable when the catalog cannot be loaded, or the worker cannot be created", async () => {
		const noCatalog = setup({
			deps: { loadCatalog: async () => Promise.reject(new Error("x")) },
		});
		noCatalog.controller.wake();
		await tick();
		expect(status(noCatalog)).toBe("unavailable");
		expect(noCatalog.workers).toHaveLength(0);

		const noWorker = setup({
			deps: {
				createWorker: () => {
					throw new Error("no workers");
				},
			},
		});
		noWorker.controller.wake();
		await tick();
		expect(status(noWorker)).toBe("unavailable");
	});
});

describe("the loading marker", () => {
	it("is written before the model loads, and cleared on ready and on every handled failure", async () => {
		const c = setup();
		c.controller.wake();
		expect(c.storage.state?.loading).toBe(true);
		await tick();
		c.workers[0].reply({ type: "ready", id: 0 });
		expect(c.storage.state?.loading).toBe(false);

		const failing = setup();
		failing.controller.wake();
		await tick();
		failing.workers[0].reply({
			type: "error",
			id: 0,
			kind: "load",
			message: "x",
		});
		await tick();
		expect(failing.storage.state?.loading).toBe(false);
	});

	it("is cleared when the engine is disposed or removed during a load", async () => {
		const disposed = setup();
		disposed.controller.wake();
		await tick();
		disposed.controller.dispose();
		expect(disposed.storage.state?.loading).toBe(false);

		const removed = setup();
		removed.controller.wake();
		await tick();
		await removed.controller.remove();
		expect(removed.storage.state?.loading).toBe(false);
	});

	it("counts a marker still set at start as a strike, and skips the warm-up that start", async () => {
		const storage = downloaded({ state: { loading: true, strikes: 0 } });
		const c = setup({ storage });
		expect(storage.state).toMatchObject({ loading: false, strikes: 1 });
		expect(status(c)).toBe("unavailable");
		c.controller.warmUp();
		await tick();
		expect(c.workers).toHaveLength(0);
		// A person opening the New task sheet still gets the engine.
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(1);
	});

	it("goes back to the default after two strikes, deletes the download, and explains why", async () => {
		const storage = downloaded({ state: { loading: true, strikes: 1 } });
		const c = setup({ storage });
		const snapshot = c.controller.getSnapshot();
		expect(snapshot.optedIn).toBe(false);
		expect(snapshot.download).toEqual({ kind: "notDownloaded", note: "crash" });
		expect(snapshot.engine.status).toBe("off");
		expect(storage).toMatchObject({
			optedIn: false,
			installed: null,
			autoOff: "crash",
		});
		expect(c.deleteCaches).toHaveBeenCalledWith("all");
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(0);

		// Pressing Download again clears the explanation and tries once more.
		await c.controller.download();
		await tick();
		expect(c.controller.getSnapshot().download).toEqual({
			kind: "downloading",
			progress: null,
		});
		expect(storage.autoOff).toBeNull();
		expect(c.workers).toHaveLength(1);
		expect(storage.state?.strikes).toBe(2);
	});

	it("forgets strikes and failed starts after a success", async () => {
		const storage = downloaded({ state: { strikes: 1, failedStarts: 2 } });
		const c = setup({ storage });
		await ready(c);
		expect(storage.state).toMatchObject({
			strikes: 0,
			failedStarts: 0,
			loading: false,
		});
	});
});

describe("stopping after repeated failures", () => {
	it("does not load once three app starts in a row have ended unavailable, and says so", async () => {
		const storage = downloaded({ state: { failedStarts: 3 } });
		const c = setup({ storage });
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(0);
		expect(state(c)).toEqual({ kind: "failed", reason: "stopped" });
		expect(status(c)).toBe("unavailable");
	});

	it("tries again when the asset version changes", async () => {
		const storage = downloaded({ state: { version: "old", failedStarts: 3 } });
		const c = setup({ storage });
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(1);
	});

	it("tries again when the person presses Download again", async () => {
		const storage = downloaded({ state: { failedStarts: 3 } });
		const c = setup({ storage });
		c.controller.wake();
		await tick();
		expect(state(c)).toEqual({ kind: "failed", reason: "stopped" });
		await c.controller.download();
		await tick();
		expect(storage.state?.failedStarts).toBe(0);
		expect(c.workers).toHaveLength(1);
		expect(state(c)).toEqual({ kind: "downloading", progress: null });
	});

	it("counts a failed start once, however many things go wrong in it", async () => {
		const c = setup();
		const worker = await ready(c);
		worker.reply({ type: "error", id: null, kind: "runtime", message: "a" });
		await tick();
		expect(c.storage.state?.failedStarts).toBe(1);
	});
});

describe("disposing", () => {
	it("stops the worker and lets a screen that mounts later start the engine again", async () => {
		const c = setup();
		const worker = await ready(c);
		c.controller.dispose();
		expect(worker.terminated).toBe(true);
		expect(status(c)).toBe("unavailable");
		c.controller.wake();
		await tick();
		expect(c.workers).toHaveLength(2);
		expect(status(c)).toBe("loading");
	});
});
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/cache.test.ts src/features/emoji/support.test.ts src/features/emoji/engine-storage.test.ts src/features/emoji/auto-pick.test.ts src/features/emoji/controller.test.ts`
Expected: FAIL — each file cannot resolve its module (`./cache`, `./support`, `./engine-storage`, `./auto-pick`, `./controller`).

- [ ] **Step 4: Implement the small modules**

`apps/web/src/features/emoji/cache.ts`:

```ts
import { EMOJI_ASSETS_ROOT, EMOJI_CACHE_NAME } from "./assets";

/**
 * Which Cache API entries to delete. Entries are the model and wasm files transformers.js stored,
 * keyed by their URL under /assets/emoji/<version>/.
 * - `otherVersions`: everything except `version` (cleanup after an update).
 * - `thisVersion`: only `version` (the stored model is corrupt; the next start downloads it again).
 * - `all`: every version (the person switched emoji suggestions off).
 */
export type CacheScope = "otherVersions" | "thisVersion" | "all";

export async function deleteEmojiCache(
	scope: CacheScope,
	version: string,
	storage: CacheStorage | undefined = typeof caches === "undefined"
		? undefined
		: caches,
): Promise<void> {
	if (!storage || !(await storage.has(EMOJI_CACHE_NAME))) return;
	const cache = await storage.open(EMOJI_CACHE_NAME);
	const own = `${EMOJI_ASSETS_ROOT}${version}/`;
	for (const request of await cache.keys()) {
		const path = new URL(request.url).pathname;
		if (!path.startsWith(EMOJI_ASSETS_ROOT)) continue;
		const isOwn = path.startsWith(own);
		if (
			scope === "all" ||
			(scope === "thisVersion" && isOwn) ||
			(scope === "otherVersions" && !isOwn)
		)
			await cache.delete(request);
	}
}
```

`apps/web/src/features/emoji/support.ts`:

```ts
/**
 * True when this browser can run the model: WebAssembly, the Cache API and module workers.
 * Module workers have no direct test, so a throwaway worker is created with a `type` getter;
 * a browser that supports them reads it.
 */
export function detectSupport(env: typeof globalThis = globalThis): boolean {
	if (typeof env.WebAssembly !== "object") return false;
	if (!("caches" in env)) return false;
	if (typeof env.Worker !== "function") return false;
	let reads = false;
	try {
		const probe = new env.Worker("data:text/javascript,", {
			get type() {
				reads = true;
				return "module" as const;
			},
		});
		probe.terminate();
	} catch {
		return false;
	}
	return reads;
}
```

`apps/web/src/features/emoji/engine-storage.ts`:

```ts
import { readFlag, writeFlag } from "../../lib/storage";

// The engine's device-local state lives in localStorage, not in the Dexie store: it is read
// synchronously at startup (before any async open), it must survive a tab that crashes while the
// model loads, and sign-out clears the Dexie store but a device setting is not the user's data.
const OPTED_IN_KEY = "tagteam.emoji.optedIn";
const AUTO_OFF_KEY = "tagteam.emoji.autoOff";
const INSTALLED_KEY = "tagteam.emoji.installed";
const STATE_KEY = "tagteam.emoji.state";

/** What survives between app starts, for one asset version. */
export interface PersistedState {
	/** The asset version these counters belong to; a different version starts afresh. */
	version: string;
	/** Written before the model loads and cleared after. Found set at start, the last load crashed the app. */
	loading: boolean;
	/** Starts that found `loading` still set, since the last success. */
	strikes: number;
	/** App starts in a row that ended unavailable, since the last success. */
	failedStarts: number;
}

export interface EngineStorage {
	/** The person pressed Download on this device and has not removed it. Off by default: nothing downloads until then. */
	readOptedIn(): boolean;
	writeOptedIn(optedIn: boolean): void;
	/** Set when two crashes switched emoji suggestions off, so Me can say why. */
	readAutoOff(): "crash" | null;
	writeAutoOff(reason: "crash" | null): void;
	/** The asset version whose download finished and loaded on this device, or null. */
	readInstalled(): string | null;
	writeInstalled(version: string | null): void;
	readState(version: string): PersistedState;
	writeState(state: PersistedState): void;
}

const fresh = (version: string): PersistedState => ({
	version,
	loading: false,
	strikes: 0,
	failedStarts: 0,
});

const count = (value: unknown) =>
	typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: 0;

export function createLocalStorageEngineStorage(): EngineStorage {
	return {
		readOptedIn: () => readFlag(OPTED_IN_KEY, false),
		writeOptedIn: (optedIn) => writeFlag(OPTED_IN_KEY, optedIn),
		readAutoOff() {
			try {
				return localStorage.getItem(AUTO_OFF_KEY) === "crash" ? "crash" : null;
			} catch {
				return null;
			}
		},
		writeAutoOff(reason) {
			try {
				if (reason === null) localStorage.removeItem(AUTO_OFF_KEY);
				else localStorage.setItem(AUTO_OFF_KEY, reason);
			} catch {
				// Not persisted; the Me section still shows the right state this session.
			}
		},
		readInstalled() {
			try {
				const value = localStorage.getItem(INSTALLED_KEY);
				return value !== null && value !== "" ? value : null;
			} catch {
				return null;
			}
		},
		writeInstalled(version) {
			try {
				if (version === null) localStorage.removeItem(INSTALLED_KEY);
				else localStorage.setItem(INSTALLED_KEY, version);
			} catch {
				// Not persisted; the engine then asks for a download again next start.
			}
		},
		readState(version) {
			try {
				const raw = localStorage.getItem(STATE_KEY);
				if (raw === null) return fresh(version);
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				if (parsed.version !== version) return fresh(version);
				return {
					version,
					loading: parsed.loading === true,
					strikes: count(parsed.strikes),
					failedStarts: count(parsed.failedStarts),
				};
			} catch {
				return fresh(version);
			}
		},
		writeState(state) {
			try {
				localStorage.setItem(STATE_KEY, JSON.stringify(state));
			} catch {
				// Not persisted; the engine still works this session.
			}
		},
	};
}
```

`apps/web/src/features/emoji/auto-pick.ts`:

```ts
// Which emoji the automatic pick may choose. No imports, so scripts/eval-emoji.mjs can load this
// file directly (Node strips the types). Spec §7: flags, the symbols group and clock faces gave
// the worst literal-word matches in the spike, so they can be left out of automatic suggestions
// (they stay in the picker). The spike's evaluation gates the switch: run
// `pnpm --filter @tagteam/web emoji:eval` and set the flag below as it says.

/**
 * True: automatic suggestions skip flags, symbols and clock faces. Stays false unless the
 * evaluation shows that skipping them does not lower first-pick accuracy.
 */
export const AUTO_PICK_EXCLUSION = false;

const EXCLUDED_GROUPS = new Set(["flags", "symbols"]);
// "one o’clock" (U+2019) and "one-thirty": the 24 clock faces in "travel & places".
const CLOCK_FACE = /^[a-z]+ o’clock$|^[a-z]+-thirty$/;

export interface AutoPickEntry {
	/** Name, for example "one o’clock". */
	n: string;
	/** Group, for example "flags". */
	g: string;
}

/** True for an emoji that an automatic suggestion must not offer. */
export function isAutoPickExcluded(entry: AutoPickEntry): boolean {
	return EXCLUDED_GROUPS.has(entry.g) || CLOCK_FACE.test(entry.n);
}
```

- [ ] **Step 5: Implement the controller**

`apps/web/src/features/emoji/controller.ts`:

```ts
import { isEmoji, MAX_TITLE } from "@tagteam/core";
import { AUTO_PICK_EXCLUSION, isAutoPickExcluded } from "./auto-pick";
import type { CacheScope } from "./cache";
import { type EmojiEntry, emojiKey } from "./catalog";
import type { EmojiEngine, EmojiEngineStatus, SuggestOptions } from "./engine";
import type { EngineStorage } from "./engine-storage";
import { SHORTLIST } from "./search";
import type {
	FailureKind,
	WorkerReply,
	WorkerRequest,
} from "./worker-protocol";

/** The part of a Web Worker the controller uses, so tests can pass a fake. */
export interface WorkerLike {
	postMessage(request: WorkerRequest): void;
	terminate(): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	onerror: ((event: unknown) => void) | null;
	onmessageerror: ((event: unknown) => void) | null;
}

export interface ControllerDeps {
	/** The asset version. A download of another version is not used, and counters from another version are ignored. */
	version: string;
	/** Bytes of a full download, the denominator of the progress. */
	downloadBytes: number;
	storage: EngineStorage;
	createWorker(): WorkerLike;
	loadCatalog(): Promise<EmojiEntry[]>;
	/** WebAssembly, module workers and the Cache API all exist. */
	supported(): boolean;
	deleteCaches(scope: CacheScope): Promise<void>;
	/** Defaults to AUTO_PICK_EXCLUSION. */
	autoPickExclusion?: boolean;
	loadTimeoutMs?: number;
	suggestTimeoutMs?: number;
}

/** Why a download or a load ended in failure, in words the Me screen can use. */
export type FailureReason =
	| "offline"
	| "storage"
	| "load"
	| "stopped"
	| "unsupported";

/** What the Me screen shows. Only the Me screen ever shows it: nothing else in the app reacts to an update or a failure. */
export type DownloadState =
	/** The default. `note` explains a switch-off the person did not ask for. */
	| { kind: "notDownloaded"; note: "crash" | "evicted" | null }
	/** A download of an older asset version is on the device and cannot run with this build. */
	| { kind: "updateAvailable" }
	/** The person pressed Download. `progress` is 0 to 1, or null before the first byte. */
	| { kind: "downloading"; progress: number | null }
	/** Loading the stored copy. */
	| { kind: "loading" }
	/** Downloaded; suggestions work (the model loads from the device when the app wants it). */
	| { kind: "ready" }
	| { kind: "failed"; reason: FailureReason };

/** What the screens read: a new `engine` object whenever anything below changes. */
export interface EmojiSnapshot {
	engine: EmojiEngine;
	/** The person pressed Download on this device and has not removed it. */
	optedIn: boolean;
	download: DownloadState;
}

export interface EmojiController {
	getSnapshot(): EmojiSnapshot;
	subscribe(listener: () => void): () => void;
	/** The person opened a screen that wants suggestions: load the stored copy if there is one. Never downloads. */
	wake(): void;
	/** Background load after the first sync. Same rules as `wake`, and skipped in the app start that found a crash. Never downloads. */
	warmUp(): void;
	/** The Download button: opts in and downloads (or loads the stored copy). The only way anything is downloaded. */
	download(): Promise<void>;
	/** The Cancel and Remove download buttons: stops the engine, deletes every stored version, opts out. */
	remove(): Promise<void>;
	dispose(): void;
}

export const LOAD_TIMEOUT_MS = 60_000;
export const SUGGEST_TIMEOUT_MS = 2_000;
const BAD_RESULTS_IN_A_ROW = 3;
const STRIKES_TO_SWITCH_OFF = 2;
const FAILED_STARTS_TO_STOP = 3;
const MAX_SUGGESTIONS = 3;
const MIN_TITLE = 3;
const MIN_QUERY = 2;
const INIT_ID = 0;

type Phase = "idle" | "loading" | "ready" | "unavailable";
type Mode = "download" | "cache";
type Failure = FailureKind | "timeout";
interface Pending {
	resolve(indices: number[]): void;
	timer: ReturnType<typeof setTimeout>;
}

const isReply = (data: unknown): data is WorkerReply =>
	typeof data === "object" &&
	data !== null &&
	typeof (data as { type?: unknown }).type === "string";

const reasonFor = (kind: Failure): FailureReason =>
	kind === "offline" ? "offline" : kind === "quota" ? "storage" : "load";

export function createEmojiController(deps: ControllerDeps): EmojiController {
	const { storage, version } = deps;
	const loadTimeoutMs = deps.loadTimeoutMs ?? LOAD_TIMEOUT_MS;
	const suggestTimeoutMs = deps.suggestTimeoutMs ?? SUGGEST_TIMEOUT_MS;
	const exclusion = deps.autoPickExclusion ?? AUTO_PICK_EXCLUSION;

	let optedIn = storage.readOptedIn();
	let autoOff = storage.readAutoOff();
	let installed = storage.readInstalled();
	let phase: Phase = "idle";
	let mode: Mode = "cache";
	let progress: number | null = null;
	let failure: FailureReason | null = null;
	let evicted = false;
	let crashedAtStart = false;
	let countedThisStart = false;
	let generation = 0;
	let worker: WorkerLike | null = null;
	let catalog: EmojiEntry[] = [];
	let loadTimer: ReturnType<typeof setTimeout> | undefined;
	let badInARow = 0;
	let nextId = INIT_ID + 1;
	const pending = new Map<number, Pending>();
	const listeners = new Set<() => void>();

	// A "loading" marker still set means the last attempt never finished: the app crashed or reloaded.
	const saved = storage.readState(version);
	if (saved.loading) {
		crashedAtStart = true;
		const next = { ...saved, loading: false, strikes: saved.strikes + 1 };
		storage.writeState(next);
		if (next.strikes >= STRIKES_TO_SWITCH_OFF) {
			// A device that cannot hold the model should not keep 49 MB of it either.
			optedIn = false;
			installed = null;
			autoOff = "crash";
			storage.writeOptedIn(false);
			storage.writeInstalled(null);
			storage.writeAutoOff("crash");
			void deps.deleteCaches("all").catch(() => {});
		}
	}
	// An opt-in only lasts once a download has finished: after an interrupted first download
	// the next app start is back to the default.
	if (optedIn && installed === null) {
		optedIn = false;
		storage.writeOptedIn(false);
	}

	const status = (): EmojiEngineStatus =>
		!optedIn ? "off" : phase === "idle" ? "unavailable" : phase;

	function downloadState(): DownloadState {
		if (failure === "unsupported") return { kind: "failed", reason: failure };
		if (!optedIn)
			return {
				kind: "notDownloaded",
				note: autoOff === "crash" ? "crash" : evicted ? "evicted" : null,
			};
		if (failure !== null) return { kind: "failed", reason: failure };
		if (phase === "loading")
			return mode === "download"
				? { kind: "downloading", progress }
				: { kind: "loading" };
		if (phase === "ready") return { kind: "ready" };
		return installed === version
			? { kind: "ready" }
			: { kind: "updateAvailable" };
	}

	function pick(indices: number[], autoPick: boolean): string[] {
		const seen = new Set<string>();
		const emoji: string[] = [];
		for (const index of indices) {
			const entry = catalog[index];
			if (!entry || !isEmoji(entry.e)) continue;
			if (autoPick && exclusion && isAutoPickExcluded(entry)) continue;
			const key = emojiKey(entry.e);
			if (seen.has(key)) continue;
			seen.add(key);
			emoji.push(entry.e);
		}
		return emoji;
	}

	function rankText(text: string): Promise<number[]> {
		const target = worker;
		if (phase !== "ready" || !target) return Promise.resolve([]);
		return new Promise((resolve) => {
			const id = nextId++;
			// A reply after the timeout finds no pending entry and is ignored.
			const timer = setTimeout(() => {
				pending.delete(id);
				resolve([]);
				countBadResult();
			}, suggestTimeoutMs);
			pending.set(id, { resolve, timer });
			target.postMessage({ type: "rank", id, text });
		});
	}

	function countBadResult() {
		badInARow++;
		if (badInARow >= BAD_RESULTS_IN_A_ROW) void fail("runtime", generation);
	}

	const engineFor = (current: EmojiEngineStatus): EmojiEngine => ({
		status: current,
		async suggest(title: string, options?: SuggestOptions) {
			const text = title.trim().slice(0, MAX_TITLE);
			if (text.length < MIN_TITLE || phase !== "ready") return [];
			return pick(await rankText(text), options?.autoPick === true).slice(
				0,
				MAX_SUGGESTIONS,
			);
		},
		async search(query: string) {
			const text = query.trim().slice(0, MAX_TITLE);
			if (text.length < MIN_QUERY || phase !== "ready") return [];
			return pick(await rankText(text), false);
		},
		wake,
	});

	let snapshot: EmojiSnapshot = {
		engine: engineFor(status()),
		optedIn,
		download: downloadState(),
	};
	const rebuild = () => {
		snapshot = {
			engine: engineFor(status()),
			optedIn,
			download: downloadState(),
		};
	};
	function publish() {
		rebuild();
		for (const listener of [...listeners]) listener();
	}

	/** The attempt ended on purpose (not by a crash), so it must not count as one. */
	function clearMarker() {
		const state = storage.readState(version);
		if (state.loading) storage.writeState({ ...state, loading: false });
	}

	function stopWorker() {
		clearTimeout(loadTimer);
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.resolve([]);
		}
		pending.clear();
		const old = worker;
		worker = null;
		if (old) {
			old.onmessage = old.onerror = old.onmessageerror = null;
			old.terminate();
		}
	}

	/** Every failure ends here: the worker is gone, the engine is unavailable for this app start. */
	async function fail(kind: Failure, owner: number) {
		if (owner !== generation || (phase !== "loading" && phase !== "ready"))
			return;
		stopWorker();
		progress = null;
		if (kind === "uncached") {
			// The browser evicted the stored copy. Not a failure: back to the default, Download again.
			clearMarker();
			installed = null;
			optedIn = false;
			evicted = true;
			storage.writeInstalled(null);
			storage.writeOptedIn(false);
			phase = "idle";
			publish();
			return;
		}
		phase = "unavailable";
		failure = reasonFor(kind);
		// A device that is simply offline has not failed; every other failure counts toward stopping.
		const counts = kind !== "offline" && !countedThisStart;
		countedThisStart ||= kind !== "offline";
		const state = storage.readState(version);
		storage.writeState({
			...state,
			loading: false,
			failedStarts: state.failedStarts + (counts ? 1 : 0),
		});
		if (kind === "corrupt") {
			// The files are stored but could not be loaded: drop them so Try again downloads them anew.
			installed = null;
			storage.writeInstalled(null);
		}
		publish();
		if (kind === "corrupt")
			await deps.deleteCaches("thisVersion").catch(() => {});
	}

	/** Gives the load another `loadTimeoutMs`: a slow download is fine while bytes keep arriving. */
	function armLoadTimer(owner: number) {
		clearTimeout(loadTimer);
		loadTimer = setTimeout(() => void fail("timeout", owner), loadTimeoutMs);
	}

	function onMessage(data: unknown, owner: number) {
		if (owner !== generation || !isReply(data)) return;
		if (data.type === "error") {
			void fail(data.kind, owner);
		} else if (data.type === "progress") {
			if (phase !== "loading" || data.total <= 0) return;
			progress = Math.min(1, Math.max(0, data.loaded / data.total));
			armLoadTimer(owner);
			publish();
		} else if (data.type === "ready") {
			if (phase !== "loading") return;
			clearTimeout(loadTimer);
			storage.writeState({
				version,
				loading: false,
				strikes: 0,
				failedStarts: 0,
			});
			installed = version;
			storage.writeInstalled(version);
			progress = null;
			phase = "ready";
			publish();
			// Older versions are unusable with this build: drop them now that this one is installed.
			void deps.deleteCaches("otherVersions").catch(() => {});
		} else if (data.type === "ranked") {
			const entry = pending.get(data.id);
			if (!entry) return;
			pending.delete(data.id);
			clearTimeout(entry.timer);
			const valid =
				Array.isArray(data.indices) &&
				data.indices.length <= SHORTLIST &&
				data.indices.every(
					(index) =>
						Number.isInteger(index) && index >= 0 && index < catalog.length,
				);
			if (valid) {
				badInARow = 0;
				entry.resolve(data.indices);
			} else {
				entry.resolve([]);
				countBadResult();
			}
		}
	}

	async function load(next: Mode) {
		const owner = ++generation;
		mode = next;
		phase = "loading";
		progress = null;
		publish();
		storage.writeState({ ...storage.readState(version), loading: true });
		try {
			catalog = await deps.loadCatalog();
		} catch {
			await fail("load", owner);
			return;
		}
		if (owner !== generation) return;
		try {
			const created = deps.createWorker();
			worker = created;
			created.onmessage = (event) => onMessage(event.data, owner);
			created.onerror = () => void fail("runtime", owner);
			created.onmessageerror = () => void fail("runtime", owner);
			armLoadTimer(owner);
			created.postMessage({
				type: "init",
				id: INIT_ID,
				count: catalog.length,
				allowNetwork: next === "download",
				totalBytes: deps.downloadBytes,
			});
		} catch {
			await fail("load", owner);
		}
	}

	/** Loads the stored copy. Never touches the network: the worker answers `uncached` if there is none. */
	function startFromStored(source: "wake" | "warmUp") {
		if (!optedIn || phase !== "idle" || installed !== version) return;
		if (source === "warmUp" && crashedAtStart) return;
		if (!deps.supported()) {
			phase = "unavailable";
			failure = "unsupported";
			publish();
			return;
		}
		if (storage.readState(version).failedStarts >= FAILED_STARTS_TO_STOP) {
			phase = "unavailable";
			failure = "stopped";
			publish();
			return;
		}
		void load("cache");
	}

	function wake() {
		startFromStored("wake");
	}

	function reset() {
		generation++;
		stopWorker();
		clearMarker();
		progress = null;
		failure = null;
		evicted = false;
		countedThisStart = false;
		badInARow = 0;
		phase = "idle";
	}

	return {
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		wake,
		warmUp: () => startFromStored("warmUp"),
		async download() {
			if (phase === "ready" || (phase === "loading" && mode === "download"))
				return;
			reset();
			if (!deps.supported()) {
				phase = "unavailable";
				failure = "unsupported";
				publish();
				return;
			}
			optedIn = true;
			autoOff = null;
			storage.writeOptedIn(true);
			storage.writeAutoOff(null);
			// Strikes stay (crashes are counted until a success); the failed-start count starts over.
			storage.writeState({ ...storage.readState(version), failedStarts: 0 });
			await load("download");
		},
		async remove() {
			reset();
			optedIn = false;
			installed = null;
			autoOff = null;
			storage.writeOptedIn(false);
			storage.writeInstalled(null);
			storage.writeAutoOff(null);
			publish();
			await deps.deleteCaches("all").catch(() => {});
		},
		/** Stops everything and returns to "not started", so a screen that mounts again can wake it. */
		dispose() {
			generation++;
			stopWorker();
			clearMarker();
			listeners.clear();
			phase = "idle";
			progress = null;
			failure = null;
			countedThisStart = false;
			badInARow = 0;
			rebuild();
		},
	};
}
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji`
Expected: PASS — the five new files (66 tests) and the existing emoji tests.

- [ ] **Step 6: Repo checks and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (web 329 + 66 = 395). Nothing renders the controller yet.

```bash
git add apps/web/src/test/emoji.ts apps/web/src/features/emoji/engine.ts apps/web/src/features/emoji/cache.ts apps/web/src/features/emoji/cache.test.ts apps/web/src/features/emoji/support.ts apps/web/src/features/emoji/support.test.ts apps/web/src/features/emoji/engine-storage.ts apps/web/src/features/emoji/engine-storage.test.ts apps/web/src/features/emoji/auto-pick.ts apps/web/src/features/emoji/auto-pick.test.ts apps/web/src/features/emoji/controller.ts apps/web/src/features/emoji/controller.test.ts
git commit -m "feat(web): emoji engine controller with opt-in download and the spec's failure handling"
```

---

### Task 6: Provide the engine to the app, with the background warm-up

**Files:**
- Create: `apps/web/src/features/emoji/browser-deps.ts`, `apps/web/src/features/emoji/EmojiEngineHost.tsx`
- Test: `apps/web/src/features/emoji/EmojiEngineHost.test.tsx`
- Modify: `apps/web/src/session/SessionGate.tsx`, `apps/web/src/test/emoji.ts`

**Interfaces:**
- Consumes: `createEmojiController` and friends (Task 5), `loadCatalog` (Plan 9), `useSession()` (the sync engine's `getStatus`/`subscribe`), `EmojiEngineProvider`, `EMOJI_ASSET_VERSION`, `EMOJI_DOWNLOAD_BYTES`.
- Produces:
  - `browser-deps.ts`: `getBrowserEmojiController(): EmojiController`, one controller for the app start (so React's development double-mounting cannot run the startup bookkeeping twice). It contains the only `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` in the app, which is what makes Vite emit the worker chunk.
  - `EmojiEngineHost.tsx`: `WARM_UP_DELAY_MS = 5_000`, `EmojiSettings { optedIn; status; download: DownloadState; startDownload(); removeDownload() }`, `useEmojiSettings()` (a harmless "nothing downloaded" value outside the host), `<EmojiEngineHost controller?>` which provides `EmojiEngineProvider` (a new engine object whenever the status changes, through `useSyncExternalStore`), the settings, a `WarmUp` child that calls `controller.warmUp()` 5 s after the first successful sync (`state === "idle"` with `lastSyncedAt !== null`) and cancels on unmount, and disposes the controller when it unmounts (sign-out). **`warmUp()` only loads a model that is already stored (Task 5); on a device that has not pressed Download it does nothing, so nothing is ever downloaded from here.**
  - `src/test/emoji.ts` gains `fakeEmojiController(initial?)` returning `{ controller, change }` (`controller.download` and `controller.remove` are mocks).
  - `SessionGate`'s signed-in tree: `ToastProvider > EmojiEngineHost > Outlet`.

- [ ] **Step 1: Extend the test helpers**

In `apps/web/src/test/emoji.ts` replace the first import lines

```ts
import { vi } from "vitest";
import type { WorkerLike } from "../features/emoji/controller";
```

with

```ts
import { type Mock, vi } from "vitest";
import type {
	EmojiController,
	EmojiSnapshot,
	WorkerLike,
} from "../features/emoji/controller";
```

and append at the end of the file:

```ts
/** An EmojiController for host and Me tests: `change()` publishes a new snapshot to subscribers. */
export function fakeEmojiController(initial: Partial<EmojiSnapshot> = {}) {
	let snapshot: EmojiSnapshot = {
		engine: {
			status: "off",
			suggest: async () => [],
			search: async () => [],
		},
		optedIn: false,
		download: { kind: "notDownloaded", note: null },
		...initial,
	};
	const listeners = new Set<() => void>();
	const controller: EmojiController & {
		wake: Mock<() => void>;
		warmUp: Mock<() => void>;
		download: Mock<() => Promise<void>>;
		remove: Mock<() => Promise<void>>;
		dispose: Mock<() => void>;
	} = {
		getSnapshot: () => snapshot,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		wake: vi.fn<() => void>(),
		warmUp: vi.fn<() => void>(),
		download: vi.fn<() => Promise<void>>(async () => {}),
		remove: vi.fn<() => Promise<void>>(async () => {}),
		dispose: vi.fn<() => void>(),
	};
	const change = (
		next: Partial<Omit<EmojiSnapshot, "engine">> & {
			status?: EmojiEngine["status"];
		},
	) => {
		const { status, ...rest } = next;
		snapshot = {
			...snapshot,
			...rest,
			engine: { ...snapshot.engine, status: status ?? snapshot.engine.status },
		};
		for (const listener of listeners) listener();
	};
	return { controller, change };
}
```

- [ ] **Step 2: Write the failing host test**

Create `apps/web/src/features/emoji/EmojiEngineHost.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncStatus } from "../../sync/engine";
import { fakeEmojiController } from "../../test/emoji";
import { fakeEngine, renderWithSession } from "../../test/fakes";
import {
	EmojiEngineHost,
	useEmojiSettings,
	WARM_UP_DELAY_MS,
} from "./EmojiEngineHost";
import { useEmojiEngine } from "./engine";

function Probe() {
	const engine = useEmojiEngine();
	const settings = useEmojiSettings();
	return (
		<p>
			{engine.status} / {settings.optedIn ? "on" : "off"} /{" "}
			{settings.download.kind}
		</p>
	);
}

/** A sync engine whose status the test controls. */
function controlledSync() {
	const base = fakeEngine();
	let status: SyncStatus = { state: "idle", pending: 0, lastSyncedAt: null };
	const listeners = new Set<(s: SyncStatus) => void>();
	return {
		engine: {
			...base,
			getStatus: () => status,
			subscribe: (listener: (s: SyncStatus) => void) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
		set(next: Partial<SyncStatus>) {
			status = { ...status, ...next };
			for (const listener of listeners) listener(status);
		},
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("EmojiEngineHost", () => {
	it("provides the engine and the settings, and follows the controller", () => {
		const { controller, change } = fakeEmojiController();
		renderWithSession(
			<EmojiEngineHost controller={controller}>
				<Probe />
			</EmojiEngineHost>,
		);
		expect(screen.getByText("off / off / notDownloaded")).toBeInTheDocument();
		act(() =>
			change({
				optedIn: true,
				status: "loading",
				download: { kind: "downloading", progress: 0.5 },
			}),
		);
		expect(screen.getByText("loading / on / downloading")).toBeInTheDocument();
		act(() => change({ status: "ready", download: { kind: "ready" } }));
		expect(screen.getByText("ready / on / ready")).toBeInTheDocument();
	});

	it("passes the Download and Remove download buttons through to the controller", () => {
		const { controller } = fakeEmojiController();
		function Buttons() {
			const settings = useEmojiSettings();
			return (
				<>
					<button type="button" onClick={settings.startDownload}>
						start
					</button>
					<button type="button" onClick={settings.removeDownload}>
						remove
					</button>
				</>
			);
		}
		renderWithSession(
			<EmojiEngineHost controller={controller}>
				<Buttons />
			</EmojiEngineHost>,
		);
		fireEvent.click(screen.getByText("start"));
		expect(controller.download).toHaveBeenCalledTimes(1);
		expect(controller.remove).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("remove"));
		expect(controller.remove).toHaveBeenCalledTimes(1);
	});

	it("asks the controller to load the stored copy five seconds after the first successful sync", () => {
		const { controller } = fakeEmojiController();
		const sync = controlledSync();
		renderWithSession(
			<EmojiEngineHost controller={controller}>
				<Probe />
			</EmojiEngineHost>,
			{ engine: sync.engine },
		);
		act(() => sync.set({ state: "syncing" }));
		act(() => sync.set({ state: "offline" }));
		act(() => vi.advanceTimersByTime(WARM_UP_DELAY_MS * 2));
		expect(controller.warmUp).not.toHaveBeenCalled();

		act(() => sync.set({ state: "idle", lastSyncedAt: 1000 }));
		act(() => vi.advanceTimersByTime(WARM_UP_DELAY_MS - 1));
		expect(controller.warmUp).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(1));
		expect(controller.warmUp).toHaveBeenCalledTimes(1);

		// Later syncs do not start it again.
		act(() => sync.set({ state: "idle", lastSyncedAt: 2000 }));
		act(() => vi.advanceTimersByTime(WARM_UP_DELAY_MS));
		expect(controller.warmUp).toHaveBeenCalledTimes(1);
	});

	it("starts the timer at once when a sync has already succeeded", () => {
		const { controller } = fakeEmojiController();
		const sync = controlledSync();
		sync.set({ state: "idle", lastSyncedAt: 5 });
		renderWithSession(
			<EmojiEngineHost controller={controller}>
				<Probe />
			</EmojiEngineHost>,
			{ engine: sync.engine },
		);
		act(() => vi.advanceTimersByTime(WARM_UP_DELAY_MS));
		expect(controller.warmUp).toHaveBeenCalledTimes(1);
	});

	it("does not ask the controller to load if the app goes away first, and disposes the controller", () => {
		const { controller } = fakeEmojiController();
		const sync = controlledSync();
		sync.set({ state: "idle", lastSyncedAt: 5 });
		const { unmount } = renderWithSession(
			<EmojiEngineHost controller={controller}>
				<Probe />
			</EmojiEngineHost>,
			{ engine: sync.engine },
		);
		unmount();
		act(() => vi.advanceTimersByTime(WARM_UP_DELAY_MS * 2));
		expect(controller.warmUp).not.toHaveBeenCalled();
		expect(controller.dispose).toHaveBeenCalled();
	});

	it("falls back to nothing downloaded and an unavailable engine outside the host", () => {
		render(<Probe />);
		expect(
			screen.getByText("unavailable / off / notDownloaded"),
		).toBeInTheDocument();
	});
});
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/EmojiEngineHost.test.tsx`
Expected: FAIL — `Failed to resolve import "./EmojiEngineHost"`.

- [ ] **Step 3: Implement the browser dependencies and the host**

`apps/web/src/features/emoji/browser-deps.ts`:

```ts
import { EMOJI_ASSET_VERSION, EMOJI_DOWNLOAD_BYTES } from "./assets";
import { deleteEmojiCache } from "./cache";
import { loadCatalog } from "./catalog";
import {
	createEmojiController,
	type EmojiController,
	type WorkerLike,
} from "./controller";
import { createLocalStorageEngineStorage } from "./engine-storage";
import { detectSupport } from "./support";

let shared: EmojiController | null = null;

/**
 * The app's one emoji controller. It is created on first use and lives for the whole app start,
 * so React's double-mounting in development cannot run its startup bookkeeping twice.
 */
export function getBrowserEmojiController(): EmojiController {
	shared ??= createEmojiController({
		version: EMOJI_ASSET_VERSION,
		downloadBytes: EMOJI_DOWNLOAD_BYTES,
		storage: createLocalStorageEngineStorage(),
		// The `new Worker(new URL(...), { type: "module" })` form is what Vite bundles.
		createWorker: () =>
			new Worker(new URL("./worker.ts", import.meta.url), {
				type: "module",
			}) as unknown as WorkerLike,
		loadCatalog,
		supported: () => detectSupport(),
		deleteCaches: (scope) => deleteEmojiCache(scope, EMOJI_ASSET_VERSION),
	});
	return shared;
}
```

`apps/web/src/features/emoji/EmojiEngineHost.tsx` (Task 9 adds the late-pick runner to it):

```tsx
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "react";
import { useSession } from "../../session/session";
import { getBrowserEmojiController } from "./browser-deps";
import type { DownloadState, EmojiController } from "./controller";
import { EmojiEngineProvider, type EmojiEngineStatus } from "./engine";

/** The first download starts this long after the first successful sync, so it never competes with it. */
export const WARM_UP_DELAY_MS = 5_000;

/** What the Me screen shows and changes. */
export interface EmojiSettings {
	/** The person pressed Download on this device and has not removed it. */
	optedIn: boolean;
	status: EmojiEngineStatus;
	download: DownloadState;
	/** The Download, Update and Try again buttons: the only way anything is downloaded. */
	startDownload(): void;
	/** The Cancel and Remove download buttons. */
	removeDownload(): void;
}

const noSettings: EmojiSettings = {
	optedIn: false,
	status: "off",
	download: { kind: "notDownloaded", note: null },
	startDownload: () => {},
	removeDownload: () => {},
};
const SettingsContext = createContext<EmojiSettings>(noSettings);

export const useEmojiSettings = (): EmojiSettings =>
	useContext(SettingsContext);

/**
 * After the first successful sync, waits a moment and loads the model that is already stored on
 * this device, if the person downloaded it. The controller makes this a no-op for every other
 * device, so nothing is ever downloaded from here.
 */
function WarmUp({ controller }: { controller: EmojiController }) {
	const { engine } = useSession();
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const check = (status: { state: string; lastSyncedAt: number | null }) => {
			if (timer !== undefined) return;
			if (status.state !== "idle" || status.lastSyncedAt === null) return;
			timer = setTimeout(() => controller.warmUp(), WARM_UP_DELAY_MS);
		};
		check(engine.getStatus());
		const stop = engine.subscribe(check);
		return () => {
			stop();
			clearTimeout(timer);
		};
	}, [engine, controller]);
	return null;
}

/**
 * Provides the emoji engine and the Me settings to the signed-in app, starts the background
 * warm-up, and stops the worker when the app signs out. Needs the session (it watches the sync engine).
 */
export function EmojiEngineHost({
	controller: provided,
	children,
}: {
	controller?: EmojiController;
	children: ReactNode;
}) {
	const controller = useMemo(
		() => provided ?? getBrowserEmojiController(),
		[provided],
	);
	const snapshot = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
	);
	useEffect(() => () => controller.dispose(), [controller]);
	const settings = useMemo<EmojiSettings>(
		() => ({
			optedIn: snapshot.optedIn,
			status: snapshot.engine.status,
			download: snapshot.download,
			startDownload: () => void controller.download(),
			removeDownload: () => void controller.remove(),
		}),
		[snapshot, controller],
	);
	return (
		<EmojiEngineProvider value={snapshot.engine}>
			<SettingsContext.Provider value={settings}>
				<WarmUp controller={controller} />
				{children}
			</SettingsContext.Provider>
		</EmojiEngineProvider>
	);
}
```

In `apps/web/src/session/SessionGate.tsx` add the import (with the other relative imports)

```ts
import { EmojiEngineHost } from "../features/emoji/EmojiEngineHost";
```

and replace

```tsx
			<ToastProvider>
				<Outlet />
			</ToastProvider>
```

with

```tsx
			<ToastProvider>
				<EmojiEngineHost>
					<Outlet />
				</EmojiEngineHost>
			</ToastProvider>
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/EmojiEngineHost.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 4: Check the production build picks the worker up**

Run: `pnpm --filter @tagteam/web exec vite build`
Expected: `dist/assets` now has `worker-….js` (about 540 kB), `bits-….bin` and `int8-….bin`, and **no** `.wasm` file next to them; the output ends `15 precache entries` (it was 12): the worker and the two index files are precached, the 49 MB of model files are not (`grep -c onnx apps/web/dist/sw.js` prints `0`). If `apps/web/public/assets/emoji/` exists, `apps/web/dist/assets/emoji/<version>/` holds the model files.

- [ ] **Step 5: Repo checks and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (web 395 + 6 = 401). Existing tests are unaffected: in jsdom nobody has pressed Download, so the real controller never starts a worker.

```bash
git add apps/web/src/test/emoji.ts apps/web/src/features/emoji/browser-deps.ts apps/web/src/features/emoji/EmojiEngineHost.tsx apps/web/src/features/emoji/EmojiEngineHost.test.tsx apps/web/src/session/SessionGate.tsx
git commit -m "feat(web): provide the emoji engine and Me settings to the app"
```

---

### Task 7: The "Emoji suggestions" section on Me (Download, Remove download)

**Files:**
- Create: `apps/web/src/features/me/EmojiSuggestionsSettings.tsx`
- Test: `apps/web/src/features/me/EmojiSuggestionsSettings.test.tsx`
- Modify: `apps/web/src/features/me/MeScreen.tsx`

**Interfaces:**
- Consumes: `useEmojiSettings()` and `EmojiEngineHost` (Task 6), `DownloadState`/`FailureReason` (Task 5), `fakeEmojiController` (Task 6), the shared `Button` (`min-h-11`), the shadcn `Card` and `Progress`.
- Produces: the only place emoji suggestions are switched on or off, and **the only place an update or a failure is shown** (owner decision: no toast, badge, banner or dot elsewhere). A section headed "Emoji suggestions" with the helper "Suggests an emoji while you type a task name. Needs a one-time download of about 49 MB and works offline afterwards. Wi-Fi is best.", one `role="status"` line (announces every change), an optional detail line, a `Progress` bar (only while downloading, named "Download progress", indeterminate before the first byte) and one button of at least 44 px. There is no switch.

  | `download.kind` | Status line | Detail | Button |
  |---|---|---|---|
  | `notDownloaded` (default) | "Emoji suggestions are off." | after two crashes: "They were switched off because this device ran out of memory while loading them. You can download them again to retry."; after an eviction: "The browser removed the download to free space. You can download it again." | **Download** |
  | `updateAvailable` | "An update is available." | "Suggestions are paused until you download it. It is about 49 MB, so Wi-Fi is best." | **Download** |
  | `downloading` | "Downloading…" or "Downloading… 43%" | | **Cancel** |
  | `loading` | "Getting emoji suggestions ready…" | | **Remove download** |
  | `ready` | "Emoji suggestions are on" | "They work offline." | **Remove download** |
  | `failed` offline | "Couldn't download. You're offline. Connect and try again." | | **Try again** |
  | `failed` storage | "Couldn't download. This device is out of storage." | | **Try again** |
  | `failed` load | "Couldn't load emoji suggestions." | | **Try again** |
  | `failed` stopped | "Emoji suggestions stopped after repeated problems." | | **Try again** |
  | `failed` unsupported | "This browser can't run emoji suggestions." | | none |

  Download, Update and Try again call `controller.download()` (the opt-in: the only call that downloads anything); Cancel and Remove download call `controller.remove()` (stop, delete every stored version, back to the default).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/me/EmojiSuggestionsSettings.test.tsx`:

```tsx
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeEmojiController } from "../../test/emoji";
import { renderWithSession } from "../../test/fakes";
import type { EmojiSnapshot } from "../emoji/controller";
import { EmojiEngineHost } from "../emoji/EmojiEngineHost";
import { EmojiSuggestionsSettings } from "./EmojiSuggestionsSettings";

function setup(initial: Partial<EmojiSnapshot> = {}) {
	const { controller, change } = fakeEmojiController(initial);
	renderWithSession(
		<EmojiEngineHost controller={controller}>
			<EmojiSuggestionsSettings />
		</EmojiEngineHost>,
	);
	return { controller, change };
}
const status = () => screen.getByRole("status");
const button = (name: string) => screen.getByRole("button", { name });

describe("EmojiSuggestionsSettings", () => {
	it("by default says they are off, explains the 49 MB download, and offers Download", () => {
		setup();
		expect(
			screen.getByRole("heading", { name: "Emoji suggestions" }),
		).toBeInTheDocument();
		expect(
			screen.getByText(
				"Suggests an emoji while you type a task name. Needs a one-time download of about 49 MB and works offline afterwards. Wi-Fi is best.",
			),
		).toBeInTheDocument();
		expect(status()).toHaveTextContent("Emoji suggestions are off.");
		expect(button("Download")).toBeInTheDocument();
		expect(screen.queryByRole("switch")).not.toBeInTheDocument();
	});

	it("starts the download only when Download is pressed", async () => {
		const { controller } = setup();
		expect(controller.download).not.toHaveBeenCalled();
		await userEvent.click(button("Download"));
		expect(controller.download).toHaveBeenCalledTimes(1);
	});

	it("shows progress in words and as a bar while downloading, with a Cancel button", async () => {
		const { controller, change } = setup({ optedIn: true });
		act(() => change({ download: { kind: "downloading", progress: null } }));
		expect(status()).toHaveTextContent("Downloading…");
		expect(
			screen.getByRole("progressbar", { name: "Download progress" }),
		).toBeInTheDocument();
		act(() => change({ download: { kind: "downloading", progress: 0.426 } }));
		expect(status()).toHaveTextContent("Downloading… 43%");
		expect(screen.getByRole("progressbar")).toHaveAttribute(
			"aria-valuenow",
			"43",
		);
		await userEvent.click(button("Cancel"));
		expect(controller.remove).toHaveBeenCalledTimes(1);
	});

	it("says they are on once downloaded, and Remove download takes them away", async () => {
		const { controller } = setup({
			optedIn: true,
			download: { kind: "ready" },
		});
		expect(status()).toHaveTextContent("Emoji suggestions are on");
		expect(screen.getByText("They work offline.")).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Download" }),
		).not.toBeInTheDocument();
		await userEvent.click(button("Remove download"));
		expect(controller.remove).toHaveBeenCalledTimes(1);
	});

	it("announces each change in the same status line", () => {
		const { change } = setup();
		const line = status();
		act(() => change({ download: { kind: "loading" } }));
		expect(line).toHaveTextContent("Getting emoji suggestions ready…");
		expect(screen.getByRole("status")).toBe(line);
		act(() => change({ download: { kind: "ready" } }));
		expect(line).toHaveTextContent("Emoji suggestions are on");
	});

	it("explains a failure in one plain sentence and offers Try again", async () => {
		const { controller, change } = setup({ optedIn: true });
		const reasons = [
			["offline", "Couldn't download. You're offline. Connect and try again."],
			["storage", "Couldn't download. This device is out of storage."],
			["load", "Couldn't load emoji suggestions."],
			["stopped", "Emoji suggestions stopped after repeated problems."],
		] as const;
		for (const [reason, sentence] of reasons) {
			act(() => change({ download: { kind: "failed", reason } }));
			expect(status(), reason).toHaveTextContent(sentence);
		}
		await userEvent.click(button("Try again"));
		expect(controller.download).toHaveBeenCalledTimes(1);
	});

	it("says an unsupported browser cannot run them, with nothing to press", () => {
		setup({ download: { kind: "failed", reason: "unsupported" } });
		expect(status()).toHaveTextContent(
			"This browser can't run emoji suggestions.",
		);
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("shows an update only here: Download, with the old copy described as paused", async () => {
		const { controller } = setup({
			optedIn: true,
			download: { kind: "updateAvailable" },
		});
		expect(status()).toHaveTextContent("An update is available.");
		expect(
			screen.getByText(
				"Suggestions are paused until you download it. It is about 49 MB, so Wi-Fi is best.",
			),
		).toBeInTheDocument();
		await userEvent.click(button("Download"));
		expect(controller.download).toHaveBeenCalledTimes(1);
	});

	it("explains a switch-off the person did not ask for, and offers Download again", () => {
		const { change } = setup();
		act(() => change({ download: { kind: "notDownloaded", note: "crash" } }));
		expect(
			screen.getByText(
				"They were switched off because this device ran out of memory while loading them. You can download them again to retry.",
			),
		).toBeInTheDocument();
		expect(button("Download")).toBeInTheDocument();
		act(() => change({ download: { kind: "notDownloaded", note: "evicted" } }));
		expect(
			screen.getByText(
				"The browser removed the download to free space. You can download it again.",
			),
		).toBeInTheDocument();
	});

	it("has buttons at least 44 px tall", () => {
		setup();
		expect(button("Download")).toHaveClass("min-h-11");
	});
});
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/me/EmojiSuggestionsSettings.test.tsx`
Expected: FAIL — `Failed to resolve import "./EmojiSuggestionsSettings"`.

- [ ] **Step 2: Implement the section and place it on Me**

`apps/web/src/features/me/EmojiSuggestionsSettings.tsx`:

```tsx
import { useId } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "../../ui/Button";
import type { FailureReason } from "../emoji/controller";
import { useEmojiSettings } from "../emoji/EmojiEngineHost";

const HELPER =
	"Suggests an emoji while you type a task name. Needs a one-time download of about 49 MB and works offline afterwards. Wi-Fi is best.";

const FAILURES: Record<FailureReason, string> = {
	offline: "Couldn't download. You're offline. Connect and try again.",
	storage: "Couldn't download. This device is out of storage.",
	load: "Couldn't load emoji suggestions.",
	stopped: "Emoji suggestions stopped after repeated problems.",
	unsupported: "This browser can't run emoji suggestions.",
};

/**
 * The only place emoji suggestions are switched on or off, and the only place an update or a
 * failure is shown. Nothing downloads until the person presses Download.
 */
export function EmojiSuggestionsSettings() {
	const { download, startDownload, removeDownload } = useEmojiSettings();
	const id = useId();

	let status: string;
	let detail: string | null = null;
	let action: { label: string; run: () => void; variant?: "primary" } | null =
		null;
	let progress: number | null | undefined;

	switch (download.kind) {
		case "notDownloaded":
			status = "Emoji suggestions are off.";
			detail =
				download.note === "crash"
					? "They were switched off because this device ran out of memory while loading them. You can download them again to retry."
					: download.note === "evicted"
						? "The browser removed the download to free space. You can download it again."
						: null;
			action = { label: "Download", run: startDownload, variant: "primary" };
			break;
		case "updateAvailable":
			status = "An update is available.";
			detail =
				"Suggestions are paused until you download it. It is about 49 MB, so Wi-Fi is best.";
			action = { label: "Download", run: startDownload, variant: "primary" };
			break;
		case "downloading":
			progress = download.progress;
			status =
				download.progress === null
					? "Downloading…"
					: `Downloading… ${Math.round(download.progress * 100)}%`;
			action = { label: "Cancel", run: removeDownload };
			break;
		case "loading":
			status = "Getting emoji suggestions ready…";
			action = { label: "Remove download", run: removeDownload };
			break;
		case "ready":
			status = "Emoji suggestions are on";
			detail = "They work offline.";
			action = { label: "Remove download", run: removeDownload };
			break;
		case "failed":
			status = FAILURES[download.reason];
			action =
				download.reason === "unsupported"
					? null
					: { label: "Try again", run: startDownload, variant: "primary" };
			break;
	}

	return (
		<section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
			<div>
				<h2 id={`${id}-heading`} className="text-[15px] font-semibold">
					Emoji suggestions
				</h2>
				<p className="mt-1 text-[13px] text-text-2">{HELPER}</p>
			</div>
			<Card className="gap-3 rounded-2xl p-4 ring-line">
				<CardContent className="flex flex-col gap-3 p-0">
					<p role="status" className="text-[14px] font-medium">
						{status}
					</p>
					{detail ? <p className="text-[13px] text-text-2">{detail}</p> : null}
					{progress !== undefined ? (
						<Progress
							aria-label="Download progress"
							value={progress === null ? null : Math.round(progress * 100)}
						/>
					) : null}
					{action ? (
						<Button
							variant={action.variant ?? "secondary"}
							block
							onClick={action.run}
						>
							{action.label}
						</Button>
					) : null}
				</CardContent>
			</Card>
		</section>
	);
}
```

In `apps/web/src/features/me/MeScreen.tsx` add the import after the `GroupSwitcher` import:

```ts
import { EmojiSuggestionsSettings } from "./EmojiSuggestionsSettings";
```

and render it directly after `<NotificationSettings />`:

```tsx
			<NotificationSettings />
			<EmojiSuggestionsSettings />
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/me`
Expected: PASS (the new 10 tests and the existing Me tests; outside the host the section shows "Emoji suggestions are off." with a Download button that does nothing).

- [ ] **Step 3: Repo checks and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (web 401 + 10 = 411).

```bash
git add apps/web/src/features/me/EmojiSuggestionsSettings.tsx apps/web/src/features/me/EmojiSuggestionsSettings.test.tsx apps/web/src/features/me/MeScreen.tsx
git commit -m "feat(web): Me section to download and remove emoji suggestions"
```

---

### Task 8: Automatic emoji in the New task sheet

**Files:**
- Create: `apps/web/src/features/add-task/useAutoEmoji.ts`
- Test: `apps/web/src/features/add-task/AddTaskSheet.auto-emoji.test.tsx`, `apps/web/src/features/add-task/draft.emoji.test.ts`
- Modify: `apps/web/src/features/add-task/AddTaskSheet.tsx`, `apps/web/src/features/add-task/draft.ts`

**Interfaces:**
- Consumes: `useEmojiEngine()` and `EmojiEngine.suggest(title, { autoPick: true })` / `wake?()` (Tasks 5–6), `draft.emojiChosen` (Plan 9: set when the person picks, types, or uses "Use default"; `taskDraft` sets it for a stored emoji), core `isEmoji`, `fakeEmojiEngine` (Task 5).
- Produces:
  - `useAutoEmoji({ active, title, onSuggest(emoji, forTitle) })`, `AUTO_EMOJI_DEBOUNCE_MS = 300`, `AUTO_EMOJI_MIN_TITLE = 3`. Asks the engine only while `active`, the engine is `ready` and the trimmed title has 3+ characters, 300 ms after the title stops changing; a result for an older title, or after `active` turned false, is dropped; a rejection or an empty answer is ignored; the answer must pass `isEmoji`.
  - In `AddTaskSheet`: `active = open && !task && !draft.emojiChosen`; a stale result is also dropped inside the state update (`d.emojiChosen || d.title.trim() !== forTitle`); a New task sheet calls `emoji.wake?.()` when it opens (never for Edit; it only loads a stored copy, so on a device that has not downloaded the model it does nothing and the sheet behaves exactly as in Plan 9: engine status `off`, so the hook never asks); the automatic fill sets `draft.emoji` only: `emojiChosen` stays false and `color` is never touched; submitting never waits for the engine.
  - `draft.ts`: an emoji that fails `isEmoji` is left out of `draftMutation`, `suggestionMutation` and `taskUpdateMutation`, so the task still saves.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/add-task/AddTaskSheet.auto-emoji.test.tsx`:

```tsx
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fakeEmojiEngine } from "../../test/emoji";
import { fakeEngine, fakeTask, renderWithSession } from "../../test/fakes";
import { type EmojiEngine, EmojiEngineProvider } from "../emoji/engine";
import { AddTaskSheet } from "./AddTaskSheet";
import { AUTO_EMOJI_DEBOUNCE_MS } from "./useAutoEmoji";

const PLANT = "\u{1FAB4}"; // potted plant
const DOG = "\u{1F415}"; // dog
const LONG_WAIT = AUTO_EMOJI_DEBOUNCE_MS * 2;

function setup(
	emoji: EmojiEngine,
	props: Partial<Parameters<typeof AddTaskSheet>[0]> = {},
) {
	const sync = fakeEngine();
	renderWithSession(
		<EmojiEngineProvider value={emoji}>
			<AddTaskSheet open onClose={vi.fn()} {...props} />
		</EmojiEngineProvider>,
		{ engine: sync },
	);
	return { sync };
}
const emojiButton = (name: string | RegExp) =>
	screen.getByRole("button", { name });
const title = () => screen.getByLabelText("Task");
const pause = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("automatic emoji in the New task sheet", () => {
	it("fills the emoji 300 ms after the title stops changing", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine);
		await userEvent.type(title(), "Water the plants");
		expect(engine.suggest).not.toHaveBeenCalled();
		expect(
			emojiButton("Emoji: clipboard, default, change"),
		).toBeInTheDocument();
		await waitFor(() =>
			expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument(),
		);
		expect(engine.suggest).toHaveBeenCalledTimes(1);
		expect(engine.suggest).toHaveBeenCalledWith("Water the plants", {
			autoPick: true,
		});
	});

	it("asks only once for a title typed in a burst", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine);
		await userEvent.type(title(), "Water the plants", { delay: 20 });
		await pause(LONG_WAIT);
		expect(engine.suggest).toHaveBeenCalledTimes(1);
	});

	it("does not ask for a title shorter than three characters", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine);
		await userEvent.type(title(), "ab");
		await pause(LONG_WAIT);
		expect(engine.suggest).not.toHaveBeenCalled();
	});

	it("does not ask while the engine is not ready", async () => {
		for (const status of ["loading", "unavailable", "off"] as const) {
			const engine = fakeEmojiEngine({
				status,
				suggest: vi.fn(async () => [PLANT]),
			});
			const view = renderWithSession(
				<EmojiEngineProvider value={engine}>
					<AddTaskSheet open onClose={vi.fn()} />
				</EmojiEngineProvider>,
			);
			await userEvent.type(screen.getByLabelText("Task"), "Water the plants");
			await pause(LONG_WAIT);
			expect(engine.suggest).not.toHaveBeenCalled();
			view.unmount();
		}
	});

	it("starts suggesting when the engine becomes ready after the title was typed", async () => {
		const suggest = vi.fn(async () => [PLANT]);
		let makeReady: () => void = () => {};
		function Harness() {
			const [status, setStatus] = useState<EmojiEngine["status"]>("loading");
			makeReady = () => setStatus("ready");
			const engine = useMemo<EmojiEngine>(
				() => ({ status, suggest, search: async () => [] }),
				[status],
			);
			return (
				<EmojiEngineProvider value={engine}>
					<AddTaskSheet open onClose={vi.fn()} />
				</EmojiEngineProvider>
			);
		}
		renderWithSession(<Harness />);
		await userEvent.type(title(), "Water the plants");
		await pause(LONG_WAIT);
		expect(suggest).not.toHaveBeenCalled();
		act(() => makeReady());
		await waitFor(() =>
			expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument(),
		);
	});

	it("drops the result for a title that has since changed", async () => {
		let release: (emoji: string[]) => void = () => {};
		const first = new Promise<string[]>((resolve) => {
			release = resolve;
		});
		const suggest = vi
			.fn<EmojiEngine["suggest"]>()
			.mockImplementationOnce(async () => first)
			.mockImplementation(async () => [DOG]);
		setup(fakeEmojiEngine({ suggest }));
		await userEvent.type(title(), "Water the plants");
		await waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));
		await userEvent.clear(title());
		await userEvent.type(title(), "Walk the dog");
		await waitFor(() =>
			expect(emojiButton("Emoji: dog, change")).toBeInTheDocument(),
		);
		await act(async () => release([PLANT]));
		expect(emojiButton("Emoji: dog, change")).toBeInTheDocument();
	});

	it("never overwrites an emoji the person typed or picked", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine);
		await userEvent.click(emojiButton(/^Emoji:/));
		await userEvent.type(
			await screen.findByLabelText("Type or paste an emoji"),
			DOG,
		);
		await waitFor(() =>
			expect(emojiButton("Emoji: dog, change")).toBeInTheDocument(),
		);
		await userEvent.type(title(), "Water the plants");
		await pause(LONG_WAIT);
		expect(engine.suggest).not.toHaveBeenCalledWith("Water the plants", {
			autoPick: true,
		});
		expect(emojiButton("Emoji: dog, change")).toBeInTheDocument();
	});

	it("stops following the title once the person picks, even after an automatic fill", async () => {
		const suggest = vi
			.fn<EmojiEngine["suggest"]>()
			.mockImplementation(async (text) =>
				text.startsWith("Walk") ? [DOG] : [PLANT],
			);
		setup(fakeEmojiEngine({ suggest }));
		await userEvent.type(title(), "Water the plants");
		await waitFor(() =>
			expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument(),
		);
		await userEvent.click(emojiButton(/^Emoji:/));
		await userEvent.click(
			await screen.findByRole("button", { name: "Use default" }),
		);
		await waitFor(() =>
			expect(emojiButton("Emoji: clipboard, change")).toBeInTheDocument(),
		);
		await userEvent.clear(title());
		await userEvent.type(title(), "Walk the dog");
		await pause(LONG_WAIT);
		expect(emojiButton("Emoji: clipboard, change")).toBeInTheDocument();
	});

	it("never changes the colour, and creates the task with the filled emoji and the chosen colour", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		const { sync } = setup(engine);
		await userEvent.click(screen.getByRole("radio", { name: "Teal" }));
		await userEvent.type(title(), "Water the plants");
		await waitFor(() =>
			expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument(),
		);
		expect(screen.getByRole("dialog", { name: "New task" })).toHaveAttribute(
			"data-task-color",
			"teal",
		);
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({
			type: "task.create",
			title: "Water the plants",
			emoji: PLANT,
			color: "teal",
		});
	});

	it("creates the task at once, with no stored emoji, when no suggestion has arrived", async () => {
		const engine = fakeEmojiEngine({
			suggest: vi.fn(() => new Promise<string[]>(() => {})),
		});
		const { sync } = setup(engine);
		await userEvent.type(title(), "Water the plants");
		await waitFor(() => expect(engine.suggest).toHaveBeenCalled());
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).not.toHaveProperty("emoji");
	});

	it("ignores a suggestion that is not a valid emoji, and the task still saves", async () => {
		const engine = fakeEmojiEngine({
			suggest: vi.fn(async () => ["not an emoji"]),
		});
		const { sync } = setup(engine);
		await userEvent.type(title(), "Water the plants");
		await waitFor(() => expect(engine.suggest).toHaveBeenCalled());
		await pause(50);
		expect(
			emojiButton("Emoji: clipboard, default, change"),
		).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).not.toHaveProperty("emoji");
	});

	it("survives an engine that rejects", async () => {
		const engine = fakeEmojiEngine({
			suggest: vi.fn(async () => Promise.reject(new Error("worker gone"))),
		});
		const { sync } = setup(engine);
		await userEvent.type(title(), "Water the plants");
		await waitFor(() => expect(engine.suggest).toHaveBeenCalled());
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
	});

	it("never fills the emoji when editing, whatever the task's age", async () => {
		const engine = fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) });
		setup(engine, { task: fakeTask({ emoji: null }) });
		await userEvent.clear(title());
		await userEvent.type(title(), "Water the plants");
		await pause(LONG_WAIT);
		expect(engine.suggest).not.toHaveBeenCalled();
		expect(
			emojiButton("Emoji: clipboard, default, change"),
		).toBeInTheDocument();
	});

	it("wakes the engine when a New task sheet opens, but not for Edit or a closed sheet", async () => {
		const creating = fakeEmojiEngine();
		setup(creating);
		expect(creating.wake).toHaveBeenCalled();

		const editing = fakeEmojiEngine();
		setup(editing, { task: fakeTask() });
		expect(editing.wake).not.toHaveBeenCalled();

		const closed = fakeEmojiEngine();
		setup(closed, { open: false });
		expect(closed.wake).not.toHaveBeenCalled();
	});
});
```

Create `apps/web/src/features/add-task/draft.emoji.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeTask } from "../../test/fakes";
import {
	draftMutation,
	newDraft,
	suggestionMutation,
	taskDraft,
	taskUpdateMutation,
} from "./draft";

const PLANT = "\u{1FAB4}";
const base = { ...newDraft("2026-09-23"), title: "Water plants" };
const ctx = { groupId: "g1", timezone: "UTC", at: 5 };

describe("an emoji that fails validation", () => {
	it("is left out of a new task, which is still created", () => {
		for (const bad of ["abc", "\u{1FAB4}\u{1FAB4}", "", " "]) {
			const m = draftMutation({ ...base, emoji: bad }, ctx);
			expect(m, JSON.stringify(bad)).toMatchObject({
				type: "task.create",
				title: "Water plants",
			});
			expect(m).not.toHaveProperty("emoji");
		}
	});

	it("is left out of a suggestion", () => {
		const m = suggestionMutation(
			{ ...base, emoji: "abc", forUserId: "u2" },
			{ groupId: "g1", toUserId: "u2", at: 5 },
		);
		expect(m).toMatchObject({ type: "suggestion.create" });
		expect(m).not.toHaveProperty("emoji");
	});

	it("is not sent in an edit, and an otherwise unchanged edit sends nothing", () => {
		const task = fakeTask({ emoji: null, color: "teal" });
		const draft = { ...taskDraft(task, "2026-09-23"), emoji: "abc" };
		expect(taskUpdateMutation(draft, task, 9)).toBeNull();
		const retitled = { ...draft, title: "Water the plants" };
		expect(taskUpdateMutation(retitled, task, 9)).toMatchObject({
			title: "Water the plants",
		});
		expect(taskUpdateMutation(retitled, task, 9)).not.toHaveProperty("emoji");
	});

	it("is sent when it is valid, whether or not the person chose it", () => {
		expect(
			draftMutation({ ...base, emoji: PLANT, emojiChosen: false }, ctx),
		).toMatchObject({ emoji: PLANT });
	});
});
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/add-task/AddTaskSheet.auto-emoji.test.tsx src/features/add-task/draft.emoji.test.ts`
Expected: FAIL — the sheet test cannot resolve `./useAutoEmoji`; in `draft.emoji.test.ts` the "left out" tests fail (`expected … not to have property "emoji"`).

- [ ] **Step 2: Validate emoji in the draft mutations**

In `apps/web/src/features/add-task/draft.ts` add `isEmoji,` to the `@tagteam/core` import (before `isTimeOfDay,`), change the `emojiChosen` doc comment to `/** True once the person picked or typed an emoji by hand. The automatic pick never overwrites those. */`, and replace

```ts
/** The look fields a create or suggestion carries: only the ones that are set. */
const lookFields = (d: TaskDraft) => ({
	...(d.emoji !== null ? { emoji: d.emoji } : {}),
```

with

```ts
/**
 * The look fields a create or suggestion carries: only the ones that are set. An emoji that
 * fails core validation is left out, so a bad suggestion can never stop a task from saving.
 */
const lookFields = (d: TaskDraft) => ({
	...(d.emoji !== null && isEmoji(d.emoji) ? { emoji: d.emoji } : {}),
```

and in `taskUpdateMutation` replace

```ts
	if (d.emoji !== null && d.emoji !== (task.emoji ?? null))
		changes.emoji = d.emoji;
```

with

```ts
	if (d.emoji !== null && isEmoji(d.emoji) && d.emoji !== (task.emoji ?? null))
		changes.emoji = d.emoji;
```

- [ ] **Step 3: The hook**

Create `apps/web/src/features/add-task/useAutoEmoji.ts`:

```ts
import { isEmoji } from "@tagteam/core";
import { useEffect } from "react";
import { useEmojiEngine } from "../emoji/engine";

/** The title must stop changing for this long before the engine is asked. */
export const AUTO_EMOJI_DEBOUNCE_MS = 300;
export const AUTO_EMOJI_MIN_TITLE = 3;

/**
 * Fills the sheet's emoji from the title while `active`. `onSuggest(emoji, forTitle)` is called
 * with the engine's top automatic pick for `forTitle`, 300 ms after the title stops changing, only
 * when the engine is ready and the title has at least three characters. A result for a title that
 * has since changed, or after `active` turned false, is dropped. `onSuggest` must be stable.
 */
export function useAutoEmoji({
	active,
	title,
	onSuggest,
}: {
	active: boolean;
	title: string;
	onSuggest: (emoji: string, forTitle: string) => void;
}) {
	const engine = useEmojiEngine();
	const clean = title.trim();
	const ready = engine.status === "ready";
	useEffect(() => {
		if (!active || !ready || clean.length < AUTO_EMOJI_MIN_TITLE) return;
		let current = true;
		const timer = setTimeout(() => {
			engine
				.suggest(clean, { autoPick: true })
				.then((list) => {
					const first = list[0];
					if (current && first !== undefined && isEmoji(first))
						onSuggest(first, clean);
				})
				.catch(() => {});
		}, AUTO_EMOJI_DEBOUNCE_MS);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [active, ready, engine, clean, onSuggest]);
}
```

- [ ] **Step 4: Wire it into the sheet**

In `apps/web/src/features/add-task/AddTaskSheet.tsx`:

1. Add `useCallback,` to the `react` import list (between `type ReactNode,` and `useEffect,`).
2. Add `import { useEmojiEngine } from "../emoji/engine";` after the `EmojiPicker` import, and `import { useAutoEmoji } from "./useAutoEmoji";` after the `./draft` import block.
3. Directly after the `const update = (patch: Partial<TaskDraft>) => setDraft(…)` definition insert:

```tsx
	// A new task's emoji follows its title until the person picks one. Editing never fills it.
	const emojiEngine = useEmojiEngine();
	const wakeEmoji = emojiEngine.wake;
	useEffect(() => {
		if (open && !task) wakeEmoji?.();
	}, [open, task, wakeEmoji]);
	const fillEmoji = useCallback(
		(emoji: string, forTitle: string) =>
			setDraft((d) =>
				d.emojiChosen || d.title.trim() !== forTitle ? d : { ...d, emoji },
			),
		[],
	);
	useAutoEmoji({
		active: open && !task && !draft.emojiChosen,
		title: draft.title,
		onSuggest: fillEmoji,
	});
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/add-task`
Expected: PASS — the 14 new sheet tests, the 4 new draft tests and every existing sheet and draft test (the existing sheet suite renders with the default unavailable engine, so nothing fills there).

- [ ] **Step 5: Repo checks and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (web 411 + 18 = 429).

```bash
git add apps/web/src/features/add-task
git commit -m "feat(web): fill a new task's emoji from its title while the person has not picked one"
```

---

### Task 9: The awaiting-emoji list and late picks

**Files:**
- Create: `apps/web/src/features/emoji/awaiting.ts`, `apps/web/src/features/emoji/late-pick.ts`, `apps/web/src/features/emoji/LatePicks.tsx`
- Test: `apps/web/src/features/emoji/awaiting.test.ts`, `late-pick.test.ts`, `LatePicks.test.tsx`, `apps/web/src/features/today/TodayScreen.accept-emoji.test.tsx`; append to `apps/web/src/features/add-task/AddTaskSheet.auto-emoji.test.tsx`
- Modify: `apps/web/src/store/db.ts`, `apps/web/src/features/emoji/EmojiEngineHost.tsx`, `apps/web/src/features/add-task/AddTaskSheet.tsx`, `apps/web/src/features/today/TodayScreen.tsx`

**Interfaces:**
- Consumes: spec §6 "Late pick"; `SyncEngine.enqueue`/`getStatus`/`subscribe`; the Dexie `meta` table (`getMeta`/`setMeta`); `useEmojiEngine()`; `EmojiEngine.suggest(title, { autoPick: true })`; the server's `task.update` (writes only the task row: no event, so no activity entry and no push).
- Produces:
  - `MetaKey` gains `"awaitingEmoji"`. `awaiting.ts`: `listAwaitingEmoji(store): Promise<string[]>`, `addAwaitingEmoji(store, taskId)`, `removeAwaitingEmoji(store, taskId)` (transactional, no repeats, tolerant of damaged data).
  - `late-pick.ts`: `runLatePicks({ store, sync, userId, getEngine, now? }): Promise<number>`. Loop: take the first listed id; stop (keeping the rest) when `getEngine().status !== "ready"`; read the task; remove the id (one attempt); skip when the task is missing, owned by someone else, archived or already has an emoji; ask for one automatic suggestion; skip when it is empty or not `isEmoji`; re-read the task (it may have gained an emoji meanwhile); enqueue one `{ id, at: now(), type: "task.update", taskId, emoji }` (no `color`, no `title`); a thrown error leaves the task with the default and the loop moves on.
  - `LatePicks` (renders nothing): runs `runLatePicks` when the engine is ready, a sync has succeeded since the app started, and the list is not empty; it also runs for ids listed while the engine is already ready.
  - The New task sheet lists the id of a task it creates, and `TodayScreen` lists the id of a task created by accepting a suggestion, when the task has no stored emoji and `engine.status !== "off"` (`off` is every device that has not downloaded the model, so tasks created before the person opts in are never listed, and so never late-picked; tasks created while the model downloads or loads, or while an update is pending, are listed); the write is `void …catch(() => {})` so submitting never waits and a failure never surfaces.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/emoji/awaiting.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { setMeta, TagTeamDb } from "../../store/db";
import {
	addAwaitingEmoji,
	listAwaitingEmoji,
	removeAwaitingEmoji,
} from "./awaiting";

let store: TagTeamDb;
beforeEach(() => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
});

describe("the awaiting-emoji list", () => {
	it("starts empty", async () => {
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("keeps ids in the order they were added, without repeats", async () => {
		await addAwaitingEmoji(store, "a");
		await addAwaitingEmoji(store, "b");
		await addAwaitingEmoji(store, "a");
		expect(await listAwaitingEmoji(store)).toEqual(["a", "b"]);
	});

	it("removes one id and ignores one that is not listed", async () => {
		await addAwaitingEmoji(store, "a");
		await addAwaitingEmoji(store, "b");
		await removeAwaitingEmoji(store, "a");
		await removeAwaitingEmoji(store, "zzz");
		expect(await listAwaitingEmoji(store)).toEqual(["b"]);
	});

	it("does not lose ids added at the same time", async () => {
		await Promise.all(
			["a", "b", "c", "d"].map((id) => addAwaitingEmoji(store, id)),
		);
		expect((await listAwaitingEmoji(store)).sort()).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
	});

	it("ignores damaged data", async () => {
		await setMeta(store, "awaitingEmoji", "not a list");
		expect(await listAwaitingEmoji(store)).toEqual([]);
		await setMeta(store, "awaitingEmoji", ["a", 7, null, "b"]);
		expect(await listAwaitingEmoji(store)).toEqual(["a", "b"]);
	});

	it("is device metadata: sign-out clears it with the rest of the local data", async () => {
		await addAwaitingEmoji(store, "a");
		await store.meta.clear();
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});
});
```

Create `apps/web/src/features/emoji/late-pick.test.ts`:

```ts
import { mutationErrors, type TaskDto } from "@tagteam/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagTeamDb } from "../../store/db";
import { fakeEmojiEngine } from "../../test/emoji";
import { fakeEngine, fakeTask } from "../../test/fakes";
import { addAwaitingEmoji, listAwaitingEmoji } from "./awaiting";
import type { EmojiEngine } from "./engine";
import { runLatePicks } from "./late-pick";

const PLANT = "\u{1FAB4}";
const DOG = "\u{1F415}";
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

let store: TagTeamDb;
beforeEach(() => {
	store = new TagTeamDb(`test-${crypto.randomUUID()}`);
});

async function listed(...tasks: TaskDto[]) {
	for (const task of tasks) {
		await store.tasks.put(task);
		await addAwaitingEmoji(store, task.id);
	}
}
const run = (
	emoji: EmojiEngine,
	sync = fakeEngine(),
	getEngine: () => EmojiEngine = () => emoji,
) =>
	runLatePicks({ store, sync, userId: "u1", getEngine, now: () => 1234 }).then(
		(picked) => ({ picked, sync }),
	);

describe("late picks", () => {
	it("gives each listed task without an emoji one task.update carrying the emoji only", async () => {
		await listed(
			fakeTask({ id: ID1, title: "Water the plants", color: "teal" }),
			fakeTask({ id: ID2, title: "Walk the dog" }),
		);
		const suggest = vi.fn(async (title: string) =>
			title.startsWith("Water") ? [PLANT] : [DOG],
		);
		const { picked, sync } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(2);
		expect(sync.enqueue).toHaveBeenCalledTimes(2);
		const [first, second] = sync.enqueue.mock.calls.map((call) => call[0]);
		expect(first).toEqual({
			id: expect.any(String),
			at: 1234,
			type: "task.update",
			taskId: ID1,
			emoji: PLANT,
		});
		expect(second).toMatchObject({ taskId: ID2, emoji: DOG });
		for (const mutation of [first, second]) {
			expect(mutation).not.toHaveProperty("color");
			expect(mutation).not.toHaveProperty("title");
			expect(mutationErrors(mutation)).toEqual([]);
		}
		expect(suggest).toHaveBeenCalledWith("Water the plants", {
			autoPick: true,
		});
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("asks the engine for one task at a time, in the order they were listed", async () => {
		await listed(
			fakeTask({ id: "t1", title: "First" }),
			fakeTask({ id: "t2", title: "Second" }),
		);
		const order: string[] = [];
		let release: (emoji: string[]) => void = () => {};
		const suggest = vi.fn(async (title: string) => {
			order.push(`start ${title}`);
			if (title === "First")
				await new Promise<void>((resolve) => {
					release = () => resolve();
				});
			order.push(`end ${title}`);
			return [PLANT];
		});
		const done = run(fakeEmojiEngine({ suggest }));
		await vi.waitFor(() => expect(suggest).toHaveBeenCalledTimes(1));
		expect(order).toEqual(["start First"]);
		release([]);
		await done;
		expect(order).toEqual([
			"start First",
			"end First",
			"start Second",
			"end Second",
		]);
	});

	it("skips tasks that already have an emoji, including a deliberate default", async () => {
		await listed(
			fakeTask({ id: "picked", emoji: DOG }),
			fakeTask({ id: "default", emoji: "\u{1F4CB}" }),
			fakeTask({ id: "empty", title: "Water the plants" }),
		);
		const suggest = vi.fn(async () => [PLANT]);
		const { sync } = await run(fakeEmojiEngine({ suggest }));
		expect(suggest).toHaveBeenCalledTimes(1);
		expect(sync.enqueue).toHaveBeenCalledTimes(1);
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({ taskId: "empty" });
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("skips tasks another user owns, archived tasks, and tasks that no longer exist", async () => {
		await listed(
			fakeTask({ id: "theirs", ownerId: "u2" }),
			fakeTask({ id: "archived", archivedAt: 5 }),
		);
		await addAwaitingEmoji(store, "gone");
		const suggest = vi.fn(async () => [PLANT]);
		const { picked } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(0);
		expect(suggest).not.toHaveBeenCalled();
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("never picks for a task that was not on the list, such as every task that predates the feature", async () => {
		await store.tasks.put(fakeTask({ id: "old", title: "Brush teeth" }));
		const suggest = vi.fn(async () => [PLANT]);
		const { picked, sync } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(0);
		expect(suggest).not.toHaveBeenCalled();
		expect(sync.enqueue).not.toHaveBeenCalled();
	});

	it("makes one attempt per task: an empty answer leaves the default and the id is not kept", async () => {
		await listed(fakeTask({ id: "t1", title: "Zzz" }));
		const suggest = vi.fn(async () => [] as string[]);
		const { picked, sync } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(0);
		expect(sync.enqueue).not.toHaveBeenCalled();
		expect(await listAwaitingEmoji(store)).toEqual([]);
		await run(fakeEmojiEngine({ suggest }));
		expect(suggest).toHaveBeenCalledTimes(1);
	});

	it("tries the next task when one fails, and ignores a reply that is not a valid emoji", async () => {
		await listed(
			fakeTask({ id: "t1", title: "One" }),
			fakeTask({ id: "t2", title: "Two" }),
			fakeTask({ id: "t3", title: "Three" }),
		);
		const suggest = vi.fn(async (title: string) => {
			if (title === "One") throw new Error("worker gone");
			if (title === "Two") return ["not an emoji"];
			return [PLANT];
		});
		const { picked, sync } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(1);
		expect(sync.enqueue).toHaveBeenCalledTimes(1);
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({ taskId: "t3" });
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("does nothing, and keeps the list, while the engine is not ready", async () => {
		await listed(fakeTask({ id: "t1" }));
		const suggest = vi.fn(async () => [PLANT]);
		const { picked } = await run(
			fakeEmojiEngine({ status: "loading", suggest }),
		);
		expect(picked).toBe(0);
		expect(suggest).not.toHaveBeenCalled();
		expect(await listAwaitingEmoji(store)).toEqual(["t1"]);
	});

	it("stops, keeping the rest of the list, when the engine stops being ready", async () => {
		await listed(
			fakeTask({ id: "t1", title: "One" }),
			fakeTask({ id: "t2", title: "Two" }),
		);
		let status: EmojiEngine["status"] = "ready";
		const engine: EmojiEngine = {
			get status() {
				return status;
			},
			suggest: vi.fn(async () => {
				status = "unavailable";
				return [] as string[];
			}),
			search: async () => [],
		};
		const { picked } = await run(engine);
		expect(picked).toBe(0);
		expect(await listAwaitingEmoji(store)).toEqual(["t2"]);
	});

	it("does not overwrite an emoji the task gained while the engine was thinking", async () => {
		await listed(fakeTask({ id: "t1", title: "One" }));
		const suggest = vi.fn(async () => {
			await store.tasks.update("t1", { emoji: DOG });
			return [PLANT];
		});
		const { picked, sync } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(0);
		expect(sync.enqueue).not.toHaveBeenCalled();
	});

	it("picks up tasks listed while it runs", async () => {
		await listed(fakeTask({ id: "t1", title: "One" }));
		const suggest = vi.fn(async (title: string) => {
			if (title === "One") {
				await store.tasks.put(fakeTask({ id: "t2", title: "Two" }));
				await addAwaitingEmoji(store, "t2");
			}
			return [PLANT];
		});
		const { picked } = await run(fakeEmojiEngine({ suggest }));
		expect(picked).toBe(2);
	});
});
```

Create `apps/web/src/features/emoji/LatePicks.test.tsx`:

```tsx
import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TagTeamDb } from "../../store/db";
import type { SyncStatus } from "../../sync/engine";
import { fakeEmojiEngine } from "../../test/emoji";
import { fakeEngine, fakeTask, renderWithSession } from "../../test/fakes";
import { addAwaitingEmoji } from "./awaiting";
import { type EmojiEngine, EmojiEngineProvider } from "./engine";
import { LatePicks } from "./LatePicks";

const PLANT = "\u{1FAB4}";

function setup(options: { emoji: EmojiEngine; lastSyncedAt?: number | null }) {
	const store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	const base = fakeEngine();
	let status: SyncStatus = {
		state: "idle",
		pending: 0,
		lastSyncedAt: options.lastSyncedAt ?? 100,
	};
	const listeners = new Set<(s: SyncStatus) => void>();
	const sync = {
		...base,
		getStatus: () => status,
		subscribe: (listener: (s: SyncStatus) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	renderWithSession(
		<EmojiEngineProvider value={options.emoji}>
			<LatePicks />
		</EmojiEngineProvider>,
		{ store, engine: sync },
	);
	return {
		store,
		sync,
		finishSync() {
			status = { ...status, lastSyncedAt: 200 };
			for (const listener of listeners) listener(status);
		},
	};
}
const addTask = async (
	store: TagTeamDb,
	id: string,
	title = "Water the plants",
) => {
	await store.tasks.put(fakeTask({ id, title }));
	await addAwaitingEmoji(store, id);
};

describe("LatePicks", () => {
	it("picks an emoji for a listed task once the engine is ready and a sync has finished", async () => {
		const suggest = vi.fn(async () => [PLANT]);
		const { store, sync } = setup({ emoji: fakeEmojiEngine({ suggest }) });
		await addTask(store, "t1");
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({
			type: "task.update",
			taskId: "t1",
			emoji: PLANT,
		});
	});

	it("waits for the first successful sync", async () => {
		const suggest = vi.fn(async () => [PLANT]);
		const { store, sync, finishSync } = setup({
			emoji: fakeEmojiEngine({ suggest }),
			lastSyncedAt: null,
		});
		await addTask(store, "t1");
		await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
		expect(suggest).not.toHaveBeenCalled();
		act(() => finishSync());
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
	});

	it("does nothing while the engine is not ready", async () => {
		const suggest = vi.fn(async () => [PLANT]);
		const { store } = setup({
			emoji: fakeEmojiEngine({ status: "loading", suggest }),
		});
		await addTask(store, "t1");
		await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
		expect(suggest).not.toHaveBeenCalled();
	});

	it("picks for a task listed after the engine was already ready", async () => {
		const suggest = vi.fn(async () => [PLANT]);
		const { store, sync } = setup({ emoji: fakeEmojiEngine({ suggest }) });
		await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
		await addTask(store, "t9", "Walk the dog");
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({ taskId: "t9" });
	});
});
```

Create `apps/web/src/features/today/TodayScreen.accept-emoji.test.tsx`:

```tsx
import type { MemberDto } from "@tagteam/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagTeamDb } from "../../store/db";
import { fakeEmojiEngine } from "../../test/emoji";
import {
	fakeEngine,
	fakeSuggestion,
	renderWithSession,
} from "../../test/fakes";
import { listAwaitingEmoji } from "../emoji/awaiting";
import { type EmojiEngine, EmojiEngineProvider } from "../emoji/engine";
import { TodayScreen } from "./TodayScreen";

vi.mock("../../ui/confetti", () => ({ fireScreenConfettiCannon: vi.fn() }));

const jo: MemberDto = {
	groupId: "g1",
	userId: "u2",
	displayName: "Jo",
	avatarColor: "blue",
	role: "member",
	joinedAt: 0,
	leftAt: null,
};

async function accept(emoji: EmojiEngine, suggestionEmoji: string | null) {
	const store = new TagTeamDb(`test-${crypto.randomUUID()}`);
	await store.members.put(jo);
	await store.suggestions.put(fakeSuggestion({ emoji: suggestionEmoji }));
	const sync = fakeEngine();
	renderWithSession(
		<EmojiEngineProvider value={emoji}>
			<TodayScreen />
		</EmojiEngineProvider>,
		{ store, engine: sync },
	);
	await userEvent.click(
		await screen.findByRole("button", { name: /1 suggestion for you/ }),
	);
	const sheet = await screen.findByRole("dialog", { name: "Suggestions" });
	await userEvent.click(
		within(sheet).getByRole("button", { name: "Accept Wash dishes" }),
	);
	await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
	const mutation = sync.enqueue.mock.calls[0][0] as { taskId: string };
	return { store, mutation };
}

describe("accepting a suggestion that has no emoji", () => {
	it("lists the new task for a late pick", async () => {
		const { store, mutation } = await accept(
			fakeEmojiEngine({ status: "loading" }),
			null,
		);
		await waitFor(async () =>
			expect(await listAwaitingEmoji(store)).toEqual([mutation.taskId]),
		);
	});

	it("does not list a task whose suggestion came with an emoji", async () => {
		const { store } = await accept(fakeEmojiEngine(), "\u{1FAB4}");
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("does not list it when suggestions are switched off on this device", async () => {
		const { store } = await accept(fakeEmojiEngine({ status: "off" }), null);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});
});
```

In `apps/web/src/features/add-task/AddTaskSheet.auto-emoji.test.tsx` add these two imports (keeping Biome's import order) and append the block below at the end of the file:

```ts
import { TagTeamDb } from "../../store/db";
import { listAwaitingEmoji } from "../emoji/awaiting";
```

```tsx
describe("listing a new task for a late pick", () => {
	const renderWithStore = (emoji: EmojiEngine) => {
		const store = new TagTeamDb(`test-${crypto.randomUUID()}`);
		const sync = fakeEngine();
		const view = renderWithSession(
			<EmojiEngineProvider value={emoji}>
				<AddTaskSheet open onClose={vi.fn()} />
			</EmojiEngineProvider>,
			{ store, engine: sync },
		);
		return { store, sync, view };
	};
	const created = (sync: ReturnType<typeof fakeEngine>) =>
		sync.enqueue.mock.calls[0][0] as { taskId: string };

	it("lists a task created with no stored emoji", async () => {
		const { store, sync } = renderWithStore(
			fakeEmojiEngine({
				suggest: vi.fn(() => new Promise<string[]>(() => {})),
			}),
		);
		await userEvent.type(title(), "Walk the dog");
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		await waitFor(async () =>
			expect(await listAwaitingEmoji(store)).toEqual([created(sync).taskId]),
		);
	});

	it("lists it while the engine is still loading or unavailable", async () => {
		for (const status of ["loading", "unavailable"] as const) {
			const { store, sync, view } = renderWithStore(
				fakeEmojiEngine({ status }),
			);
			await userEvent.type(screen.getByLabelText("Task"), "Walk the dog");
			await userEvent.click(screen.getByRole("button", { name: "Create" }));
			await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
			await waitFor(async () =>
				expect(await listAwaitingEmoji(store)).toHaveLength(1),
			);
			view.unmount();
		}
	});

	it("does not list a task created with an emoji, automatic or by hand", async () => {
		const auto = renderWithStore(
			fakeEmojiEngine({ suggest: vi.fn(async () => [PLANT]) }),
		);
		await userEvent.type(title(), "Water the plants");
		await waitFor(() =>
			expect(emojiButton("Emoji: potted plant, change")).toBeInTheDocument(),
		);
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(auto.sync.enqueue).toHaveBeenCalledTimes(1));
		await pause(50);
		expect(await listAwaitingEmoji(auto.store)).toEqual([]);
	});

	it("does not list a task created with Use default, which is a stored emoji", async () => {
		const { store, sync } = renderWithStore(fakeEmojiEngine());
		await userEvent.type(title(), "Walk the dog");
		await userEvent.click(emojiButton(/^Emoji:/));
		await userEvent.click(
			await screen.findByRole("button", { name: "Use default" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		await pause(50);
		expect(sync.enqueue.mock.calls[0][0]).toMatchObject({ emoji: "\u{1F4CB}" });
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("does not list a task when suggestions are switched off on this device", async () => {
		const { store, sync } = renderWithStore(fakeEmojiEngine({ status: "off" }));
		await userEvent.type(title(), "Walk the dog");
		await userEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalledTimes(1));
		await pause(50);
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});

	it("does not list an edit", async () => {
		const store = new TagTeamDb(`test-${crypto.randomUUID()}`);
		const sync = fakeEngine();
		renderWithSession(
			<EmojiEngineProvider value={fakeEmojiEngine()}>
				<AddTaskSheet open onClose={vi.fn()} task={fakeTask({ emoji: null })} />
			</EmojiEngineProvider>,
			{ store, engine: sync },
		);
		await userEvent.clear(title());
		await userEvent.type(title(), "Brush your teeth");
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(sync.enqueue).toHaveBeenCalled());
		expect(await listAwaitingEmoji(store)).toEqual([]);
	});
});
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features/emoji/awaiting.test.ts src/features/emoji/late-pick.test.ts src/features/emoji/LatePicks.test.tsx src/features/today/TodayScreen.accept-emoji.test.tsx src/features/add-task/AddTaskSheet.auto-emoji.test.tsx`
Expected: FAIL — `Failed to resolve import "./awaiting"` (and `./late-pick`, `./LatePicks`), and the new sheet and Today tests fail because nothing lists a task.

- [ ] **Step 2: The list**

In `apps/web/src/store/db.ts` extend `MetaKey`:

```ts
export type MetaKey =
	| "cursor"
	| "me"
	| "activeGroupId"
	| "pendingActiveGroupId"
	| "awaitingEmoji";
```

Create `apps/web/src/features/emoji/awaiting.ts`:

```ts
import { getMeta, setMeta, type TagTeamDb } from "../../store/db";

// The device-local "awaiting emoji" list (spec §6): ids of tasks this device created, or accepted,
// with no stored emoji. It lives in the Dexie meta table, so it is never synced and sign-out
// clears it with the rest of the local data.

export async function listAwaitingEmoji(store: TagTeamDb): Promise<string[]> {
	const value = await getMeta<unknown>(store, "awaitingEmoji");
	return Array.isArray(value)
		? value.filter((id): id is string => typeof id === "string")
		: [];
}

export async function addAwaitingEmoji(
	store: TagTeamDb,
	taskId: string,
): Promise<void> {
	await store.transaction("rw", store.meta, async () => {
		const ids = await listAwaitingEmoji(store);
		if (!ids.includes(taskId))
			await setMeta(store, "awaitingEmoji", [...ids, taskId]);
	});
}

export async function removeAwaitingEmoji(
	store: TagTeamDb,
	taskId: string,
): Promise<void> {
	await store.transaction("rw", store.meta, async () => {
		const ids = await listAwaitingEmoji(store);
		if (ids.includes(taskId))
			await setMeta(
				store,
				"awaitingEmoji",
				ids.filter((id) => id !== taskId),
			);
	});
}
```

- [ ] **Step 3: The late picks and their runner**

`apps/web/src/features/emoji/late-pick.ts`:

```ts
import { isEmoji } from "@tagteam/core";
import type { TagTeamDb } from "../../store/db";
import type { SyncEngine } from "../../sync/engine";
import { listAwaitingEmoji, removeAwaitingEmoji } from "./awaiting";
import type { EmojiEngine } from "./engine";

/**
 * Gives each listed task an emoji from its title (spec §6 "Late pick"). One task at a time, one
 * attempt each: the id leaves the list before the engine is asked. A task is only picked for when
 * this user still owns it, it is not archived, and it still has no stored emoji. The change is an
 * ordinary `task.update` carrying the emoji and nothing else: never the colour, and the server
 * writes no activity entry and sends no push for it. A failure for one task leaves it with the
 * default and moves on. Stops, leaving the rest listed, when the engine is no longer ready.
 * Returns how many tasks received an emoji.
 */
export async function runLatePicks({
	store,
	sync,
	userId,
	getEngine,
	now = Date.now,
}: {
	store: TagTeamDb;
	sync: Pick<SyncEngine, "enqueue">;
	userId: string;
	/** The current engine; read again before every task, because its status can change. */
	getEngine: () => EmojiEngine;
	now?: () => number;
}): Promise<number> {
	let picked = 0;
	for (;;) {
		const [taskId] = await listAwaitingEmoji(store);
		if (taskId === undefined) return picked;
		const engine = getEngine();
		if (engine.status !== "ready") return picked;

		const task = await store.tasks.get(taskId);
		await removeAwaitingEmoji(store, taskId);
		if (
			!task ||
			task.ownerId !== userId ||
			task.archivedAt !== null ||
			(task.emoji ?? null) !== null
		)
			continue;
		try {
			const [emoji] = await engine.suggest(task.title, { autoPick: true });
			if (emoji === undefined || !isEmoji(emoji)) continue;
			// It may have gained an emoji or been archived while the engine was thinking.
			const current = await store.tasks.get(taskId);
			if (
				!current ||
				current.archivedAt !== null ||
				(current.emoji ?? null) !== null
			)
				continue;
			await sync.enqueue({
				id: crypto.randomUUID(),
				at: now(),
				type: "task.update",
				taskId,
				emoji,
			});
			picked++;
		} catch {
			// This task keeps the default; the next one is tried.
		}
	}
}
```

`apps/web/src/features/emoji/LatePicks.tsx`:

```tsx
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session";
import { getMeta } from "../../store/db";
import { useEmojiEngine } from "./engine";
import { runLatePicks } from "./late-pick";

/**
 * Runs the late picks in the background: whenever the engine is ready, a sync has succeeded since
 * the app started (so the local copy of each task is current), and tasks are waiting.
 * It renders nothing.
 */
export function LatePicks() {
	const { store, engine: sync, me } = useSession();
	const emoji = useEmojiEngine();
	const latest = useRef(emoji);
	latest.current = emoji;
	const running = useRef(false);
	const [synced, setSynced] = useState(
		() => sync.getStatus().lastSyncedAt !== null,
	);
	const waiting = useLiveQuery(
		async () => (await getMeta<string[]>(store, "awaitingEmoji"))?.length ?? 0,
		[store],
		0,
	);

	useEffect(() => {
		if (synced) return;
		return sync.subscribe((status) => {
			if (status.state === "idle" && status.lastSyncedAt !== null)
				setSynced(true);
		});
	}, [sync, synced]);

	const ready = emoji.status === "ready";
	useEffect(() => {
		if (!ready || !synced || waiting === 0 || running.current) return;
		running.current = true;
		void runLatePicks({
			store,
			sync,
			userId: me.user.id,
			getEngine: () => latest.current,
		}).finally(() => {
			running.current = false;
		});
	}, [ready, synced, waiting, store, sync, me.user.id]);
	return null;
}
```

In `apps/web/src/features/emoji/EmojiEngineHost.tsx` add `import { LatePicks } from "./LatePicks";` after the `./engine` import and render `<LatePicks />` directly under `<WarmUp controller={controller} />`.

- [ ] **Step 4: List the tasks that need a late pick**

In `apps/web/src/features/add-task/AddTaskSheet.tsx` add `import { addAwaitingEmoji } from "../emoji/awaiting";` before the `useEmojiName` import, and replace the final branch of `submit`

```tsx
				await engine.enqueue(
					draftMutation(draft, {
						groupId: activeGroupId as string,
						timezone: browserTimeZone(),
						at: Date.now(),
					}),
				);
				toast.show({ message: `Added · ${draft.title.trim()}` });
```

with

```tsx
				const created = draftMutation(draft, {
					groupId: activeGroupId as string,
					timezone: browserTimeZone(),
					at: Date.now(),
				});
				await engine.enqueue(created);
				// No stored emoji yet: once the engine is ready this device picks one (spec §6).
				// Skipped when the person has switched suggestions off on this device.
				if (
					created.type === "task.create" &&
					(created.emoji ?? null) === null &&
					emojiEngine.status !== "off"
				)
					void addAwaitingEmoji(store, created.taskId).catch(() => {});
				toast.show({ message: `Added · ${draft.title.trim()}` });
```

In `apps/web/src/features/today/TodayScreen.tsx` add

```ts
import { addAwaitingEmoji } from "../emoji/awaiting";
import { useEmojiEngine } from "../emoji/engine";
```

after the `useToast` import, add `const emojiEngine = useEmojiEngine();` on the line after `const { store, engine, me, activeGroupId } = useSession();`, and in `answer`, directly after `await engine.enqueue(mutation);` insert:

```tsx
			// The accepted task has no emoji yet: once the engine is ready this device picks one.
			if (
				mutation.type === "suggestion.accept" &&
				(suggestion.emoji ?? null) === null &&
				emojiEngine.status !== "off"
			)
				void addAwaitingEmoji(store, mutation.taskId).catch(() => {});
```

Run: `pnpm --filter @tagteam/web exec vitest run src/features`
Expected: PASS — the 30 new tests (6 + 11 + 4 + 3 + 6) and every existing test. The existing "creates a one-off task on Enter" test closes the sheet right after the keystroke, which is why the list write must not be awaited.

- [ ] **Step 5: Repo checks and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (web 429 + 30 = 459).

```bash
git add apps/web/src/store/db.ts apps/web/src/features/emoji/awaiting.ts apps/web/src/features/emoji/awaiting.test.ts apps/web/src/features/emoji/late-pick.ts apps/web/src/features/emoji/late-pick.test.ts apps/web/src/features/emoji/LatePicks.tsx apps/web/src/features/emoji/LatePicks.test.tsx apps/web/src/features/emoji/EmojiEngineHost.tsx apps/web/src/features/add-task apps/web/src/features/today
git commit -m "feat(web): late emoji picks for tasks saved before the model is ready"
```

---

### Task 10: The evaluation script and the auto-pick exclusion gate

**Files:**
- Create: `apps/web/scripts/emoji-eval-titles.json`, `apps/web/scripts/eval-emoji.mjs`
- Test: `apps/web/scripts/emoji-eval-titles.test.ts`
- Modify: `apps/web/package.json`; `apps/web/src/features/emoji/auto-pick.ts` only if the script says ADOPT

**Interfaces:**
- Consumes: the committed index (Task 3), `search.ts` `rank`/`signBits`/`DIM`, `auto-pick.ts` `isAutoPickExcluded` (Task 5), the model files (Task 2), `catalog.json`.
- Produces:
  - `scripts/emoji-eval-titles.json`: the spike's 79 hand-labelled titles, `[{ "t": title, "ok": [acceptable emoji…] }]` (this is the spike's `queries.json`; the spike's folder is not in the repo, so the data is given in full below).
  - `pnpm --filter @tagteam/web emoji:eval`: run by hand, never in CI. It embeds the catalog documents and the titles with the pinned model (Node, `onnxruntime-node`), then prints hit@1 ("first right") and hit@3 ("in top 3") for four rankings: full-precision vectors, sign bits alone, the shipped search (bits shortlist + int8 re-rank), and the shipped search with the auto-pick exclusion; lists every title whose first pick the exclusion changes; and ends with a verdict line. **The verdict rule (spec §7): ADOPT only when first-pick accuracy with the exclusion is not lower than without it (`excluded.hit1 >= plain.hit1`), otherwise REJECT.**
  - The decision: `AUTO_PICK_EXCLUSION` in `auto-pick.ts` is `true` only after an ADOPT.

- [ ] **Step 1: Write the failing test for the labelled titles**

Create `apps/web/scripts/emoji-eval-titles.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import catalog from "../src/features/emoji/catalog.json";

const titles = JSON.parse(
	readFileSync(join(import.meta.dirname, "emoji-eval-titles.json"), "utf8"),
) as { t: string; ok: string[] }[];

// Same normalisation as scripts/eval-emoji.mjs: labels may use any spelling of an emoji.
const norm = (emoji: string) =>
	emoji
		.replace(/️/g, "")
		.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
		.replace(/‍[♀♂➡]/g, "");

describe("the labelled evaluation titles", () => {
	it("hold 79 distinct titles, each with at least one acceptable emoji", () => {
		expect(titles).toHaveLength(79);
		expect(new Set(titles.map((title) => title.t)).size).toBe(79);
		for (const title of titles) {
			expect(title.t.trim().length, title.t).toBeGreaterThanOrEqual(3);
			expect(title.ok.length, title.t).toBeGreaterThan(0);
		}
	});

	it("only accept emoji that the catalog can offer", () => {
		const known = new Set(
			(catalog as { e: string }[]).map((entry) => norm(entry.e)),
		);
		for (const title of titles)
			for (const emoji of title.ok)
				expect(known.has(norm(emoji)), `${title.t}: ${emoji}`).toBe(true);
	});
});
```

Run: `pnpm --filter @tagteam/web exec vitest run scripts/emoji-eval-titles.test.ts`
Expected: FAIL — `ENOENT … emoji-eval-titles.json`.

- [ ] **Step 2: Add the labelled titles**

Create `apps/web/scripts/emoji-eval-titles.json`:

```json
[
	{ "t": "Mop the kitchen", "ok": ["🧹", "🧽", "🪣", "🧼"] },
	{ "t": "Wash dishes", "ok": ["🍽", "🧽", "🧼", "🫧"] },
	{ "t": "Wipe the counters", "ok": ["🧽", "🧼", "🧻"] },
	{ "t": "Take the bins out", "ok": ["🗑", "♻", "🚮"] },
	{ "t": "Hoover the lounge", "ok": ["🧹", "🛋"] },
	{ "t": "Do the laundry", "ok": ["🧺", "👕", "🧦", "🫧"] },
	{ "t": "Hang out the washing", "ok": ["🧺", "👕", "🧦"] },
	{ "t": "Iron shirts", "ok": ["👔", "👕"] },
	{ "t": "Change the bed sheets", "ok": ["🛏", "🛌"] },
	{ "t": "Clean the bathroom", "ok": ["🚽", "🛁", "🚿", "🧽", "🧼", "🧹"] },
	{ "t": "Scrub the toilet", "ok": ["🚽", "🪠", "🧽"] },
	{ "t": "Water the plants", "ok": ["🪴", "🌱", "💧", "🚿", "🌿"] },
	{ "t": "Mow the lawn", "ok": ["🌱", "🌿", "🏡", "🚜"] },
	{ "t": "Feed the cat", "ok": ["🐈", "🐱", "😺", "🐈‍⬛"] },
	{ "t": "Walk the dog", "ok": ["🐕", "🐶", "🦮", "🐕‍🦺"] },
	{ "t": "Clean the litter tray", "ok": ["🐈", "🐱", "🧹", "🗑"] },
	{ "t": "Buy groceries", "ok": ["🛒", "🛍", "🥦", "🍎"] },
	{ "t": "Cook dinner", "ok": ["🍳", "🍲", "🧑‍🍳", "🍽", "🥘"] },
	{ "t": "Meal prep for the week", "ok": ["🍱", "🥗", "🍲", "🍳", "🥘"] },
	{ "t": "Pack lunch boxes", "ok": ["🍱", "🥪", "🎒"] },
	{ "t": "Empty the dishwasher", "ok": ["🍽", "🧼", "🫧"] },
	{ "t": "Clean out the fridge", "ok": ["🧊", "🧽", "🧼", "🥫"] },
	{ "t": "Pay rent", "ok": ["💸", "💰", "🏠", "💳", "🏦"] },
	{ "t": "Pay the electricity bill", "ok": ["💡", "⚡", "💸", "💳", "🧾"] },
	{ "t": "File tax return", "ok": ["🧾", "📄", "📑", "💰", "🗂"] },
	{ "t": "Call mum", "ok": ["📞", "☎", "📱", "🤙"] },
	{ "t": "Book dentist appointment", "ok": ["🦷", "📅", "🗓"] },
	{ "t": "Take vitamins", "ok": ["💊"] },
	{ "t": "Take medication", "ok": ["💊", "💉"] },
	{ "t": "Drink 2 litres of water", "ok": ["💧", "🚰", "🥤", "🫗"] },
	{ "t": "Go for a run", "ok": ["🏃", "👟"] },
	{ "t": "Morning yoga", "ok": ["🧘"] },
	{ "t": "Go to the gym", "ok": ["🏋", "💪"] },
	{ "t": "Meditate for 10 minutes", "ok": ["🧘"] },
	{ "t": "Read for 20 minutes", "ok": ["📖", "📚", "📕"] },
	{ "t": "Practise guitar", "ok": ["🎸"] },
	{ "t": "Practise piano", "ok": ["🎹"] },
	{ "t": "Study Spanish", "ok": ["🇪🇸", "📚", "📖", "🗣"] },
	{ "t": "Do homework", "ok": ["📚", "✏", "📝", "📖"] },
	{ "t": "Floss teeth", "ok": ["🦷", "🪥"] },
	{ "t": "Brush teeth", "ok": ["🪥", "🦷"] },
	{ "t": "Go to bed by 10pm", "ok": ["🛏", "😴", "🛌", "💤", "🌙"] },
	{ "t": "Wake up at 6am", "ok": ["⏰", "🌅", "☀", "🌄"] },
	{ "t": "Journal", "ok": ["📓", "📔", "✍", "📝", "📒"] },
	{ "t": "No sugar today", "ok": ["🍬", "🍭", "🚫", "🍩", "🍫"] },
	{ "t": "Take out the recycling", "ok": ["♻", "🗑"] },
	{ "t": "Clean the windows", "ok": ["🪟", "🧽", "🧼"] },
	{ "t": "Dust the shelves", "ok": ["🧹", "🧽"] },
	{ "t": "Tidy the kids' room", "ok": ["🧸", "🧹", "🛏"] },
	{ "t": "School run", "ok": ["🏫", "🚸", "🚗", "🎒", "🚌"] },
	{ "t": "Pick up prescription", "ok": ["💊", "🏥", "⚕"] },
	{ "t": "Post the parcel", "ok": ["📦", "📮", "📫", "📬", "🏤"] },
	{ "t": "Renew car insurance", "ok": ["🚗", "🚙", "📄"] },
	{ "t": "Wash the car", "ok": ["🚗", "🚙", "🧽", "🫧", "🧼"] },
	{ "t": "Check tyre pressure", "ok": ["🚗", "🛞"] },
	{ "t": "Charge the bike lights", "ok": ["🚲", "🔋", "💡", "🔦"] },
	{ "t": "Back up the laptop", "ok": ["💻", "💾"] },
	{ "t": "Water the garden", "ok": ["🌱", "💧", "🪴", "🌻", "🚿", "🌷"] },
	{ "t": "Rake the leaves", "ok": ["🍂", "🍁", "🍃"] },
	{ "t": "Clear the gutters", "ok": ["🏠", "🍂", "🪜"] },
	{ "t": "Defrost the freezer", "ok": ["🧊", "❄", "🥶"] },
	{ "t": "Descale the kettle", "ok": ["☕", "🫖"] },
	{ "t": "Bake bread", "ok": ["🍞", "🥖", "🥯"] },
	{ "t": "Feed the sourdough starter", "ok": ["🍞", "🥖"] },
	{ "t": "Bath time for the baby", "ok": ["🛁", "👶", "🧼"] },
	{ "t": "Clip the dog's nails", "ok": ["🐕", "🐶", "✂", "🦮"] },
	{ "t": "Clean the fish tank", "ok": ["🐟", "🐠", "🐡"] },
	{ "t": "Change the cat's water", "ok": ["🐈", "🐱", "💧"] },
	{ "t": "Stretch", "ok": ["🧘", "🤸"] },
	{ "t": "Weigh in", "ok": ["⚖"] },
	{ "t": "Plan the week", "ok": ["📅", "🗓", "📆", "📝"] },
	{ "t": "Empty the hoover", "ok": ["🧹", "🗑"] },
	{ "t": "Sort the post", "ok": ["📬", "📫", "📮", "✉", "📨", "📪", "📭"] },
	{ "t": "Shave", "ok": ["🪒"] },
	{ "t": "Skincare routine", "ok": ["🧴", "🧖", "🧼"] },
	{ "t": "Cut the hedge", "ok": ["✂", "🌳", "🌿", "🪴"] },
	{ "t": "Sweep the patio", "ok": ["🧹"] },
	{ "t": "Take the dog to the vet", "ok": ["🐕", "🐶", "🏥", "⚕", "🩺"] },
	{ "t": "Top up the bird feeder", "ok": ["🐦", "🐤", "🪶"] }
]
```

Run the test again. Expected: PASS (2 tests: 79 distinct titles each with a label; every label exists in the catalog once presentation selectors, skin tones, gender and direction suffixes are ignored).

- [ ] **Step 3: The evaluation script**

Create `apps/web/scripts/eval-emoji.mjs`:

```js
// Measures emoji suggestion accuracy on the labelled titles in emoji-eval-titles.json, using the
// committed index and the pinned model. Run by hand (needs the model files: `emoji:assets`):
//   pnpm --filter @tagteam/web emoji:eval
// It prints hit@1 and hit@3 for full-precision vectors, sign bits alone, and the shipped search
// (bits shortlist + int8 re-rank), then for the shipped search with the auto-pick exclusion, and a
// verdict for the exclusion. Not part of CI.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { isAutoPickExcluded } from "../src/features/emoji/auto-pick.ts";
import { DIM, rank, signBits } from "../src/features/emoji/search.ts";
import { assetVersion, loadManifest, WEB_ROOT } from "./emoji-assets.mjs";

const TOP = 3;
const manifest = loadManifest();
const emojiDir = join(WEB_ROOT, "src/features/emoji");
const catalog = JSON.parse(
	readFileSync(join(emojiDir, "catalog.json"), "utf8"),
);
const titles = JSON.parse(
	readFileSync(join(WEB_ROOT, "scripts/emoji-eval-titles.json"), "utf8"),
);
const meta = JSON.parse(
	readFileSync(join(emojiDir, "index/index.json"), "utf8"),
);
const bytes = (name) => readFileSync(join(emojiDir, "index", name));
const bitsFile = bytes("bits.bin");
const int8File = bytes("int8.bin");
const index = {
	count: meta.count,
	bits: new Uint8Array(bitsFile.buffer, bitsFile.byteOffset, bitsFile.length),
	int8: new Int8Array(int8File.buffer, int8File.byteOffset, int8File.length),
};
if (index.count !== catalog.length)
	throw new Error(
		"the index does not match catalog.json; run `pnpm --filter @tagteam/web emoji:index`",
	);

// The labels use any spelling of an emoji, so compare without presentation selectors, skin tones,
// gender and direction suffixes.
const norm = (emoji) =>
	emoji
		.replace(/️/g, "")
		.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
		.replace(/‍[♀♂➡]/g, "");
const keys = catalog.map((entry) => norm(entry.e));

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = join(
	WEB_ROOT,
	"public/assets/emoji",
	assetVersion(manifest),
	"models",
);
const extractor = await pipeline("feature-extraction", manifest.model.id, {
	dtype: "q8",
});
const embed = async (texts) => {
	const out = new Float32Array(texts.length * DIM);
	for (let i = 0; i < texts.length; i += 32) {
		const result = await extractor(texts.slice(i, i + 32), {
			pooling: "cls",
			normalize: true,
		});
		out.set(result.data, i * DIM);
	}
	return out;
};

const docs = await embed(
	catalog.map((entry) => `${entry.n}: ${entry.t.join(", ")}`),
);
const queries = await embed(titles.map((title) => title.t));
const query = (i) => queries.subarray(i * DIM, (i + 1) * DIM);
const ordered = (scores, descending) =>
	Array.from({ length: scores.length }, (_, i) => i).sort(
		(a, b) =>
			(descending ? scores[b] - scores[a] : scores[a] - scores[b]) || a - b,
	);

const rankers = {
	"float (full precision)": (q) => {
		const scores = new Float32Array(catalog.length);
		for (let i = 0; i < catalog.length; i++)
			for (let k = 0; k < DIM; k++) scores[i] += docs[i * DIM + k] * q[k];
		return ordered(scores, true);
	},
	"sign bits only": (q) => {
		const queryBits = signBits(q);
		const distance = new Int32Array(catalog.length);
		for (let i = 0; i < catalog.length; i++)
			for (let j = 0; j < DIM / 8; j++) {
				let x = index.bits[i * (DIM / 8) + j] ^ queryBits[j];
				while (x) {
					distance[i] += x & 1;
					x >>= 1;
				}
			}
		return ordered(distance, false);
	},
	"shipped: bits shortlist + int8 re-rank": (q) => rank(q, index).indices,
	"shipped + auto-pick exclusion": (q) =>
		rank(q, index).indices.filter((i) => !isAutoPickExcluded(catalog[i])),
};

const topDistinct = (order) => {
	const seen = new Set();
	const top = [];
	for (const i of order) {
		if (seen.has(keys[i])) continue;
		seen.add(keys[i]);
		top.push(i);
		if (top.length === TOP) break;
	}
	return top;
};
const accepted = titles.map((title) => new Set(title.ok.map(norm)));
const results = {};
for (const [name, ranker] of Object.entries(rankers)) {
	const tops = titles.map((_, i) => topDistinct(ranker(query(i))));
	results[name] = {
		tops,
		hit1: tops.filter(
			(top, i) => top[0] !== undefined && accepted[i].has(keys[top[0]]),
		).length,
		hit3: tops.filter((top, i) => top.some((j) => accepted[i].has(keys[j])))
			.length,
	};
}

const pct = (n) => `${Math.round((n / titles.length) * 100)}%`;
console.log(
	`${titles.length} labelled titles, ${catalog.length} emoji, model ${manifest.model.id}@${manifest.model.revision.slice(0, 8)}\n`,
);
console.log("| ranking | first right | in top 3 |\n|---|---|---|");
for (const [name, r] of Object.entries(results))
	console.log(
		`| ${name} | ${r.hit1} (${pct(r.hit1)}) | ${r.hit3} (${pct(r.hit3)}) |`,
	);

const plain = results["shipped: bits shortlist + int8 re-rank"];
const excluded = results["shipped + auto-pick exclusion"];
console.log("\nTitles where the exclusion changes the first pick:");
let changed = 0;
titles.forEach((title, i) => {
	const before = plain.tops[i][0];
	const after = excluded.tops[i][0];
	if (before === after) return;
	changed++;
	const mark = (j) =>
		`${catalog[j].e} ${catalog[j].n}${accepted[i].has(keys[j]) ? " (right)" : ""}`;
	console.log(
		`- ${title.t}: ${mark(before)} -> ${after === undefined ? "nothing" : mark(after)}`,
	);
});
if (changed === 0) console.log("- none");

const adopt = excluded.hit1 >= plain.hit1;
console.log(
	`\nAuto-pick exclusion: first pick right ${plain.hit1} -> ${excluded.hit1} of ${titles.length}: ${adopt ? "ADOPT" : "REJECT"}. Set AUTO_PICK_EXCLUSION to ${adopt} in src/features/emoji/auto-pick.ts.`,
);
```

In `apps/web/package.json` add after `emoji:index`:

```json
		"emoji:eval": "node scripts/eval-emoji.mjs",
```

- [ ] **Step 4: Run it and apply the verdict**

Needs the model files and the committed index.

Run: `pnpm --filter @tagteam/web emoji:eval`
Expected on the committed index (about 10 s; the numbers were identical on two runs):

```
79 labelled titles, 1794 emoji, model Xenova/bge-small-en-v1.5@ea104dac

| ranking | first right | in top 3 |
|---|---|---|
| float (full precision) | 45 (57%) | 62 (78%) |
| sign bits only | 35 (44%) | 59 (75%) |
| shipped: bits shortlist + int8 re-rank | 46 (58%) | 62 (78%) |
| shipped + auto-pick exclusion | 45 (57%) | 62 (78%) |
…
Auto-pick exclusion: first pick right 46 -> 45 of 79: REJECT. Set AUTO_PICK_EXCLUSION to false in src/features/emoji/auto-pick.ts.
```

This is the spike's finding reproduced on the repo's catalog: bits plus int8 matches full precision, bits alone does not. Apply the verdict exactly as printed:

- `REJECT` (expected): leave `AUTO_PICK_EXCLUSION = false`. Nothing to change in `auto-pick.ts`. The excluded list stays in code, tested, and used by the controller only when the flag is on.
- `ADOPT` (only if your numbers differ): set `export const AUTO_PICK_EXCLUSION = true;` in `apps/web/src/features/emoji/auto-pick.ts` and change its comment to say the evaluation allowed it, with the numbers.

Write the printed table and verdict into the task report: Task 11 copies them into STATUS and the spec.

- [ ] **Step 5: Repo checks and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (web 459 + 2 = 461). The evaluation itself is not part of `pnpm test`.

```bash
git add apps/web/package.json apps/web/scripts/eval-emoji.mjs apps/web/scripts/emoji-eval-titles.json apps/web/scripts/emoji-eval-titles.test.ts apps/web/src/features/emoji/auto-pick.ts
git commit -m "feat(web): evaluation script for emoji suggestions and the auto-pick exclusion gate"
```

---

### Task 11: End-to-end tests, CI, visual and device checks, docs

**Files:**
- Create: `apps/web/e2e/emoji-helpers.ts`, `apps/web/e2e/emoji-suggestions.spec.ts`
- Modify: `.github/workflows/ci.yml`, `README.md`, `docs/STATUS.md`, `docs/superpowers/specs/2026-10-01-task-look-and-emoji-design.md`
- Create (git-ignored, only if missing): `apps/server/.env`
- The existing specs (`app`, `suggestions`, `task-look`) need no change: a device that has not downloaded the model never starts the engine.

**Interfaces:**
- Consumes: the whole feature; `emoji-assets.mjs` (`ASSETS_ROOT`, `assetVersion`, `loadManifest`); the UI contract from Tasks 6–9 (the sheet's emoji button "Emoji: {name}, change", the Me section's status lines and buttons from Task 7); server `POST /api/auth/sign-up/email`, `POST /api/groups`, `GET /api/sync/pull`.
- Produces: `emojiModelPresent()`, `emojiAssetsPath()`, `emojiModelPath(file)`; six browser specs run in WebKit (`iphone`) and `chromium` (12 tests); CI that fetches the model for the e2e job and runs the smoke test; up-to-date README, spec and STATUS.

- [ ] **Step 1: Helpers**

Create `apps/web/e2e/emoji-helpers.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	ASSETS_ROOT,
	assetVersion,
	loadManifest,
} from "../scripts/emoji-assets.mjs";

/** True when the model files from `emoji:assets` are in public/, so the build served them. */
export function emojiModelPresent(): boolean {
	const manifest = loadManifest();
	return existsSync(
		join(
			ASSETS_ROOT,
			assetVersion(manifest),
			"models",
			manifest.model.id,
			"onnx/model_quantized.onnx",
		),
	);
}

/** The asset version this build serves, as `/assets/emoji/<version>/`. */
export const emojiAssetsPath = () =>
	`/assets/emoji/${assetVersion(loadManifest())}/`;

/** The URL path of a file of the model, for example `onnx/model_quantized.onnx`. */
export const emojiModelPath = (file: string) => {
	const manifest = loadManifest();
	return `${emojiAssetsPath()}models/${manifest.model.id}/${file}`;
};
```

- [ ] **Step 2: The emoji spec**

Create `apps/web/e2e/emoji-suggestions.spec.ts`:

```ts
import {
	expect,
	type Locator,
	type Page,
	type TestInfo,
	test,
} from "@playwright/test";
import {
	emojiAssetsPath,
	emojiModelPath,
	emojiModelPresent,
} from "./emoji-helpers";

const DEFAULT_GLYPH = "\u{1F4CB}";
const PLANTS = [
	"\u{1FAB4}",
	"\u{1F331}",
	"\u{1F4A7}",
	"\u{1F33F}",
	"\u{1F6BF}",
];
const DOGS = ["\u{1F415}", "\u{1F436}", "\u{1F9AE}", "\u{1F415}‍\u{1F9BA}"];
const CATS = ["\u{1F408}", "\u{1F431}", "\u{1F63A}", "\u{1F408}‍⬛"];
const MODEL_TIMEOUT = 90_000;

const bare = (emoji: string) => emoji.replaceAll("️", "").trim();
const isOneOf = (glyph: string, allowed: string[]) =>
	allowed.map(bare).includes(bare(glyph));

async function signUpAndCreateGroup(page: Page, testInfo: TestInfo) {
	const origin = testInfo.project.use.baseURL as string;
	const signUp = await page.request.post("/api/auth/sign-up/email", {
		headers: { origin },
		data: {
			name: "Sam",
			email: `emoji-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
			password: "correct-horse-battery",
		},
	});
	expect(signUp.ok()).toBe(true);
	const created = await page.request.post("/api/groups", {
		data: { name: "E2E emoji" },
	});
	expect(created.ok()).toBe(true);
}

async function openNewTask(page: Page) {
	await page.getByRole("button", { name: "Add task" }).first().click();
	return page.getByRole("dialog", { name: "New task", exact: true });
}

/** The glyph shown on the sheet's emoji button. */
const sheetGlyph = (sheet: Locator) =>
	sheet.locator('[data-slot="task-emoji"]').first().innerText();

async function expectSheetGlyphIn(sheet: Locator, allowed: string[]) {
	await expect
		.poll(async () => isOneOf(await sheetGlyph(sheet), allowed), {
			timeout: MODEL_TIMEOUT,
		})
		.toBe(true);
}

const tileGlyph = (page: Page, title: string) =>
	page
		.getByRole("button", { name: `Complete ${title}` })
		.locator("xpath=ancestor::li")
		.locator('[data-slot="task-emoji"]');

const goToMe = (page: Page) => page.getByRole("link", { name: "Me" }).click();
const goToToday = (page: Page) =>
	page.getByRole("link", { name: "Today", exact: true }).click();

/** Presses Download on Me and waits until suggestions are on. */
async function downloadFromMe(page: Page) {
	await goToMe(page);
	await page.getByRole("button", { name: "Download" }).click();
	await expect(page.getByText("Emoji suggestions are on")).toBeVisible({
		timeout: MODEL_TIMEOUT,
	});
}

/** Names the model files that were stored for the current version in the Cache API. */
const storedModelFiles = (page: Page, base: string) =>
	page.evaluate(async (prefix) => {
		const cache = await caches.open("transformers-cache");
		return (await cache.keys()).filter((request) =>
			new URL(request.url).pathname.startsWith(prefix),
		).length;
	}, base);

test("a device that has not downloaded anything never asks for the model, and behaves as before", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 375, height: 812 });
	const modelRequests: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname.startsWith("/assets/emoji/"))
			modelRequests.push(request.url());
	});
	await signUpAndCreateGroup(page, testInfo);
	await page.goto("/");

	const sheet = await openNewTask(page);
	await sheet.getByRole("textbox", { name: "Task" }).fill("Water the plants");
	// Longer than the debounce and than the background warm-up delay.
	await page.waitForTimeout(7000);
	await expect(
		sheet.getByRole("button", { name: "Emoji: clipboard, default, change" }),
	).toBeVisible();
	await sheet.getByRole("button", { name: /^Emoji:/ }).click();
	const picker = page.getByRole("dialog", { name: "Choose emoji" });
	await expect(
		picker.getByRole("searchbox", { name: "Search emoji" }),
	).toBeVisible();
	await expect(picker.getByRole("heading", { name: "Suggested" })).toHaveCount(
		0,
	);
	await picker.getByRole("button", { name: "Use default" }).click();
	await sheet.getByRole("button", { name: "Create", exact: true }).click();
	await expect(tileGlyph(page, "Water the plants")).toHaveText(DEFAULT_GLYPH);

	await goToMe(page);
	await expect(page.getByText("Emoji suggestions are off.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
	expect(await page.evaluate(() => caches.keys())).not.toContain(
		"transformers-cache",
	);
	expect(modelRequests).toEqual([]);
});

test.describe("with the model files", () => {
	test.skip(
		!emojiModelPresent() && !process.env.CI,
		"the emoji model files are not fetched",
	);

	test("Download on Me, then suggestions follow the title, also from the stored copy after a reload", async ({
		page,
		context,
		browserName,
	}, testInfo) => {
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 375, height: 812 });
		await signUpAndCreateGroup(page, testInfo);
		await page.goto("/");
		await downloadFromMe(page);
		await expect(
			page.getByRole("button", { name: "Remove download" }),
		).toBeVisible();

		await goToToday(page);
		let sheet = await openNewTask(page);
		await sheet.getByRole("textbox", { name: "Task" }).fill("Water the plants");
		await expectSheetGlyphIn(sheet, PLANTS);
		await sheet.getByRole("button", { name: "Create", exact: true }).click();
		await expect
			.poll(async () =>
				isOneOf(await tileGlyph(page, "Water the plants").innerText(), PLANTS),
			)
			.toBe(true);

		// The model is stored on the device: with the network blocked for the model files, a
		// reload still suggests, and nothing is downloaded again.
		expect(await storedModelFiles(page, emojiAssetsPath())).toBe(6);
		await page.route("**/assets/emoji/**", (route) => route.abort());
		await page.reload();
		await goToMe(page);
		await expect(page.getByText("Emoji suggestions are on")).toBeVisible();
		await goToToday(page);
		sheet = await openNewTask(page);
		await sheet.getByRole("textbox", { name: "Task" }).fill("Walk the dog");
		await expectSheetGlyphIn(sheet, DOGS);

		// Chromium can also reload the app with the whole network off (Playwright's WebKit cannot
		// reload a service-worker page while offline; app.spec.ts has the same limit).
		if (browserName === "chromium") {
			await sheet.getByRole("button", { name: "Close" }).click();
			await page.evaluate(() => navigator.serviceWorker.ready);
			await context.setOffline(true);
			await page.reload();
			sheet = await openNewTask(page);
			await sheet.getByRole("textbox", { name: "Task" }).fill("Feed the cat");
			await expectSheetGlyphIn(sheet, CATS);
			await context.setOffline(false);
		}
	});

	test("Remove download deletes the stored model and returns to the default", async ({
		page,
	}, testInfo) => {
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 375, height: 812 });
		await signUpAndCreateGroup(page, testInfo);
		await page.goto("/");
		await downloadFromMe(page);
		expect(await storedModelFiles(page, "/assets/emoji/")).toBe(6);

		await page.getByRole("button", { name: "Remove download" }).click();
		await expect(page.getByText("Emoji suggestions are off.")).toBeVisible();
		await expect.poll(() => storedModelFiles(page, "/assets/emoji/")).toBe(0);

		await goToToday(page);
		const sheet = await openNewTask(page);
		await sheet.getByRole("textbox", { name: "Task" }).fill("Walk the dog");
		await page.waitForTimeout(1500);
		await expect(
			sheet.getByRole("button", { name: "Emoji: clipboard, default, change" }),
		).toBeVisible();
		await sheet.getByRole("button", { name: "Close" }).click();
		await page.reload();
		await goToMe(page);
		await expect(page.getByText("Emoji suggestions are off.")).toBeVisible();
	});

	test("a task saved while the model is still downloading gets an emoji afterwards, and the emoji reaches the server", async ({
		page,
	}, testInfo) => {
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 375, height: 812 });
		await signUpAndCreateGroup(page, testInfo);

		// Hold the model download until the task has been saved.
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(
			`**${emojiModelPath("onnx/model_quantized.onnx")}`,
			async (route) => {
				await gate;
				await route.continue();
			},
		);

		await page.goto("/");
		await goToMe(page);
		await page.getByRole("button", { name: "Download" }).click();
		await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
		await goToToday(page);
		const sheet = await openNewTask(page);
		await sheet.getByRole("textbox", { name: "Task" }).fill("Walk the dog");
		await sheet.getByRole("button", { name: "Create", exact: true }).click();
		await expect(tileGlyph(page, "Walk the dog")).toHaveText(DEFAULT_GLYPH);

		release();
		await expect
			.poll(
				async () =>
					isOneOf(await tileGlyph(page, "Walk the dog").innerText(), DOGS),
				{ timeout: MODEL_TIMEOUT },
			)
			.toBe(true);

		// The late pick is an ordinary update: the server stores the emoji and leaves the colour alone.
		await expect
			.poll(
				async () => {
					const pull = await page.request.get("/api/sync/pull?cursor=0");
					const body = (await pull.json()) as {
						tasks: {
							title: string;
							emoji: string | null;
							color: string | null;
						}[];
					};
					const task = body.tasks.find((item) => item.title === "Walk the dog");
					return (
						task !== undefined &&
						isOneOf(task.emoji ?? "", DOGS) &&
						task.color === "blue"
					);
				},
				{ timeout: 30_000 },
			)
			.toBe(true);
	});

	test("Cancel stops a download and leaves nothing behind", async ({
		page,
	}, testInfo) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 375, height: 812 });
		await signUpAndCreateGroup(page, testInfo);
		await page.route(`**${emojiModelPath("onnx/model_quantized.onnx")}`, () => {
			// Never answered: the download stays in progress until it is cancelled.
		});
		await page.goto("/");
		await goToMe(page);
		await page.getByRole("button", { name: "Download" }).click();
		await expect(page.getByText(/^Downloading…/)).toBeVisible();
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByText("Emoji suggestions are off.")).toBeVisible();
		await expect.poll(() => storedModelFiles(page, "/assets/emoji/")).toBe(0);
	});

	test("an update is offered on Me only, and nothing is downloaded until Download is pressed", async ({
		page,
	}, testInfo) => {
		test.setTimeout(240_000);
		await page.setViewportSize({ width: 375, height: 812 });
		// This device downloaded an older version earlier.
		await page.addInitScript(() => {
			localStorage.setItem("tagteam.emoji.optedIn", "true");
			localStorage.setItem("tagteam.emoji.installed", "an-older-version");
		});
		const modelRequests: string[] = [];
		page.on("request", (request) => {
			if (new URL(request.url()).pathname.startsWith("/assets/emoji/"))
				modelRequests.push(request.url());
		});
		await signUpAndCreateGroup(page, testInfo);
		await page.goto("/");

		const sheet = await openNewTask(page);
		await sheet.getByRole("textbox", { name: "Task" }).fill("Water the plants");
		await page.waitForTimeout(7000);
		await expect(
			sheet.getByRole("button", { name: "Emoji: clipboard, default, change" }),
		).toBeVisible();
		// Nothing outside Me mentions an update.
		await expect(page.getByText(/update/i)).toHaveCount(0);
		await sheet.getByRole("button", { name: "Close" }).click();
		expect(modelRequests).toEqual([]);

		await goToMe(page);
		await expect(page.getByText("An update is available.")).toBeVisible();
		await page.getByRole("button", { name: "Download" }).click();
		await expect(page.getByText("Emoji suggestions are on")).toBeVisible({
			timeout: MODEL_TIMEOUT,
		});
		expect(modelRequests.length).toBeGreaterThan(0);
	});
});
```

What it proves, per browser:
1. **A fresh device never asks for the model** (runs even without model files): sign up, open Today, type a title in the New task sheet, wait longer than the debounce and the 5 s background delay, open the picker (no "Suggested" row, the default emoji stays), create the task (tile 📋), open Me ("Emoji suggestions are off." and a Download button, no `transformers-cache`), and **not one request** to `/assets/emoji/` was made.
2. **Download on Me, then suggestions:** press Download, wait for "Emoji suggestions are on", then the sheet's emoji follows "Water the plants" and the Today tile carries it; with the network blocked for `/assets/emoji/**` and the page reloaded, Me still says on and "Walk the dog" gets a dog emoji from the stored copy (all six files are in the cache); in Chromium it also reloads with the whole network off and suggests for "Feed the cat".
3. **Remove download** deletes the stored files (0 entries under `/assets/emoji/`), shows "Emoji suggestions are off.", the sheet stops suggesting, and it stays off after a reload.
4. **Late pick:** with the weights download held back, press Download, create "Walk the dog" while "Cancel" is showing (tile shows 📋), release the download: the tile gets a dog emoji and the server stores it with the colour still blue.
5. **Cancel** stops a download that never finishes and leaves nothing in the cache.
6. **Update:** a device that downloaded an older version ("an-older-version" in `tagteam.emoji.installed`) makes no model request, shows "An update is available." on Me **and nowhere else** (no text matching /update/i on Today or in the sheet), and Download installs the new version.

- [ ] **Step 3: Run the end-to-end suite**

Needs the model files in `public/` before the build: `pnpm --filter @tagteam/web emoji:assets`.

Run: `pnpm --filter @tagteam/web e2e`
Expected: PASS in both projects, 18 tests: `app`, `suggestions`, `task-look` and the six emoji tests, twice (about 40 s). This task adds no production code, so a failure is a real defect in Tasks 1–10: report it with the failing assertion rather than weakening the test. Without the model files (and without `CI` set) the five model tests are skipped and the first emoji test still runs.

- [ ] **Step 4: CI**

In `.github/workflows/ci.yml`, in the `e2e` job, replace

```yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @tagteam/web exec playwright install --with-deps chromium webkit
      - run: pnpm --filter @tagteam/web e2e
```

with

```yaml
      - run: pnpm install --frozen-lockfile
      - name: Fetch the emoji model
        run: pnpm --filter @tagteam/web emoji:assets
      - run: pnpm --filter @tagteam/web exec playwright install --with-deps chromium webkit
      - name: Emoji worker smoke test
        run: pnpm --filter @tagteam/web smoke:emoji-worker
        env:
          EMOJI_SMOKE_REQUIRE_MODEL: "1"
      - run: pnpm --filter @tagteam/web e2e
```

The `image` job needs no change: the Dockerfile fetches the model itself (Task 2). The `test` job needs no model. If `actionlint` is installed, run it on the file; otherwise say it was not run.

- [ ] **Step 5: README**

In `README.md`, in the "Development" section, after the `pnpm test && pnpm typecheck && pnpm lint` line add:

```bash
pnpm --filter @tagteam/web emoji:assets        # emoji model files (49 MB, from Hugging Face; git-ignored)
```

and replace the paragraph that starts "Build and run the image locally:" with:

````markdown
Emoji suggestions are opt-in: a person turns them on from **Me → Emoji suggestions → Download**, which
downloads a small model (about 49 MB) from your own TagTeam server once; nothing is downloaded
otherwise. The model is not in git: the build fetches `Xenova/bge-small-en-v1.5` from Hugging Face at the
revision pinned in `apps/web/emoji-assets.json`, verifies every file's SHA-256, and copies the ONNX
Runtime wasm from `node_modules`. Run `pnpm --filter @tagteam/web emoji:assets` once in a checkout to try
the feature in `pnpm --filter @tagteam/web dev`; without the files the app works and the Download button
reports that it could not download.

Build and run the image locally (the build needs network access to huggingface.co; the image grows
by about 49 MB):

```bash
docker build -t tagteam:local .
docker build --build-arg SKIP_EMOJI_MODEL=1 -t tagteam:local .   # without the model: the Download button fails for everyone
```
````

(and delete the old fenced `docker build -t tagteam:local .` block that this replaces).

- [ ] **Step 6: Visual check at 375 × 812, light and dark**

Needs `.claude/launch.json`'s `server` (3000) and `web` (5173), `apps/server/.env` with `AUTH_SECRET` and `BASE_URL=http://localhost:5173` (create it with `printf 'AUTH_SECRET=%s\nBASE_URL=http://localhost:5173\n' "$(openssl rand -base64 32)" > apps/server/.env` if missing), and the model files (`emoji:assets`).

1. `preview_start` `server`, then `web`; open `http://localhost:5173/sign-in`, `resize_window` 375 × 812, create a local test account and a group. In DevTools or `read_network_requests`, confirm that no request to `/assets/emoji/` happens while you use Today, the sheet and Me.
2. New task sheet on a fresh device: type "Water the plants": the emoji stays the clipboard; open the picker: no "Suggested" row. Me: the "Emoji suggestions" section reads "Emoji suggestions are off." with the helper text and a full-width **Download** button of at least 44 px (`javascript_tool`: measure it). Screenshot light and dark.
3. Press Download: "Downloading… N%" with a bar, **Cancel** present; then "Emoji suggestions are on", "They work offline." and **Remove download**. Screenshot light and dark.
4. Back on Today, add task, type "Water the plants": the emoji changes from the clipboard to a related emoji about a second later; colour and the rest of the sheet do not change. Open the emoji circle: the "Suggested" row shows up to three emoji; type "laundry" in the search: meaning-based matches follow the keyword matches.
5. Reload: Me still says on (no download), and the sheet suggests again. **Remove download** → "Emoji suggestions are off." and the sheet stops suggesting.
6. Check the section's contrast in light and dark by eye; fix anything wrong, re-run the affected tests, `preview_stop` both servers, remove temporary data.

- [ ] **Step 7: iOS Simulator check (only the controller can do this)**

Use `mcp__Claude_Code_iOS_Simulator__control`: `attach` first, then build and serve the production app (`pnpm --filter @tagteam/web exec vite build`, then `AUTH_SECRET=… BASE_URL=http://localhost:3000 PORT=3000 WEB_DIR=$PWD/apps/web/dist DATABASE_PATH=/tmp/tagteam-sim.db pnpm --filter @tagteam/server start`), `open_url` `http://localhost:3000/sign-in`, sign in. Record: (a) nothing downloads until Download is pressed on Me; (b) Download shows progress and ends at "Emoji suggestions are on", and how long it took; (c) a suggestion appears for a typed title; (d) stop the server, relaunch the page: the app opens from the service worker, Me still says on, and the New task sheet still suggests (the model comes from the Cache API); (e) Remove download returns to the default; (f) `navigator.storage.persisted()` in a Safari tab is expected to be false (iOS grants it to the installed Home Screen app only). If the simulator cannot be driven, say so in STATUS instead of claiming it passed. A real iPhone (speed, memory, eviction over days) stays a follow-up.

- [ ] **Step 8: Amend the spec**

In `docs/superpowers/specs/2026-10-01-task-look-and-emoji-design.md`:

1. §2 table: replace the row `| Opt-out | A device-local toggle in Me. Off means no model download on that device |` with `| Opt-in | The model is not downloaded unless the person presses "Download" in an "Emoji suggestions" section on Me (owner decision, 2026-10-02). Default off: a device that has not opted in behaves as without the feature, and nothing is ever downloaded automatically. "Remove download" deletes it and returns to the default |`.
2. §6 "Me" subsection: replace the paragraph `A toggle "Emoji suggestions", on by default, stored on the device. Turning it off stops the engine and deletes the cached model on that device.` (it is wrapped over two lines) with:

```markdown
A section "Emoji suggestions", device-local. Not downloaded (the default): a helper sentence (about
49 MB, one-time, works offline afterwards, Wi-Fi is best) and a "Download" button. Downloading:
progress and "Cancel". Ready: "Emoji suggestions are on" and "Remove download", which stops the
engine, deletes the stored model of every version, and returns to the default. Failed: one plain
sentence (offline, storage full, could not load, stopped after repeated problems) and "Try again".
A switch-off after two crashes, a browser that evicted the stored model, and an update (a new asset
version; the old download is unusable with the new build) show their explanation here, with
"Download" again. This section is the only place any of that is shown. A device that has not
downloaded the model has engine status `off`: the sheet shows the default emoji, the picker has no
"Suggested" row, and no task is listed for a late pick, so tasks created before the person opts in
are never late-picked.
```

3. §7 "Loading" bullet: replace it (it starts `- **Loading.** The worker starts when the New task sheet first opens…` and ends `…not in a loop.`) with: `- **Loading.** Only on a device that has downloaded the model, and only from its stored copy: the worker starts when the New task sheet first opens and about five seconds after the first successful sync. Neither ever uses the network; the one download is the person's "Download" press. A failed download shows its reason on Me with "Try again" and is never retried automatically.`
4. §7 failure handling: change `The engine has four states: \`off\` (toggle), \`loading\`, \`ready\`, \`unavailable\`.` to `The engine has four states: \`off\` (the person has not downloaded the model), \`loading\`, \`ready\`, \`unavailable\`.` and edit the table rows: the first row's handling to `\`unavailable\` for this app start; Me shows the reason with "Try again"; an opt-in whose first download never finished lapses at the next start`; "Load takes longer than 60 s" to "A load, or a download, makes no progress for 60 s" (handling unchanged); the corrupt-cache handling to `this version's Cache API entries are deleted and the download is forgotten, so "Try again" downloads again`; the crash-marker row's tail `Two strikes turn the Me toggle off on that device with a one-line explanation there` to `Two strikes switch suggestions off on that device, delete the stored model, and Me shows a one-line explanation with "Download" again`; the "Three app starts in a row" row's tail to `…until the asset version changes or the person presses "Download" again`.
5. §7, the sentence `An operator can switch the feature off for everyone by building the image without the model files: every device then lands in \`unavailable\`.` becomes `An operator can switch the feature off for everyone by building the image without the model files: the "Download" button then fails (the files answer 404) and devices stay at the default.`
6. §7 "Auto-pick candidates": replace the sentence "This exclusion is adopted only if first-pick accuracy on the evaluation set does not drop." with: "This exclusion is adopted only if first-pick accuracy on the evaluation set does not drop. Evaluated on 2026-10-02 on the shipped index (Plan 10, `pnpm --filter @tagteam/web emoji:eval`): first pick right 46 of 79 without and 45 with the exclusion, so it is **not adopted** and the flag `AUTO_PICK_EXCLUSION` is `false`; the code stays, tested." (use the numbers Task 10 printed if they differ).
7. §7, after the paragraph that starts "Measured in the spike": add "Re-measured in Plan 10 on the repo's catalog with the node-built index (79 titles): right emoji first 58% (46), in the top three 78% (62); full precision 57% and 78%; sign bits alone 44% and 75%."
8. §9 first sentence: replace "Served under one versioned path, `/assets/emoji/{version}/`, which the server already marks immutable because it contains `/assets/`." with "The model and the wasm are served under one versioned path, `/assets/emoji/{version}/` (the version is a hash of every model and runtime file checksum, so a revision bump with identical files keeps it), which the server marks immutable because it contains `/assets/`. A device fetches them only when the person presses \"Download\". A missing file under `/assets/` answers 404, never the app shell."
9. §9 table, first row: replace with `| \`catalog.json\` (a hashed chunk), \`bits.bin\`, \`int8.bin\` (hashed assets committed under \`src/features/emoji/index/\`) | about 0.9 MB | yes | service worker precache |`.
10. §9 bullet "A script fetches the model…": append "The pin lives in `apps/web/emoji-assets.json` (revision, sizes, SHA-256); the script fails the build on a checksum mismatch or a failed download and `SKIP_EMOJI_MODEL=1` is the explicit opt-out. The committed index records a digest of the model files it was built for."
11. §9 bullet "Serwist's precache glob gains the three catalog files.": replace with "Serwist's precache glob gains `bin` (the index files); the worker bundle is a `.js` and the catalog a chunk, both already matched."
12. §9, after "On a version change the engine deletes Cache API entries from older versions." add: "A device that downloaded an older version does not use it with a newer build (the index and the runtime are bound to the model files): Me shows \"An update is available.\" with \"Download\", nothing else in the app shows it, and the old files are deleted when the new version is installed or the person removes the download."

- [ ] **Step 9: Update `docs/STATUS.md`**

Make these edits. Use the date of the day you finish (`date +%F`), state only what actually passed in Steps 3, 6 and 7, and copy the evaluation numbers from Task 10's report. The sentence-style lines below describe what to write; write the real values, not the descriptions.

1. Replace the `_Last updated: …_` line with `_Last updated: 2026-MM-DD (Plan 10 emoji suggestions complete)._` with `MM-DD` replaced by the real date.
2. Change the heading ``## Done (on `main`; CI green through Plan 7, Plans 8 and 9 not yet run in CI)`` to ``## Done (on `main`; CI green through Plan 7, Plans 8, 9 and 10 not yet run in CI)`` and add after the Plan 9 row:

```markdown
| 10 emoji suggestions | opt-in on-device emoji suggestions from the task title (bge-small-en-v1.5 in a Web Worker, downloaded from Me), automatic emoji in the New task sheet, late picks, evaluation script | Spec: `2026-10-01-task-look-and-emoji-design.md` |
```

3. Insert before `## Next plans`:

```markdown
## Complete — Plan 10: emoji suggestions

Plan: `docs/superpowers/plans/2026-10-02-10-emoji-suggestions.md` (Tasks 1-11). Per-task ledger: git-ignored
`.superpowers/sdd/2026-10-02-10-emoji-suggestions/` in the working checkout.

- **Opt-in (owner decision 2026-10-02):** nothing downloads unless the person presses Download in the
  "Emoji suggestions" section on Me (Cancel while downloading, Remove download when ready, Try again after a
  failure, an update shown only there). A device that has not opted in behaves as in Plan 9 (engine status `off`).
  Only a device that already downloaded the model loads it, from its stored copy, on the New task sheet or 5 s
  after the first sync.
- Model delivery: `@huggingface/transformers` 4.3.0 (exact) is imported only by `src/features/emoji/worker.ts`
  (a module worker; Vite `worker.format: "es"` plus `build-plugins/no-ort-default-wasm.ts`, which keeps ORT's
  26.9 MB default wasm out of the build). The model files are **not in git**: `apps/web/emoji-assets.json` pins
  `Xenova/bge-small-en-v1.5` at revision `ea104dacec62c0de699686887e3f920caeb4f3e3` with SHA-256s;
  `pnpm --filter @tagteam/web emoji:assets` (`-- --update` re-pins) downloads and verifies them and copies the ORT
  wasm from `node_modules` into `apps/web/public/assets/emoji/<version>/` (git-ignored; the version hashes the file
  checksums, currently `db5f70d71a67`). The Dockerfile runs it in its own layer after `pnpm install`
  (`--build-arg SKIP_EMOJI_MODEL=1` builds without it); CI's `e2e` job runs it. The server answers 404 for a missing
  `/assets/` file. On Download the worker fetches the six files itself (one request each, with progress) into the
  Cache API.
- Index: `search.ts` (sign-bit Hamming shortlist of 40, int8 re-rank), `index/{bits.bin,int8.bin,index.json}` built
  by `pnpm --filter @tagteam/web emoji:index` from `catalog.json` (a test fails if the catalog or the model files change
  without a rebuild), delivered as hashed assets and precached with the `bin` glob.
- Engine: `controller.ts` implements every row of the spec §7 failure table (tests with a `FakeWorker`); persisted
  state in `localStorage` (`tagteam.emoji.optedIn|installed|autoOff|state`); `EmojiEngineHost` provides the engine,
  the Me settings, the warm-up, and `LatePicks`. A stored copy of an older asset version is never used ("An update
  is available." on Me only).
- Sheet and tasks: automatic emoji (300 ms, 3+ characters, never Edit, never colour, stale results dropped);
  device-local awaiting list in Dexie `meta` (`awaitingEmoji`) for tasks created without an emoji (sheet or accepted
  suggestion, not while the engine is `off`); late picks one at a time, one attempt, emoji only.
- Evaluation: `pnpm --filter @tagteam/web emoji:eval` on the 79 labelled titles (`scripts/emoji-eval-titles.json`):
  first right and in the top 3, of 79, for full precision, sign bits alone, the shipped search, and the shipped
  search with the exclusion (copy the four rows Task 10 printed). The auto-pick exclusion (flags, symbols, clock
  faces) is adopted or not adopted as the verdict says, and `AUTO_PICK_EXCLUSION` is set to match.
- Checks: one sentence naming which of `pnpm test`, typecheck, lint, the Playwright suite in WebKit and Chromium
  (18 tests), the worker smoke test, the 375 × 812 light and dark visual check and the iOS Simulator check passed
  on that date, and which were not run.
- Not verified: a real iPhone (speed, memory, eviction over days), the installed-app `persist()` grant, and, unless
  you ran them, the Docker build and GitHub Actions.
```

4. In `## Next plans` delete the whole "Plan 10: emoji suggestions" bullet and its sub-bullets, keeping the closing out-of-scope line as a new bullet: "- Out of scope (spec §13): subtasks, goals, tags, automatic colour, notes in the sheet, per-task reminder row, custom emoji, skin tones, non-English suggestion quality, multi-threaded inference." and add the owner's follow-up: "- **Later (owner, 2026-10-02):** an in-app tutorial for using the app, which can include the emoji suggestions download option that today lives only on Me."
5. In `## Decisions to know` append:

```markdown
- Emoji suggestions are opt-in (Me → Download); the model is fetched at build time, never committed; the folder name
  is a hash of every model and runtime file checksum, so a new model is a new immutable URL and a revision bump with
  identical files changes nothing. The engine's persisted state is in `localStorage` (synchronous, survives a crash,
  not cleared by sign-out); the awaiting-emoji list is in Dexie `meta`. The auto-pick exclusion list exists but is off
  (`AUTO_PICK_EXCLUSION`) because the evaluation did not allow it. The picker's "Suggested" row and search are never
  filtered. A late pick stamps `Date.now()` and only runs after a successful sync. An older download is never used by a
  newer build.
```

6. Add a `## Notes for the owner` bullet list entry (create the heading after `## Remaining follow-ups` if none exists) with: "Emoji suggestions are opt-in on Me (your 2026-10-02 decision); a later in-app tutorial can include the download option. The download is about 49 MB from your own server, on whatever network the device is on (the helper text says Wi-Fi is best; there is no Wi-Fi-only check). An update to the model shows only on Me."
7. In `## Remaining follow-ups` append:

```markdown
- Emoji suggestions: check on a real iPhone (speed, memory, eviction over days); the stored model can be evicted by the
  browser, in which case Me offers Download again.
- If Hugging Face rate-limits CI, add an `actions/cache` step for `apps/web/public/assets/emoji` in the `e2e` job.
```

- [ ] **Step 10: Full verification and commit**

Run: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`
Expected: all PASS (core 103, server 113, web 461).

```bash
git add .github/workflows/ci.yml README.md docs/STATUS.md docs/superpowers/specs/2026-10-01-task-look-and-emoji-design.md apps/web/e2e
git commit -m "test(web): cover emoji suggestions end to end; CI fetches the model; update status, README and spec"
```

---

## Carry-over notes

- **Where things are.** Engine: `apps/web/src/features/emoji/` (`controller.ts` state machine, `worker*.ts`, `search.ts`, `index/`, `EmojiEngineHost.tsx`, `late-pick.ts`); the Me section: `apps/web/src/features/me/EmojiSuggestionsSettings.tsx`. Delivery: `apps/web/emoji-assets.json`, `apps/web/scripts/{emoji-assets,fetch-emoji-assets,build-emoji-index,eval-emoji}.mjs`, `Dockerfile`, `.github/workflows/ci.yml`.
- **Later (owner, 2026-10-02):** an in-app tutorial for using the app, which can include this download option.
- **Bumping the model or transformers.js:** change the dependency (exact), run `pnpm --filter @tagteam/web emoji:assets -- --update`, review the manifest diff (a changed file checksum gives a new asset version, which shows "An update is available." on Me for devices that downloaded the old one), `emoji:assets`, `emoji:index` (the index test pins the model files' digest), `emoji:eval`, then the smoke test and the e2e. Changing `catalog.json` needs `emoji:index` too.
- **Operator switch:** `docker build --build-arg SKIP_EMOJI_MODEL=1` makes the Download button fail for everyone (the files answer 404).
- **Known limits:** about one automatic pick in four is clearly wrong (spec §14); the title that shrinks below 3 characters keeps the filled emoji; a late pick can overwrite an emoji another device set but not yet synced here; the progress bar tracks all six files but the 14 MB wasm arrives last in a burst; Playwright's WebKit cannot reload offline, so the offline reload runs in Chromium only; the evaluation set is 79 titles, so a one-title difference decides the exclusion gate.
- **Not verified here:** `docker build`, GitHub Actions, `actionlint`, a real iPhone, the iOS Simulator, the installed-app `persist()` grant.
