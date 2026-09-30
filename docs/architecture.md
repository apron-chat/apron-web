# Architecture

How the web client is put together. [behavior.md](behavior.md) describes what
it does.

The UI follows the Apron design system. `src/lib/design/tokens.css` holds its
color, type, spacing, radius and size tokens as CSS custom properties (dark is
the reference theme; light follows `prefers-color-scheme`, or `data-theme` on
the root when Preferences picks one), and
`src/lib/design/apron.css` is its component stylesheet.

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
`Sidebar`, `MemberListSidebar` and `ProfileBar`, `RoomHeader` and `RoomEditor`, `ThreadCard` and
`ThreadSummary`, `Message` with its `ReactionBar` and `RoleBadges`, `Composer` with its `AutocompletePicker` (for `@`, `#` and `:`), `SelectionBar`, `JumpBar`,
`EmojiPopover` (the full emoji picker, which the design system leaves to the client),
`PreferencesDialog` with its `FontFamilyField`, `CreateRoomDialog`,
`StatusBanner`, `Avatar`. A style change goes in `apron.css`, and reaches the
design system with the next `npm run design:bundle`.

`src/routes/+page.svelte` owns the session and the navigation (which room or
thread is open, per-room drafts) and composes the components. The
reactive state behind it lives in `src/lib/ui` as small classes — `SessionView`
(the last authenticated view, held through a reconnect), `MentionTracker`,
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
`email-link.ts` reads and scrubs an emailed sign-in link from the URL, and
`storage.ts` keeps everything remembered between visits under `apron.*` keys,
Preferences included (on this device only; nothing is synced), and
`notifications.ts` shows notifications, through `service-worker.ts` where the
page can't.

Protocol types, replay reduction, and the WebSocket session live under
`src/lib/protocol` and speak Apron protocol v7. `client.ts` holds the session,
`ChatClient`, and re-exports the rest of its API: `client-types.ts` has the
snapshot and option types, `client-views.ts` the pure helpers over snapshots,
capabilities and server URLs, and `client-internals.ts` the per-room state,
tuning constants and helpers only `ChatClient` uses. `reducer.ts` keeps one store
of room records, message snapshots, per-user reaction sets, and memberships
for every room, and beside the latest membership per user, each room's
membership records in `log_id` order for the timeline's join and leave lines;
each record replaces the stored one only when its `log_id` is greater, so
overlapping history and live delivery cannot revert newer state, and a move
snapshot re-homes a message into its new room. Embedded `reply_to`
snapshots install like any other record; a v6 server's `intro_message` is
dropped like any unknown key. Room records keep `description` and `private`
(fixed at creation); a room's `members` from a listing come with its
`member_count` when the server truncated them, kept until a complete list
replaces it. `types.ts` also knows the system identities (`~server`, `~room`,
`~private`, plus a small, commented fallback for v6's `@server`, `@room` and
`@private`). Reactions aggregate
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
reconnect loads only what came after its own checkpoint. Signing out or switching servers still starts over. The UI displays
a notice that the demo retains roughly the last day (from the worker's
`server.ext.demo` hints) and honors server retry delays with jittered reconnect
backoff. When the `server` frame carries `ping` ([PROTOCOL.md §1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#1-transport--framing)), the client sends
exactly `{"method":"ping"}` every that many seconds, from before
authentication on; a ping that goes a whole interval without the
`{"method":"pong"}` answer marks the socket dead, and it is replaced through
the usual reconnect. With `room_leave: false` the client offers no Leave, and
with `read_cursors: false` it moves your read cursor locally without sending it.

Edits, moves, and deletion use the same `message` request as creation, with an
existing `message_id`, and resubmit every client field of the latest snapshot
(`room_id`, `body`, a bare `reply_to`, and `ext` unchanged). A move is a save
with another `room_id`. Rooms and threads are created and updated with the
`room_set` request (cap `rooms`); a creation may ask for `private: true`, and
updates resubmit `title`, `description`, and `ext` (never `parent_room_id` or
`private`), and the change arrives as a `room_update`. The
client does not depend on the notifications a request causes arriving before
its result, as servers send them.
`room_join` and `room_leave` take the `room_id`, and a `user_id` to add or
remove someone else; an `unsupported` reply to that sets the snapshot's
`memberChangesUnsupported` until the next `server` frame. Reactions use the
`reactions` request (cap `reactions`) with your complete emoji set.

Every successful `auth` result is handled alike: its `you` becomes the
connection's identity and a `token` in it replaces the saved one, whether it
answers a guest sign-in, a token resume (rotation), a passkey or an email code.
Email sign-in (`requestEmailCode`, then `signInWithEmail`) and passkeys share
one guard: other requests wait while a sign-in may change the identity. The
`server` frame's `welcome` is kept on the snapshot's `server`.
