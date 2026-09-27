# Client behavior

What the web client does, feature by feature, and which protocol capabilities
each needs. [architecture.md](architecture.md) covers how the code is laid out.

The default connection is same-origin `/ws` in a browser unless
`VITE_DEFAULT_SERVER_URL` is set at build time.
Local development and ordinary builds retain the same-origin default.
After a failed WebSocket handshake, the client makes a bounded HTTP diagnostic
request to the same URL with `?apron_connection_status=1`. Supporting servers
can expose a capacity error and `Retry-After` through CORS; the client displays
the reason and waits before retrying, including manual retries. Servers without
this optional endpoint retain ordinary reconnect behavior.
Repeated connection failures back off from 500 ms to about one attempt per minute
with jitter. An explicit server retry window takes precedence, including a
`retry_after` error about the connection as a whole (`data.retry_after`
seconds); after such a `denied` error the client stops reconnecting, shows
**Signed out** with the server's message, and waits for **Sign in**.
With the `activity` cap, typing is reported as `activity` notifications that ask
for a 15-second indicator (`typing: 15`) and refresh it at most once every 12
seconds per room, with one `typing: 0` when typing pauses, to avoid charging a
frame per keystroke. Sending a message sends no `typing: 0`: the message itself
ends the indicator. Other people's indicators last as long as their `typing`
asks, or until their next message arrives in that room.
With the `activity` cap the client also sends `activity` `{away: true}` while
the tab is hidden or unfocused and `{away: false}` when it is back, so the
server can push to your other devices instead; it is never shown to anyone.
Explicit server URLs keep their path: a bare hostname connects at `/`, while
servers that require `/ws` should be entered with that suffix.

