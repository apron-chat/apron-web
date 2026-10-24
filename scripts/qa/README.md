# Visual and performance QA

Screenshots, pixel diffs and perf comparisons of the app on `/__preview`, which runs the full client
against the in-memory server (`src/lib/preview/memory-server.ts`), so nothing needs a backend; and the
browser tests in `e2e/` (`npm run e2e`, [below](#npm-run-e2e-the-browser-tests)). They run locally, not in
CI. Everything they write goes under `.qa/` (gitignored). `/__preview` exists only in builds made with
`APRON_PREVIEW=1` (and under `vite dev`): the QA snapshots and `npm run e2e` set it, and a production `npm run build`
leaves the page and its code out. To serve a build of your own here, make it with `APRON_PREVIEW=1 npm run build`.

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

## `npm run e2e`: the browser tests

`e2e/` holds Playwright tests (`@playwright/test`, in the same Chromium as the QA scripts) for what only a
real browser shows: contenteditable keys, layout geometry, history, focus and accessibility. They run
against the built `/__preview`, so they need no backend either. Like the rest of `scripts/qa`, they run
locally, not in CI.

```sh
npm run e2e                                    # build, serve build/, run everything (about 75 s)
npm run e2e -- composer layout                 # build, then only these spec files
npx playwright test -c e2e/playwright.config.ts navigation   # without rebuilding
npx playwright test -c e2e/playwright.config.ts --ui         # step through, with the page alongside
npx playwright show-report .qa/e2e/report                    # after a run: traces of what failed
```

`E2E_BUILD=<dir>` serves another build (a snapshot, a mutant); `E2E_URL=<url>` uses one already served.
Results, traces and the report go to `.qa/e2e/`. There are no retries: a test that fails once is a finding.

| Spec | Checks |
|---|---|
| `composer.spec.ts` | Mentions: `@ad`, the arrow keys and Tab make a chip that goes out as `@ada` with `mentions: ["ada"]`; Escape dismisses the picker so Enter sends the text; Backspace after a chip gives back the name; on a phone Enter is a new line. |
| `layout.spec.ts` | At 1280, 900, 390, 360 and 320px, light and dark, with long names and four roles: no role badge sliced, a name gives way only down to `--ap-name-min`, a message header is one line, nothing scrolls sideways; under 960px the member list overlays the conversation. |
| `messages.spec.ts` | A message row's controls as the page wires them: React opens the picker (its `aria-expanded` follows it) and the pick reacts to that message, a chip lists who reacted, Reply fills the composer's reply, a shift-click in select mode picks the range, an image opens full screen; a shared name's handle carries the `sender-handle` test id. |
| `navigation.spec.ts` | Room, thread and message links; Back and Forward through rooms and threads, also to a thread left since; the phone's rooms list as a history entry. |
| `privacy.spec.ts` | A server that drops `private` from a new room or thread: the app says so and doesn't open it to post in. |
| `a11y.spec.ts` | axe-core on connect, room, preferences and thread, desktop and phone: no serious or critical violation beyond `e2e/a11y-baseline.json` (per rule, by count). After fixing some, `E2E_UPDATE_A11Y=1 npm run e2e -- a11y` lowers the baseline; commit it. |
| `contract-scenes.spec.ts`, `contract.spec.ts` | The interop contract, below. |

Tests drive the app as a user does (roles and names, the test ids interop relies on) and assert the wire from
the frames the memory server recorded (`preview.sent('message')`). The memory server
(`src/lib/preview/memory-server.ts`) takes knobs from `window.__APRON_PREVIEW__`, which the `preview` fixture
sets from `test.use({ knobs })`: `seed: 'rich'` (long names with four roles, a name clash, avatars, a reply, a
mention of you, an embed of each kind, a room to browse), `dropPrivate: 'rooms' | 'threads'`, and
`capabilities` to add (`embed:upload`, `status`). With knobs set the server is `window.__apronPreview`
(`frames`, `post(room, from, body)` for a message from someone else); without them the preview is the demo,
unchanged. `preview.openRoot()` opens `/` instead, against a scripted WebSocket server (`e2e/mock-server.ts`)
for the connect screen and sign-in; every request off the machine is refused, so no test reaches a real server.

### The interop contract

apron-server-go's browser suite (`tests/interop`) finds this app's elements by test ids, accessible names and
CSS selectors. `npm run qa -- contract --from <apron-server-go>/tests/interop` (or `APRON_INTEROP_DIR`) reads
them from its specs into `e2e/interop-contract.json`, each with the interop lines that use it; commit the file.
`contract-scenes.spec.ts` walks the app through the states those tests reach and records what each shows;
`contract.spec.ts` then fails for any entry no scene showed, naming the interop tests that would break. When
one fails: keep the id or name, or change it in both repositories; or, if the state just isn't reached, add a
scene, or list it in `OUT_OF_REACH` with why (those are checked more weakly: their text must still be in the
built bundle). `KNOWN_BREAKS` lists real mismatches, as `test.fixme`, until one side is fixed. With
apron-server-go checked out beside this repository (or `APRON_INTEROP_DIR` set), the check also fails when
`interop-contract.json` is stale; `npm run qa -- contract --check` says the same.

### In CI

Not wired up, by choice. It would take: a job that runs `npx playwright install --with-deps chromium` (or
caches `~/.cache/ms-playwright`) and sets `QA_CHROMIUM` or leaves playwright-core's lookup to find it; `npm
run e2e` with `--reporter=github,html` and the `.qa/e2e/` report and traces uploaded as artifacts; about 2
minutes on 2 cores. The axe and layout results depend on the fonts installed, so the baseline would need
regenerating on the CI image (or the image's fonts pinned), and the contract freshness check would need
apron-server-go checked out next to it (or it skips).
