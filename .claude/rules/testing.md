# Testing rules

- New business logic (anything beyond a trivial pass-through) needs a Vitest unit test in
  the same PR.
- New user-facing flows (a new form, a new page, a multi-step wizard) need a Playwright
  e2e test covering the happy path plus at least one error/validation case.
- Don't mark a UI change "done" without using `/verify` or the `browser-tester` subagent
  to confirm it actually renders and works in a running browser — passing `tsc` and unit
  tests is necessary but not sufficient for UI work.
- Redis Stream consumers need a test that feeds a malformed message and confirms the
  consumer logs/handles it instead of crashing.
