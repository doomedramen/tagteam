# Implementer rules (read fully before starting)

- Implement exactly what your brief specifies. Where the brief has tests: TDD — write failing test, run it (RED), implement, run (GREEN). Record evidence.
- Work in /Users/martin/Developer/tagteam directly on branch main (commit on main; do not create branches or worktrees). Never push.
- You do NOT dispatch subagents — no helpers, no reviewers. Do all work yourself.
- If something is unclear or the plan looks wrong, stop and report NEEDS_CONTEXT / BLOCKED with specifics. Never weaken a test expectation or add unrequested code to make something pass — report instead.
- Keep files as the plan structures them. Don't overbuild (YAGNI).
- Iterate with focused tests (`pnpm --filter <pkg> test -- <file>`); before committing run once: `rtk proxy pnpm test && rtk proxy pnpm typecheck && rtk proxy pnpm format && rtk proxy pnpm lint`.
- Always run lint/format via `rtk proxy pnpm lint` / `rtk proxy pnpm format` (plain `pnpm lint` is rewritten by an RTK shell hook that falsely reports "terminated abnormally"). Prefer `rtk proxy <cmd>` whenever you need raw output. Biome uses tabs + double quotes; reformatting plan code is expected.
- A dev server may be running on port 3000 (controller's) — leave it alone.
- Clean up anything you start: background servers, containers, temp dirs.
- Commits: Conventional Commits, exactly the message in the brief. NEVER add Co-authored-by or any attribution trailer. NEVER use --no-verify.
- Harmless noise: ~/.npmrc GITHUB_TOKEN warning; @better-auth/passkey peer-dep warning.
- Self-review your own diff before reporting.

## Report
Write full report to your REPORT_FILE: what implemented, tests + results, TDD/verification evidence (commands + key output), files changed, self-review findings, concerns.
Then reply ONLY (<15 lines): Status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), commits (short SHA + subject), one-line test summary, concerns, report file path.

## After review findings
If resumed with findings: fix, re-run covering tests, APPEND a fix report (changes, tests, command, output) to the same report file, reply with same short contract.