The client keeps one user object per `user_id` ([PROTOCOL.md §3.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#33-identity)) and merges
every current object into it field by field — `you`, `user` notifications, and
room `members` and `users` in `room_list` and `room_update` — so a rename or a
new avatar shows on earlier messages too. A present field replaces, an empty
one (`""`, `{}`) removes, and a missing one changes nothing. Recorded objects,
a message's or reaction's `from` and a membership's `user`, describe the user
as of their record and never merge. A user renders field by field: the kept
object, else the recorded one the message carries, else the `user_id`. A
`user` notification with `new` and `old` maps the retired ID to the new
identity. Message headers show the name with the muted `@user_id` beside it,
always when another user the client knows of shows under the same name, so no
one can pass as someone else. Without an avatar, a
person's initials sit on a muted tint whose hue is hashed from their `user_id`,
so the same person has the same color on every client. Senders whose `user_id`
starts with `@` render as quiet centered system lines, except the three that
state a scope (`@private`, `@room`, `@server`), which render as the design
system's notice card: left-aligned, and titled by the sender as the server
names it, `Name (@user_id)`, such as "System message to you (@private)" from
the Apron example servers. `@private` ones, and
every `message` without a `message_id` (such as a command's reply), are
transient notices: a dashed card for the session, never stored, and gone on
reload. A notice sent before authentication, such as a server's welcome
(PROTOCOL.md Appendix B), shows in the first room once one is listed; the next
connection's welcome replaces it, and signing in with a passkey or a stored
session drops it, since it speaks to whoever connected. A code block in a
notice wraps and has a Copy button, such as for the token `/invite-bot` gives
on the demo worker. A server-wide `@server` notice names
a room like any message; one for a room you haven't joined also shows as a
notice where you are. `@server`, `@room`, and `@private` are sender scopes, not rooms (Appendix A.1); a
room ID starting with `@` is an ordinary room.

Joins and leaves show in a room's timeline as the quietest system line, at
each `membership` record's `log_id` among the messages: "Ada joined", with the
time on hover. Records with nothing else between them (a message, a card, a
notice, or a date divider) make one line, netted out per user, so someone who
joins and leaves again (or leaves and comes back) in between shows on neither
side, and a run that nets to nothing shows no line at all: "Ada and Bob joined
· Carol left", and past three names "Ada, Bob, and 4 others joined", with
everyone in the tooltip. A record joining more than 20 users at once is a
baseline, not an event, and gets no line. Names render like any other user,
with the `@user_id` when someone else shows under the same name. The lines
never count as unread or mention you, and a message after one starts a new
sender group.

Mentions follow the `@user_id` convention ([PROTOCOL.md Appendix A.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a3-mention-text)). Typing `@` in the
composer opens the mention picker over the room's members (from the room's
listing, kept current by the `membership` records of joins and leaves), or the
room's recent senders on a server without `room_list`, filtered by name or ID.
A thread you read without joining lists its members with `room_list` and its
`room_id`. Arrows move, Tab or Enter picks,
Escape dismisses. A picked person becomes a chip showing their name, and a
typed `@name` (case-insensitive, spaces allowed) or `@user_id` collapses into
the same chip once finished, when exactly one person in the room goes by it;
one ending the draft collapses on send. Chips are always sent as `@user_id`, so
the field reads by name while the wire stays ID-based, and each chip's `user_id`
goes in `body.mentions` ([PROTOCOL.md §3.5](https://github.com/shazow/apron/blob/main/PROTOCOL.md#35-messages)): a chip deleted before sending mentions no one,
and an edit resubmits the message's mentions. A rendered body (plain or Markdown, never inside
code) shows a known user's mention as a chip with their current name, a room's
as a link that opens it (or joins it), and unknown IDs as written. Only
`body.mentions` decides who is mentioned: a message that lists you tints its
row with a rust rule, pulses once as it arrives or when an edit adds you (never
on replayed history), raises an `@` badge on a room you aren't reading, and,
when it lands above the fold, turns the jump bar rust with **Jump to mention**.
Text that merely contains your `@user_id` does none of that.

With the `command` cap, composer text that starts with one `/` is a command
([PROTOCOL.md §4.8](https://github.com/shazow/apron/blob/main/PROTOCOL.md#48-command)): the composer shows a **Command** tag, sets the line in
monospace, and **Run** replaces **Send**. `/nick` (a `me` request), `/join`,
`/leave` and `/topic` (`room_join`, `room_leave`, and `room_set` with a new
title, with the `rooms` cap) are handled by the client; anything else goes out
as a `command` request with the params a message would have — `room_id`, the
text as typed, `mentions`, `reply_to`, and attached files as `upload` embeds —
and is never posted. `/help` lists what the server offers. The server's replies
arrive as notices, and a failed command shows its error as a local "System
message to you" notice and gives the draft back. `//` posts a message starting with one `/`.
Without the cap, `/` text is an ordinary message.

With the `activity` cap, reading the latest message of a room advances your
read cursor (`read_message_id`), which the server syncs across your
connections. Opening a room places a **New** divider above the first message
after the cursor as it was when you arrived; it stays put while you read.

With the `rooms` cap, rooms come by request ([PROTOCOL.md §4.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#43-rooms)): right behind
`auth`, without waiting for its result ([PROTOCOL.md §3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#32-authentication)), the client lists
the rooms you have joined with `room_list` (`filter: "joined"`, `members:
true`), which is the complete set, threads included, and keeps it current from
`room_update` (`joined`, `left`, `updated`) and each room's members from
`membership` records. Only joined rooms deliver live. Without the cap there is the server's default room, posted to
without a `room_id` until a message names it, plus any room a message arrives
in, titled by its `room_id`.

Threads are rooms with a `parent_room_id`. The sidebar lists top-level rooms
and the open room's joined threads under it; the room feed shows each thread as
a card that previews its intro message (or, without one, its latest loaded
message), including threads you haven't joined, which `room_list` with the
room's `parent_room_id` finds whenever the room is opened or its threads are
listed; that listing is also what refreshes their cards, since they deliver
nothing live. Opening one of those reads it through `history` without joining
it: its header offers **Join**, and replying joins it first.
With the `rooms` cap, **Start thread** on a message creates a thread under the
room with that message as its intro; the message stays in the room, where its
card stands in for it, and leads the thread's timeline, pinned under the header.
A thread's header offers **Edit** for its title. Threads load their newest page of
history when opened (50 records); one with older replies opens at its latest
reply, shows "N+ replies", and loads the page before whenever the reader nears
the top, keeping what is on screen in place. Drafts are kept per room, threads
included.

With the `rooms` cap the header also offers **Leave**, which leaves the room or
the thread; a thread is a room of its own, so leaving its parent keeps it.
**Browse rooms** in the sidebar lists, via `room_list` with
`filter: "not_joined"`, the most active visible rooms you haven't joined, and
**More threads…** under the
open room lists its threads you haven't joined; picking one joins it and opens
it once its `room_update` arrives.

With the `edit` cap, several of your messages move at a time: shift-click a
message (or press `x` on it, long-press it on touch, or pick **Select** from its
More menu) to enter select mode, shift-click another to fill the range, and the
selection bar replaces the composer with the count, **Move to thread** (or, in a
thread, back to the room), **New thread** (with the `rooms` cap) and Cancel. A
move is a save of the message with the destination's `room_id`, one request per
message; a new thread is created first and the moves follow once the server has
named it. Denied ones stay selected and the bar says how many didn't move.
Escape leaves select mode.

A reply's quote may point into another room: clicking it opens that room or
thread, loading the thread's history if needed, and highlights the message.

With the `reactions` cap, a message's **React** action opens a small emoji
palette, whose **More emoji** button opens the full emoji picker; a pick there
toggles like a pick in the palette. Reactions show as chips under the message: emoji and count,
highlighted when one is yours, with a tooltip naming who reacted. Clicking a
chip toggles your reaction. Tombstones show no reactions.

The composer's emoji button (always there: emoji are text) opens the same
picker and inserts the emoji at the caret, over any selection, leaving mention
chips and command mode as they were. The picker is
[emoji-mart](https://github.com/missive/emoji-mart), drawn by `EmojiPopover`
outside the app shell so nothing clips it: a popover beside its button on wide
screens, a bottom sheet on narrow ones, in the app's theme and tokens. Escape
or a press outside closes it. emoji-mart and `@emoji-mart/data` load with a
dynamic `import()` the first time a picker opens, so they stay out of the main
bundle, and the picker gets its data, English strings and native glyphs passed
in, so it never fetches from a CDN.

Embeds render by kind, in the design system's components ([PROTOCOL.md §4.6](https://github.com/shazow/apron/blob/main/PROTOCOL.md#46-embeds-and-avatars)):

- **Uploads** (cap `embed:upload`): the composer's paperclip and microphone send
  files and voice clips as `upload` embeds with whatever is in the field, then
  write each file to the `write_url` in the result. The message shows a pending
  card with progress until the server publishes the finished file: an image, a
  video or audio player from its `og`, or else a file card.
- **Streams** (cap `embed:stream`): while the embed has a `url` the client reads
  it with a streaming `GET` and shows the text growing under a Live badge;
  when a snapshot carries `text` instead it shows the kept text as Finished.
  `terminal` output is monospace with ANSI colors and emphasis, carriage
  returns overwrite the line (progress bars), and other escape sequences are
  dropped; `markdown` renders, the rest is plain.
- **`iframe`** embeds stay a paused placeholder until **Load live view**, then
  load sandboxed (`allow-scripts`, never same-origin, no referrer), clamped to
  480px. **`html`** embeds are sanitized with DOMPurify before insertion.
- Any other kind renders from its `og` as a link card, else as the fallback card
  with its kind name and its `url` or `text`.
- **Link previews**: a message with GitHub pull request, issue, commit, or
  repository links (up to three) carries a `link` embed for each, with an `og`
  the sender builds. Pasting a link fetches its title, state, author, and an
  excerpt from the GitHub REST API, which allows cross-origin reads; each link
  is fetched once, and a rate-limited answer pauses fetching until the limit
  resets. A message sent before the details arrive, or linking a private
  repository, gets a card built from the URL alone ("Pull request #60"). The
  server may keep, replace, or drop this `og`.

Media in `og` and stream URLs load only from the chat server's own origin;
links may point anywhere `http(s)`.

**Connect** in the
sidebar header opens the connect screen: a WebSocket URL or an HTTP(S) server
base URL, a display name, and a sign-in choice (Guest by default; Passkey signs
in with an existing passkey once the guest session is up). The server and name
are stored in local storage, and the last few backends are listed under the
form. The profile bar at the foot of the sidebar edits your handle, which is
sent with the protocol `me` request after authentication; the editor shows
what the server actually kept. With the `command` and `embed:upload` caps it
also sets your avatar: a `/avatar` command carrying one `upload` embed
([PROTOCOL.md §4.6.6](https://github.com/shazow/apron/blob/main/PROTOCOL.md#466-avatars)), whose result names the `write_url` the image is written to; the
server applies it with a `user` notification. **Remove** sends `me` with
`avatar: ""`.

The profile editor's Sign-in row offers **Add passkey**, **Sign in with passkey**,
and **Sign out** when the server advertises WebAuthn. With the Go example, open
`http://localhost:5173` (or `http://localhost:8080` for a static build); other
deployments need HTTPS and configured RP/frontend origins. Adding a passkey
keeps your guest identity and message ownership. Signing in restores the
identity attached to your chosen passkey.

A server may keep guests read-only; the demo worker does, and says so with
`ext.demo.guest_posting: false`. Signed in as a guest there, the composer gives
way to a bar saying so with a **Sign in** button (it opens the connect screen
on Passkey). Replying, reacting, starting or editing threads, and Join and
Leave are hidden; Browse rooms and More threads… offer **Open** instead of
**Join**, which reads the room through its history without joining it. Other
servers' denials show as errors as usual.

Passkeys use the browser's native WebAuthn JSON APIs, with no frontend dependency.
An up-to-date browser is required; unsupported browsers can still chat as guests.
Browser cancellation and verification errors appear in the profile editor. A
connection change cancels the active ceremony. Chat requests pause while a
ceremony is active, preventing edits from crossing an identity change.

When the server advertises token authentication, the session token it returns
is kept in `localStorage`, keyed by server URL, and automatically resumes the
same identity after a transport disconnect, a page reload, or in a new tab, for
as long as the server keeps the session alive (the example servers renew it on
every resume). Servers that offer passkeys without token resume get no stored
credential; there a reconnect runs another ceremony and a reload starts as a
guest. Expired sessions require another passkey login; the client does not
automatically replace them with a guest identity. Signing out clears the stored
credentials and reconnects as a guest. The Go example's sessions are in memory
and are lost on backend restart.

The WebAuthn exchange follows [§4.9 of the protocol](https://github.com/shazow/apron/blob/main/PROTOCOL.md#49-webauthn-authentication):
both registration and login use `action` plus `step: "begin"` or
`step: "finish"`, with the server's `challenge_id` and `public_key` and the
browser's standard JSON credential representation. The implementation details
for the Go example are documented in
[`servers/go/README.md`](https://github.com/shazow/apron/blob/main/servers/go/README.md#example-webauthn-exchange).
