# Visual and performance QA

Screenshots, pixel diffs and perf comparisons of the app on `/__preview`, which runs the full client
against the in-memory server (`src/lib/preview/memory-server.ts`), so nothing needs a backend. It runs
locally, not in CI. Everything it writes goes under `.qa/` (gitignored).

```sh
npm run qa -- ab --base main                        # the redesign workflow (below)
npm run qa -- ab --base main --suite main,stress,edge --perf
npm run qa -- ab --base main --filter desktop--dark  # while iterating
npm run qa -- help                                  # every command and option
```

It needs Chromium: `QA_CHROMIUM=/path/to/chrome`, or the build playwright-core 1.56 expects
(chromium-1194) under `PLAYWRIGHT_BROWSERS_PATH` or Playwright's cache
(`npx playwright-core install chromium` installs it).

## `qa ab`: before and after a change

`qa ab --base <ref>` builds `<ref>` and your working tree (or `--head <ref>`) each in its own snapshot
under `.qa/snap/`, serves both on free ports, shoots every suite on both, and writes
`.qa/runs/<time>-<ref>/index.html`: each changed shot with before|after crops of each changed region and
links to the full screenshots and diff. It prints one line per suite, such as `main: 110/110 identical`.

- Snapshots: the ref comes from `git archive` (plus its `protocol` submodule commit when the local
  submodule has it), the working tree from its tracked and untracked files. Both link the checkout's
  `node_modules` (`--install` runs `npm ci` instead, for a base with other dependencies). A ref's build is
  cached by commit (`--rebuild` redoes it, `qa clean` drops them); the working tree's is removed after the
  run (`--keep` keeps it). Rebuilding the checkout mid-run can't change what a comparison serves.
- Each shot is taken on both builds back to back, alternating which goes first, so a busy machine slows
  both alike. Waits are fixed, so a scene can flake under load: a failing scene is retried
  (`--retries`, default 1), and everything that differed or failed is shot again on both sides; a
  difference that doesn't repeat is reported as flaky, not changed (`--no-recheck` skips this).
- `--jobs` (default 2) runs that many scenes at once; use 1 on a slow or busy machine.

## Other commands

```sh
npm run qa -- serve .qa/snap/<sha>/build                 # serve a build (prints its URL)
npm run qa -- shoot --url http://127.0.0.1:4173 --suite edge --out .qa/shots/mine --clean
npm run qa -- diff .qa/shots/base .qa/shots/mine          # summary + diff PNGs; exit 1 if any differ
npm run qa -- compare .qa/shots/base .qa/shots/mine --out .qa/cmp   # + crops and index.html
npm run qa -- perf --url http://127.0.0.1:4001 --url http://127.0.0.1:4002 --runs 7
npm run qa -- prof --url http://127.0.0.1:4001 --url http://127.0.0.1:4002
npm run qa -- sheet .qa/sheet.json                        # curated before/after panels as one PNG
```

- `perf` loads each URL in a fresh, cache-disabled context at 4× CPU throttle (`--cpu`), strictly
  interleaved (AB, BA, AB…), and measures load (ready, FCP, LCP, CLS, script/layout/style time, long
  tasks, heap) and each of the suite's `interactions` (frames, worst and p95 frame, jank, layout/style/
  script time). It prints `median [min–max]` per URL and the Δ against the first, marked `~` when the
  ranges overlap (noise), and writes all samples as JSON. Use several runs (5–7) and read the spread:
  the machine may be busy, and it warns when its load average is high. `--only load,type-composer` picks
  probes; `qa ab --perf` runs it on both builds and adds bundle sizes.
- `prof` CPU-profiles page load and lists the functions whose self time changed most.
- `sheet` takes `{ "panels": [{ "title", "note", "before", "after", "box": [l, t, r, b], "scale" }] }`
  (paths relative to the spec; `before` optional) and renders it with real text, for a PR description.

Shot ids are `<scene>--<viewport>--<theme>.png` (extra shots add `--<suffix>`); `--filter` keeps the ids
containing any of its comma-separated parts.

## Adding a suite

A suite is a file in `scripts/qa/suites/`; its name is the file name (`--suite <name>`). Add one for each
redesign whose states the existing suites don't reach:

```js
// scripts/qa/suites/threads.js
import { VIEWPORTS, openRoom, send } from '../lib/helpers.js';

export default {
	description: 'Thread list and thread view states.',
	viewports: { desktop: VIEWPORTS.desktop, phone: VIEWPORTS.phone },
	themes: ['light', 'dark'],
	scenes: [
		{ name: 'thread-open', steps: (p) => openRoom(p, 'Deploy checklist') },
		{
			name: 'thread-reply',
			viewports: ['desktop'],
			steps: async (p) => {
				await openRoom(p, 'Deploy checklist');
				await send(p, 'Looks good to me.');
			}
		}
	]
};
```

Each scene runs in a fresh context: fixed clock (`NOW`), reduced motion, device scale 1 unless the
viewport says otherwise, the preview loaded and fonts ready; then `steps(page, t)`, then the screenshot.
Scenes can also set `viewports` / `themes` (subsets), `context(context, t)` (before the page opens, e.g.
`rewriteBundle` to change the seed data; the scene fails if a rewrite stops matching), `extra(page, t)`
(after the shot; `await t.shot('suffix')` takes more) and `timeout`. Suite-level options: `timeout`
(default 5000 ms), `settle` (wait after load, 500 ms), `path` (`/__preview`), `beforeShot(page, t)`,
`extra`, `contextOptions`, and `interactions` (perf probes: `{ name, viewport?, setup?(page),
action(page), settle? }`; see `main.js`).

Use the helpers in `lib/helpers.js` rather than raw clicks: `press` taps on touch viewports and clicks
elsewhere, `send` presses Send (Enter inserts a newline on phones), `roomsPane`, `openRoom`,
`showMembers` and `rename` handle the one-pane layout under 720px, and `react` taps the picker's search
on touch. `t` carries `viewport`, `theme`, `touch` and `narrow`. Check a new suite with
`npm run qa -- shoot --suite threads --url <served build>` and look at the PNGs before relying on it.
