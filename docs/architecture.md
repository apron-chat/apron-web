# Architecture

How the web client is put together. [behavior.md](behavior.md) describes what
it does.

The UI follows the Apron design system. `src/lib/design/tokens.css` holds its
color, type, spacing, radius and size tokens as CSS custom properties (dark is
the reference theme; light follows `prefers-color-scheme`), and
`src/lib/design/apron.css` is the design system's component stylesheet copied
verbatim. The Svelte components under `src/lib/components` wrap its `ap-*`
classes one to one with the system's React components — `ConnectScreen`,
`Sidebar` and `ProfileBar`, `RoomHeader` and `ThreadEditor`, `ThreadCard`,
`Message` with its `ReactionBar`, `Composer` with its `MentionPicker`, `SelectionBar`, `JumpBar`,
`EmojiPopover` (the full emoji picker, which the design system leaves to the client),
`StatusBanner`, `Avatar` — and carry only the layout glue each needs. Re-copy
`apron.css` when the design system changes rather than editing it here.

`src/routes/+page.svelte` owns the session and the navigation (which room or
thread is open, per-room drafts) and composes the components. The
reactive state behind it lives in `src/lib/ui` as small classes — `SessionView`
(the last authenticated view, held through a reconnect), `MentionTracker`,
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
`storage.ts` keeps everything remembered between visits under `apron.*` keys.

Protocol types, replay reduction, and the WebSocket session live under
`src/lib/protocol` and speak Apron protocol v6. `client.ts` holds the session,
`ChatClient`, and re-exports the rest of its API: `client-types.ts` has the
snapshot and option types, `client-views.ts` the pure helpers over snapshots,
capabilities and server URLs, and `client-internals.ts` the per-room state,
tuning constants and helpers only `ChatClient` uses. `reducer.ts` keeps one store
of room records, message snapshots, per-user reaction sets, and memberships
for every room, and beside the latest membership per user, each room's
membership records in `log_id` order for the timeline's join and leave lines;
each record replaces the stored one only when its `log_id` is greater, so
overlapping history and live delivery cannot revert newer state, and a move
snapshot re-homes a message into its new room. Embedded `reply_to` and
`intro_message` snapshots install like any other record. Reactions aggregate
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
`room_set` request (cap `rooms`); updates resubmit `title`, a bare
`intro_message`, and `ext`, and the change arrives as a `room_update`. The
client does not depend on the notifications a request causes arriving before
its result, as servers send them.
`room_join` and `room_leave` take only the `room_id`. Reactions use the
`reactions` request (cap `reactions`) with your complete emoji set.
