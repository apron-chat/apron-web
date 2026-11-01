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
- Probes named `-busy` load an account at scale (the memory server's `manyRooms` and `filler` knobs: 40
  more rooms, 1500 messages in general), where costs that grow with rooms or history show. A probe
  without an `action` measures the load, which also counts `startupJsKB`: the JS the page parses to start.
- `prof` CPU-profiles page load and lists the functions whose self time changed most.

## `qa budget`: the perf budget in CI

Timings swing by tens of percent between runs and machines; counts don't. `qa budget` loads a preview build
and runs every perf probe (3 runs, medians, under reduced motion so animations don't count per frame), then checks the counts against `scripts/qa/perf-budget.json`:
layouts and style recalcs per probe; requests, startup JS, DOM nodes and heap per load; gzipped bundle sizes.
Each may go a little over its baseline (a few layouts or style recalcs, 1% of bytes), and no further. CI runs it
on every pull request (`perf-budget` in `.github/workflows/ci.yml`), split across three runners with
`--shard 1/3` to `3/3`: each checks its share of the probes, and the first the bundle's size.

```sh
APRON_PREVIEW=1 npm run build && npm run qa -- budget         # check the build in build/
npm run qa -- budget --update                                  # a cost that's meant, or a gain: rewrite the baseline
```

When it fails, the table names the probe and count. Find the cause with `qa perf` and `qa prof` against
`main`, or `qa ab --base main --perf`. If the cost is the price of a feature, `--update` and commit the
baseline with the change, so the review sees it. After making something cheaper, `--update` too: the
baseline is a ratchet, and a gain not written into it can be spent again unnoticed.

The counts are taken over real-time windows (1200 ms after the page is ready, a probe's `settle` after its
action), so what lands inside one follows the machine's speed: the on-demand chunk's prefetch, 2 s after
mount, falls inside the load window at 4× here but not on a faster runner. Two prototypes, which print their
counts rather than check them, aim at counts that hold on any machine:

```sh
npm run qa -- budget --calls --clock fake --out .qa/counts.json   # fake clock, plus JS function calls
npm run qa -- budget-diff .qa/counts.json ci-counts.json          # which counts match in every run on both
```

- `--calls` counts the JS functions the app's scripts call in each window (V8 precise coverage), in all and
  by chunk.
- `--clock fake` runs the page on Playwright's clock: its timers, frames and idle callbacks fire only as the
  windows advance it, in 50 ms steps that each wait for fetches to finish. Interactions start 3 s after ready,
  past the prefetch. Layouts that real frames draw, and events Playwright sends in real time (wheel, mouse
  moves), can still vary a little.
- `--out file.json` writes every run's counts in any mode, with the Chromium version and CPU.

On the same Chromium (141, the build CI installs), three runs each on an Intel machine and on three CI runners
with different AMD CPUs agreed on 38 of 42 counts under `--calls --clock fake`, against 21 of 42 with the
real-time windows. The ones that still moved were the load's layouts and style recalcs (by up to 2) and its
calls (one run in six +725, an IntersectionObserver callback), and hover-messages' calls (±9, from mouse
moves sent in real time). Chromium's version matters more than the machine: on one machine, Chrome 153
counts 2–5 more style recalcs per probe than Chrome 141, so a baseline holds only for the build it was
recorded with.
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
npm run e2e                                    # build, serve build/, run everything (before merging)
npm run e2e:short                              # between iterations: about half the time (see below)
npm run e2e -- composer layout                 # build, then only these spec files
npx playwright test -c e2e/playwright.config.ts navigation   # without rebuilding
npx playwright test -c e2e/playwright.config.ts --ui         # step through, with the page alongside
npx playwright show-report .qa/e2e/report                    # after a run: traces of what failed
```

`E2E_BUILD=<dir>` serves another build (a snapshot, a mutant); `E2E_URL=<url>` uses one already served.
`npm run e2e:short` (`E2E_TIER=short`) leaves out the interop contract, the files `FULL_ONLY` in
`e2e/playwright.config.ts` names, and tests tagged `@full`. Tag a test or `describe` `{ tag: '@full' }` when it is
slow for what it adds between iterations: many viewports, axe, or real timers.
Results, traces and the report go to `.qa/e2e/`. There are no retries: a test that fails once is a finding.

| Spec | Checks |
|---|---|
| `composer.spec.ts` | Mentions: `@ad`, the arrow keys and Tab make a chip that goes out as `@ada` with `mentions: ["ada"]`; Escape dismisses the picker so Enter sends the text; Backspace after a chip gives back the name; on a phone Enter is a new line. |
| `layout.spec.ts` | At 1280, 900, 390, 360 and 320px, light and dark, with long names and four roles: no role badge sliced, a name gives way only down to `--ap-name-min`, a message header is one line, nothing scrolls sideways; under 960px the member list overlays the conversation. |
| `messages.spec.ts` | A message row's controls as the page wires them: React opens the picker (its `aria-expanded` follows it) and the pick reacts to that message, a chip lists who reacted, Reply fills the composer's reply, a shift-click in select mode picks the range, an image opens full screen; a shared name's handle carries the `sender-handle` test id. |
| `navigation.spec.ts` | Room, thread and message links; Back and Forward through rooms and threads, also to a thread left since; the phone's rooms list as a history entry. |
| `privacy.spec.ts` | A server that drops `private` from a new room or thread: the app says so and doesn't open it to post in. |
| `private-rooms.spec.ts` | Message on a profile card starts a private room (`room_set` with `private: true`, then `room_join` for them) that opens under Private, and opens it again rather than another; the + beside Private picks people (Enter, Backspace), names the room and adds each in turn, counting against `private_rooms`; a room someone else added you to shows its banner until put away; a guest starts none. |
| `a11y.spec.ts` | axe-core on connect, room, preferences and thread, desktop and phone: no serious or critical violation beyond `e2e/a11y-baseline.json` (per rule, by count). After fixing some, `E2E_UPDATE_A11Y=1 npm run e2e -- a11y` lowers the baseline; commit it. |
| `status.spec.ts` | `seen` (§4.5.2): an offline member's profile card says "Last seen 2h ago" (`profile-seen`, a `<time>` with the exact time as its tooltip) and their row's tooltip says so, from the scripted server's listing; nothing for someone online or for you; live, it goes when they come back online and comes back new when they go again. |
| `extensions.spec.ts` | The server's `title`, `description` and `avatar` beside its address on the connect screen, in Recent (one entry per normalized address, entries saved under another spelling folded in) and the sidebar's head; `ext:permissions` as an object (`write: false` for a guest and an account, `add_members` only in private rooms without it, the old list ignored); `ext:settings` without `guest_posting` or `add_members`; `ext:emoji` keys as images in text (static copies under reduced motion, never in code), in reactions, in the picker (not `hidden` ones) and the `:shortcode` list; unknown keys as placeholders that toggle the key; ❤ and ❤️ as one chip; bidi overrides dropped and names isolated. |
| `connect.spec.ts` | The sidebar's head: the server's avatar (or initials) and title over its host, the host alone without a title, a long title cut short with an ellipsis, its address the tooltip, and nothing to press; the profile's **Connect to a server…** opens the connect screen for a guest and an account, from the keyboard, and on a phone beside the head's › back. |
| `contract-scenes.spec.ts`, `contract.spec.ts` | The interop contract, below. |

Tests drive the app as a user does (roles and names, the test ids interop relies on) and assert the wire from
the frames the memory server recorded (`preview.sent('message')`). The memory server
(`src/lib/preview/memory-server.ts`) takes knobs from `window.__APRON_PREVIEW__`, which the `preview` fixture
sets from `test.use({ knobs })`: `seed: 'rich'` (long names with four roles, a name clash, avatars, a reply, a
mention of you, an embed of each kind, a room to browse), `dropPrivate: 'rooms' | 'threads'`, `account`
(the viewer signs in to an account, not as a guest, as starting a private conversation takes), and
`capabilities` to add (`embed:upload`, `status`, `ext:emoji`; with `status`, Ada is online, Grace idle, Margaret do not
disturb, and Linus offline, last seen three hours ago), `permissions` (your `you.ext.permissions` in place of
`{add_members: true}`), and `server` (fields of the `server` frame to add, `ext` merged by its keys, such as an
`emoji` `catalog_url`). With knobs set the server is `window.__apronPreview`
(`frames`, `post(room, from, body)` for a message from someone else, `reactAs(from, message, emojis)` for
someone else's reactions, `addYouToPrivate(from, title?)` for a
private room someone else added you to, `setPresence(user, status)` for a change of someone's shown status,
with a new `seen` when it goes `offline`); without them the preview is the demo, unchanged. Either way it seeds
a private conversation with Grace and a titled private room, and advertises `ext:settings` `private_rooms: 5`
and `ext:permissions` with `add_members`. `preview.openRoot(options?)` opens `/` instead, against a scripted WebSocket server (`e2e/mock-server.ts`)
for the connect screen and sign-in (with `status`: General's Bob is online, and Ada offline, last seen two hours
before the fixed clock; `options.server` adds fields to its `server` frame, `options.you` to `you`, and `options.token` signs in to an account rather than a guest); every request off the machine is refused, so no test reaches a real server.

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
