# Test support

Shared helpers for the vitest suite. Test code only: nothing here is imported by the app.

## Helpers

| File | For |
|---|---|
| `fake-socket.ts` | `FakeSocket`, a scripted WebSocket. Frames the client sends are parsed into `sent`. `receive` delivers a frame, `drop` closes the socket, `request`/`reply` answer the latest request of a method, and `greet` runs the server frame, `auth` and the joined `room_list`. `settle()` lets a reply reach the snapshot. |
| `client.ts` | `startClient(options)` stubs `WebSocket` (and `localStorage` with `storage`) and starts a `ChatClient` on a fresh `FakeSocket`. `connect(caps, options)` also greets. Both return `{ client, socket, snap(), latest(), drop(), reconnect() }`, and the client stops by itself when the test ends. `quiet(op)` lets an operation the test does not await fail quietly. It re-exports `FakeSocket` and `settle`. |
| `storage.ts` | `memoryStorage(map)`, a `Storage` kept in a `Map` the test seeds and reads: `vi.stubGlobal('localStorage', memoryStorage(values))`. |
| `dom.ts` | For jsdom component tests. `render(Component, props)` mounts into a fresh `<div>`, flushes and returns that root. Everything rendered is unmounted, and the body emptied, after the test's `afterEach` hooks. `unmount()` unmounts mid-test so the test can render again, and `exportsOf()` gives a component's exports. `queryByRole`/`byRole`/`button` find elements by role and accessible name. `press`, `touch`, `type` and `submit` act on them, and `html` makes a snippet prop. `stubDialog()` gives `<dialog>` its modal methods and `stubResizeObserver()` gives a no-op `ResizeObserver`. |
| `kept-history.ts` | `readKept(db, server)` reads back everything kept for a server on this device (`$lib/history`) straight from its stores: the meta row, room rows, messages, reactions and memberships. |
| `builders.ts` | `messageRecord(id, room, fields)`, `timelineOf(room, messages)` and `roomSnapshot(id, messages, fields)` build records and snapshots with every field the test doesn't care about filled in. |
| `runes-environment.ts` | The `runes` project's environment: Node with Svelte's client build, so effects run. |

Cleanup uses `onTestFinished`, so it needs no setup file. Call `render` and `startClient` from a test or a `beforeEach`, not from a `beforeAll`.

Two stubs are opt-in, not global. Without a `ResizeObserver`, `RoleBadges` skips fitting, and other tests rely on that. Without `matchMedia`, `handheld()` is false.

The helpers are shared: change them only in their own pull request. A helper that one area needs goes in a file of that area's own (for example `src/lib/test/client-session.ts`) or stays in its test file.

## Conventions

**Where tests live.** A test sits next to its module, one file per module:

- protocol and client: `src/lib/protocol/`, split by area as `client.<area>.test.ts` (`recovery`, `transport`, `rooms`, `operations`, `users`, `session-token`, `signin`, `passkey`, `status`, `push`, `activity`). Shared wire fixtures run in `wire-replay.test.ts` and `wire-session.test.ts`.
- app logic: `src/lib/ui/<module>.test.ts`. Logic taken out of `+page.svelte` gets a module and a test there.
- design components: `src/lib/design/components/<Component>.svelte.test.ts`, for behavior and keyboard contracts.
- app wrappers: `src/lib/components/<Component>.svelte.test.ts`, for how client state maps to props. Don't re-test design behavior there.
- browser: `e2e/*.spec.ts` (Playwright against `/__preview`), for anything that needs real layout, focus, selection or contenteditable.

**Naming.** Name a file `<module>.test.ts`, or `<module>.<area>.test.ts` when a module has several areas. No file holds two areas. Use `.svelte.test.ts` when a file needs Svelte's client runtime (runes or components), and add `// @vitest-environment jsdom` on its first line when it needs a DOM. A `describe` names the guarantee and an `it` names the observable outcome, not the implementation.

**Querying components.** Find elements the way a user or assistive technology does: by role and accessible name (`byRole('button', 'Send message')`, `button('Leave General')`), or by visible text. Don't pass a test id to a component and then query that same id: the test then only checks itself. Query a test id only to check the test-id contract that the app and the interop suite rely on. Keep that to one test per component, which checks that its named test-id props reach their parts. Avoid `.ap-*` class selectors unless the class is the interface under test, such as the CSS custom properties on `AppShell`.

**Client tests.** Drive `ChatClient` through its public API and `FakeSocket`. Assert the frames it sends (`socket.request('history').params`) and the snapshot it publishes (`snap()`), not its private state. Prefer `toMatchObject` over exact equality where a frame carries tuning constants such as `limit`. Use fake timers for anything timed. Don't use real sleeps.

**Storage.** Stub storage per test with `memoryStorage` and assert the stored `apron.*` keys exactly: they are a persistence contract.
