# Working on apron-web

The repo needs Node 24 or later (`engine-strict`).

## Testing while you iterate

Run only the tests that cover what you changed. Leave the full suites for the final check.

- **Unit tests:** run the files you touched and their neighbours, e.g. `npx vitest run src/lib/ui/session`. Test files that use `vi.mock` run isolated on their own; nothing else is needed for them.
- **Types:** `npm run check` when you changed types or component props.
- **e2e:** the specs serve `build/`, so build the preview once and rebuild after app changes: `APRON_PREVIEW=1 npx vite build`. Then run the specs for what you touched: `npx playwright test -c e2e/playwright.config.ts e2e/<spec>.spec.ts`.
- **Broad UI changes:** use `npm run e2e:short` (~1 min). It skips the slowest specs and tests tagged `@full`.

**Final check**, once, before pushing for review or merging:

```sh
npm test && npm run check && npm run e2e && npm run qa -- budget --build build
```

`npm run e2e` rebuilds `build/` with the preview, which the budget then uses.

## Keeping the app fast

- **Run the perf budget** (`npm run qa -- budget --build build`) when a change touches rendering, reactivity, CSS or startup code. It compares exact counts (layouts, style recalcs, DOM nodes, requests, startup JS, heap) against `scripts/qa/perf-budget.json`, and CI runs it too.
  - If it fails, find the cause before anything else.
  - Run `--update` only when the cost is intended or a saving is real. Say which in the commit message.
- **Measure in counts, not timings.** Timings on a shared machine swing by tens of percent. `qa perf` and `qa prof` are for digging further (see `scripts/qa/README.md`).
- **Reactivity:** each client snapshot is a new object.
  - Read the session's parts (`session.rooms`, `session.activeRoom`, `session.room(id)`), not `session.snapshot`. Anything that reads the whole snapshot re-runs on every message.
  - Keep derived arrays and objects the same when their contents are the same (`steady()` in `Sidebar.svelte` and `src/lib/ui/timeline.ts`), so rows don't redraw.
  - Effects that read layout (`scrollHeight`, `getComputedStyle`, `getBoundingClientRect`) force a layout each time they run. Run them only when what they measure can have changed.
- **CSS:** avoid `:has()` on large subtrees; a class set from state is cheaper. Keep `prefers-reduced-motion` rules specific enough to win.
- **Startup:** new code loads with the app unless it is imported on demand (`src/lib/components/lazy.ts`). Watch `startupJsKB` in the budget.
