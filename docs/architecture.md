# Architecture

How the web client is put together. [behavior.md](behavior.md) describes what
it does.

The UI follows the Apron design system. `src/lib/design/tokens.css` holds its
color, type, spacing, radius and size tokens as CSS custom properties (dark is
the reference theme; light follows `prefers-color-scheme`, or `data-theme` on
the root when Preferences picks one), and
`src/lib/design/apron.css` is its component stylesheet. Text sizes are the
`--text-*` scale (caps, xs, sm, ui, field, body, title); only glyphs sized to
their box, such as avatar initials and emoji, and the connect screen's display
title keep literal sizes. `npm run design:bundle` copies the scale into
`bundle.css`, since the design system's `tokens.json` doesn't carry it yet.

This repository is the design system's source. `src/lib/design/components`
holds its presentational Svelte 5 components (runes, snippets, typed `Props`,
exported from `$lib/design/components`), and `src/lib/design/previews` a live
preview page for each. `npm run design:bundle` builds them into
`dist-design/project/components/`: `bundle.js` (one classic script, with the
Svelte runtime inside, that sets `window.Apron` with `render`, `html`, `part`
and `parts` for plain pages), `bundle.css` (`apron.css` itself), `index.d.ts`
(generated from each component's `interface Props`) and each
`<Name>/preview.html`. Publish those files to the design system artifact. Its
tokens stay in the artifact's `tokens.json`; keep them in step with
`tokens.css`.

The Svelte components under `src/lib/components` wrap the `ap-*`
classes one to one with the design system's components, adding the app's
state and behavior — `ConnectScreen`,
`Sidebar`, `MemberListSidebar` and `ProfileBar`, `RoomHeader` with `RoomEditor` and `StartThreadDialog` (both the design system's `ThreadEditor`, a `Dialog`), `ThreadCard` and
`ThreadSummary`, `Message` with its `ReactionBar` and `RoleBadges`, `Composer` with its `AutocompletePicker` (for `@`, `#` and `:`) and `StagedFile` (the design system's `Attachments`), `SelectionBar`, `JumpBar`,
`EmojiPopover` (the full emoji picker, which the design system leaves to the client),
`PreferencesDialog` with its `FontFamilyField`, `CreateRoomDialog`, `EmailLinkDialog` (all three
the design system's `Dialog`; a setting that takes effect at once is its `Switch`, and a
choice submitted with a form a `CheckList`-style row),
`MediaViewerHost` (the design system's `MediaViewer`, opened by image embeds through
`media-viewer.svelte.ts`, which reads the open timeline's `data-viewer-*` links), `StatusBanner`, `UpdateNotice` (the design system's `ActionBanner`, which reads whether the page's
`PaneDrafts` hold anything unsent through `pageDrafts`), `Avatar`. A style change goes in `apron.css`, and reaches the
design system with the next `npm run design:bundle`. A user's `status` (§4.5)
is the design system's `StatusDot` on their `Avatar`: online a dot, idle a
crescent, dnd a barred dot, offline a hollow ring, your own `invisible` the
same ring with its own words, and any other value `unknown`, a dashed ring
whose words carry the value (`presenceLabel`), cut out of the avatar, with
nothing where the server sends no status or `""`. Its colors are the
`--presence-*` tokens. `directory.status` reads it from the kept user object
only, never a recorded `from`; for you that is the status you chose, since
the client keeps `status` only from a `you`. `user-status.ts` lists the
choices, words your own (`ownStatusLabel`), decides when the page is silent
(`pageSilenced`: paused, or `dnd`) and sorts the member list (online, idle,
dnd, unknown, offline, then none), where offline members are dimmed.
`ProfileCard` shows an unknown value literally. Messages show no status: it
is about now, and they are history. `PreferencesDialog` renders the design
system's `CheckList` (what to notify about), `Callout` (installing for push,
and what the server answered for a status) and `MenuButton` (Status, in
`StatusPicker`, as a picker with `selected` and a `lead` dot per choice,
offering Online and None, and `dnd` and `invisible` where `accepted`
(`server.status`, which `ProfileBar` passes from the server frame) lists them
and the server hasn't answered something else for them (`unsupported`),
`busy` while the choice is saved, which keeps focus where `disabled` would
drop it; `onannounce` hands the server's answer to the dialog's live region;
and Pause…, in `PauseNotifications`) as they are, and `pause.ts` words and times
the pause. Its status notes are read through one
live region, and switches and checkboxes that can't change stay focusable with
`aria-disabled`, referring to the note that says why.

`src/routes/+page.svelte` owns the session and the navigation (which room or
thread is open, per-room drafts) and composes the components. The
reactive state behind it lives in `src/lib/ui` as small classes — `SessionView`
(the last authenticated view, held through a reconnect or primed from this device;
`starting` while the first rooms aren't listed, `activeRoomHeld` while the open
room shows its held copy, and the open room's thread cards from the same view), `MentionTracker`,
`IncomingMessageTracker` (new messages from others, for notifications),
`AppearanceSettings` (theme and fonts),
`UnreadTracker`, `MessageSelection`, `FeedbackState`, `SidebarLayout`,
`PaneDrafts` (the composer's text and reply per room and thread),
`PagePresence` (whether the tab is attended, and the mention alert),
`ProgressiveReveal` (long timelines paint newest-first) and `FloatingDay` —
beside pure, unit-tested
helpers: `timeline.ts` groups threads under their rooms and builds the room and
thread views, `membership.ts` nets runs of joins and leaves and words their
lines, `reactions.ts` turns reaction summaries into chips, `emoji.ts`
places and themes the emoji picker (`emoji-picker.svelte.ts` keeps the one open
picker and loads emoji-mart), `draft.ts` edits the composer's draft, `link-previews.ts` builds GitHub link previews, `messages.ts`
and `time.ts` read messages, `connection.ts` words the connection state, and
`commands.ts` maps the composer's `/` commands to requests,
`email-link.ts` reads and scrubs an emailed sign-in link from the URL and words the question asked before using it,
`members.ts` reads the `user_id` typed to add a member, and
`storage.ts` keeps everything remembered between visits under `apron.*` keys,
Preferences included (on this device only; nothing is synced),
`session-cache.ts` keeps `SessionView`'s held view in IndexedDB per server, trimmed to
the last day's messages (`keptView`), which the page primes `SessionView` with
(`prime`) before the next visit's session is ready: shown as a held view, never
fed to the unread, mention or notification trackers, and replaced room by room
as a reconnect's is, and
`notifications.ts` shows notifications, through `service-worker.ts` where it
is registered, and words pushed messages for the service worker,
`notify-scopes.ts` decides which arriving messages the page notifies about from
the checked scopes, and which of them push sends as `wake`, and
`push-store.ts` keeps in IndexedDB, for the service worker too, the enabled
`push_id`s and the newest message each notification group notified about,
`web-push.ts` keeps this browser's push subscription for the server's key
(`WebPushSync` runs subscribing and unsubscribing one at a time, under a Web
Lock), `push-settings.svelte.ts` (`PushSettings`) turns push on and off per
account and shares the one subscription between accounts and tabs, and
`sw-handlers.ts` holds the service worker's push and click handlers, apart
from the worker so tests can run them.

Protocol types, replay reduction, and the WebSocket session live under
`src/lib/protocol` and speak Apron protocol v8. `client.ts` holds the session,
`ChatClient`, and re-exports the rest of its API: `client-types.ts` has the
snapshot and option types, `client-views.ts` the pure helpers over snapshots,
capabilities and server URLs, and `client-internals.ts` the per-room state,
tuning constants and helpers only `ChatClient` uses, and `email-connection.ts`
the connection an email sign-in proposes and approves on. `reducer.ts` keeps one store
of room records, message snapshots, per-user reaction sets, and memberships
for every room, and beside the latest membership per user, each room's
membership records in `log_id` order for the timeline's join and leave lines;
each record replaces the stored one only when its `log_id` is greater, so
overlapping history and live delivery cannot revert newer state, and a move
snapshot re-homes a message into its new room. Embedded `reply_to`
snapshots install like any other record. Room records keep `description` and `private`
(fixed at creation); a room's `members` from a listing come with its
`member_count` when the server truncated them, kept until a complete list
replaces it. `types.ts` also knows the system identities (`~server`, `~room`,
`~private`). Reactions aggregate
per message (counts per emoji, who reacted, whether you did) and are hidden on
tombstones.

Recovery is per room and uses `latest_log_id` and `history_log_id`. For each
top-level room the client tracks the monotonic effective lower bound and a
checkpoint, captures a fixed head from the room's record when it is listed or
joined, pages every
record kind from the bound (or the checkpoint), and buffers bounded live
records until recovery finishes; the room's published timeline is held until
then. If retention overtakes the next uncovered position the client rebuilds
from the new bound and ignores obsolete replies. `history_log_id: null` means
the effective bound is `latest_log_id + 1`. Sparse timestamp log IDs are
expected. Threads are rooms with a `parent_room_id`; they load their own
history with `loadRoom` when opened: the newest page (`before` the head, no
`after`), then older pages with `loadOlder` (`before` the oldest loaded
`first_log_id`) until one reports `more: false` or the bound passes it. A lost
connection keeps each room's records, members, bound and checkpoint: the next
connection resumes each kept room's recovery from its checkpoint right behind
`auth`, before any head is known (the first page reports it), and the room
stays if that connection's `room_list` lists it as joined. A resumed passkey
session asks only for the rooms whose `latest_log_id` passed the kept
checkpoints (`latest_log_id` in `room_list`): rooms in `left` go and the rest
stay; a result without `left` is a full listing. A thread reopened after a
reconnect loads only what came after its own checkpoint. Signing out or switching servers still starts over. The client
honors server retry delays with jittered reconnect backoff. When the `server` frame carries `ping` ([PROTOCOL.md §1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#1-transport--framing)), the client sends
exactly `{"method":"ping"}` every that many seconds, from before
authentication on; a ping that goes a whole interval without the
`{"method":"pong"}` answer marks the socket dead, and it is replaced through
the usual reconnect. `serverSettings` reads extension `ext:settings`
(`server.ext.settings`, only where `capabilities` lists it): with
`guest_posting: false` a guest's snapshot is `readOnly`, and with
`read_cursors: false` the client moves your read cursor locally without
sending it.
`setIdle(idle, inputAt)` reports attendance, as `PagePresence.idle` decides it (no
input for `IDLE_AFTER_MS`, hidden on a handheld, or loaded hidden and unused;
the page's captured `keydown`, `pointerdown`, `pointermove`, `wheel` and
`touchmove` call `PagePresence.input`), with `status` requests `{idle}` (§4.5,
capability `status`) through `syncIdle`, which sends nothing until the
connection is signed in (`handleAuth` calls it after the result; a replacing
server frame while signed in calls it too). `idleReport` holds what the
server has for the current connection: each starts attended, so an attended
start sends nothing, and one on an idle page says so at once. Idle goes as
the whole seconds since `inputAt` (`PagePresence.inputAt`), or `true` where it
is unknown or the server refused the seconds (`invalid_params`, after which
that connection's report says `true`). One request is
in flight at a time and the latest state follows its `{}`; a `retry_after`
error waits out the delay and then syncs the current state, and any other
error or a timeout does the same after a backoff from `IDLE_RETRY_MS`,
doubling to `IDLE_RETRY_MAX_MS`. `setStatus(status)` sends
`me` `{status}` and resolves with the `you` the server kept, whose `status`
is the one in effect. `setMute(mute)` sends a `status` request `{mute}` and
returns a promise that resolves on `{}` and rejects with the server's error
(nothing changed; `PauseNotifications` shows it in a `Callout`); it changes
nothing else: only a `status` notification from the server (`handleStatus`),
which reaches the sending connection too, before the result,
sets the snapshot's `mutedUntil`, or a room's with its `room_id`, which
timers clear when they run out. A sign-in, in `handleAuth`, is an `auth`
as a user the connection isn't already signed in as: an `auth` that adds to
the signed-in connection isn't one (a passkey registered while
authenticated, a guest's included, passes `added`, and an added address's
`{}` result never reaches `handleAuth`), nor is a repeat `auth` as the same
user (§3.2). Every notification a sign-in causes comes after its result, so
each sign-in drops the kept mutes (`resetMutes`) when its result arrives,
and the `status` notifications after it apply as they come, like any
other; a lost connection keeps the mutes until then. A `room_update` the
sign-in causes, such as an automatic join with its membership, also comes
after the result, and applies like any other, before or after the joined
`room_list` sent behind `auth` answers. `handleServer` keeps `server.status`, the optional
statuses the server accepts, as strings. Kept
users' `status` values outlast a lost connection, and each sign-in drops
them (`dropKeptStatuses`), all but your own, which the `auth` result's `you`
gives, so they show none until the server sends them again: as `user`
notifications after the result, and in the current user objects of
`room_list` and `room_update`, which carry `offline` and `""` too.
`setPushRegistration(params, userId)` keeps the `push_register` params (§4.9)
and sends them after each `auth` as that account while `server.push` offers
their `kind`. A replaced or cleared registration is unregistered, after the
next `auth` as the account it belonged to if it can't be at once
(`pushUnregisters` keeps each `url` with its user). `pushRequest` chains
requests for the same `url` on a connection, each after the last one's reply
(§1), so an unregister and a register can't apply out of order. Signing out unregisters and keeps the
unregister queued for its user until answered, so one lost with the replaced
connection goes again after that user's next `auth`; switching
servers forgets it. `setPushOff(url)` unregisters this browser's endpoint after
each `auth` while push is off for the account, and a refused `push_register`
is the snapshot's `pushError`.

Edits, moves, and deletion use the same `message` request as creation, with an
existing `message_id`, and resubmit every client field of the latest snapshot
(`room_id`, `body`, and a bare `reply_to`). `ext` is not resubmitted: a save
merges it one level deep (§4.12), so a save sends only the `ext` keys it
changes, a key with an empty value removes it, and a pending save settles on a
record that matches it whatever its `ext`. `ext` goes in `me`, messages and
`room_set` only to a server with capability `ext`; without it the client
leaves `ext` out of the request. A move is a save
with another `room_id`. Rooms and threads are created and updated with the
`room_set` request (capability `rooms`); a creation may ask for `private: true`, and
updates resubmit `title` and `description` (never `parent_room_id`,
`private`, or `ext`, which merges like a message's), and the change arrives as a `room_update`. The
client does not depend on the notifications a request causes arriving before
its result, as servers send them.
`room_join` and `room_leave` take the `room_id`, and a `user_id` to add or
remove someone else; an `unsupported` reply sets the snapshot's
`memberChangesUnsupported` until the next `server` frame. Reactions use the
`reactions` request (capability `reactions`) with your complete emoji set.

Every successful `auth` result is handled alike: its `you` becomes the
connection's identity and a `token` in it replaces the saved one, whether it
answers a guest sign-in, a token resume (rotation), a passkey or an email code.
A passkey ceremony is `usePasskey(action, name?)`, one per tap: `login` or
`register` (§4.10), modal mediation only, on the connection to this server
whether or not it is signed in. It is busy (`authBusy`, `passkeyBusy`) from
the call on, waits for requests sent as the old identity to settle, sends
`name` with a register `begin` and labels the new passkey with it
(`labelledCreationOptions`), and after a login relabels the passkey through
the Signal API where the browser has it (`signalPasskeyLabel`).
`cancelPasskeyPrompt()` abandons it at any point. The connection's own
sign-in never runs one: where only a passkey brings a registered session back
(no token to resume with), or a resume was refused, `authenticate` holds the
connection (`held`) and says how to sign in (`signInNeeded`), and the page's
sign-in panel (`SignIn.svelte`, state machine in `$lib/ui/sign-in`) takes the
user's tap from there.
Email sign-in (§4.11) proposes and approves on one connection, since a short
code works only on the connection that proposed it: `requestEmailCode(email,
url?)` opens an `EmailConnection` (`email-connection.ts`) to that server that
never signs in until approved, waits for its `server` frame, proposes (`auth`
with `email`), and keeps it open (pinging, and closed after
`EMAIL_PROPOSAL_MS`) as the snapshot's `emailCode`, leaving this connection and
its view untouched; a newer proposal, `cancelEmailCode()` and `stop()` close
it. `signInWithEmail(code, name?, beforeSwitch?)` approves on it (`auth` with
`token`); a `denied` code leaves it open to try again. On success the client
adopts that connection as its own: `beforeSwitch` runs, it moves to that
server if another (`switchServer`, as `setUrl` without connecting), closes its
connection as `restart` would, attaches the socket (`attachSocket`, shared
with `connectNow`), takes the `server` frame in without answering it, handles
the result as a sign-in, and then processes the frames that arrived after the
result. `signInWithEmailLink(token, url?, beforeSwitch?)` does the same with a
link's token on a fresh connection; a refused link changes nothing.
`requestEmailCodeToAdd` proposes on the signed-in connection and `addEmail(code)`
approves on that same connection (refused if it has reconnected since), whose
`{}` result adds the address: another way back in for a registered session,
or, for a guest without a token, what makes it an email account. How the kept
session signed in (`webauthn`, `email`, `token`) is remembered beside its token
as `signedInWith`, and ways added to the account since beside it
(`signInMethods`). `requestEmailCode`, `signInWithEmail` and registering a
passkey accept a scheme listed in `auth` or `signup`, and adding an email needs it in `auth`; a passkey login and a
token resume need it in `auth`. The `server` frame ([PROTOCOL.md §3.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#31-server-frame))
is kept on the snapshot's `server` as sent: `apron` (the version), `capabilities`,
`agent` (the implementation, for debugging; the UI labels a server by its host,
never by `agent`), `welcome`, `signup`, `ping`, `push`, `status` and `ext`. Every `auth` the client sends carries `agent: "apron-web/0.4"`
(§3.2).
