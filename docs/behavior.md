# Client behavior

What the web client does, feature by feature, and which protocol capabilities
each needs. [architecture.md](architecture.md) covers how the code is laid out.

The default connection is `VITE_DEFAULT_SERVER_URL` from the build, which
`.env.production` sets to `wss://server.apron.chat/` for every production build
(web.apron.chat and pull request Previews). Local development, and a build with
`VITE_DEFAULT_SERVER_URL=` (empty), use same-origin `/ws` instead.

Embed media (`og` images, video and audio) loads from the chat server's origin
and from the origins in `VITE_TRUSTED_MEDIA_ORIGINS`, which `.env.production`
sets to `https://media.apron.chat`, the reference server's upload bucket.
Streams load from the chat server's origin only. Every link in chat, from
message text, link cards, uploads and HTML embeds, opens in a new tab.

`/__preview` mounts this same app against a page-local in-memory WebSocket
server, not the saved, configured, or same-origin backend. It seeds a guest,
rooms, a thread, people, Markdown examples, and a message moved into the thread,
and implements the app's protocol
requests (auth, room listings/history, messages, reactions, room changes,
profile updates, activity, commands, and ping). Changes last only for the page
lifetime, as do settings changed there (display name, sidebar, appearance),
so previewing never replaces the real ones; the preview does not advertise
upload or streaming capabilities. The in-memory server loads only with that
route, never with the app itself.
Local development and builds with an empty `VITE_DEFAULT_SERVER_URL` retain the
same-origin default.
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
one (`""`, `[]`, `{}`) clears it and is kept as cleared, and a missing one
changes nothing. Recorded objects, a message's or reaction's `from` and a
membership's `user`, describe the user as of their record and never merge. A
user renders field by field from the kept object, falling back to the
recorded one the message carries only for fields the kept object lacks, so a
cleared avatar, name or `roles` stays cleared however stale the message; an
empty or unknown name shows as the `user_id`. A
`user` notification with `new` and `old` maps the retired ID to the new
identity. Message headers show the name with the muted `@user_id` beside it,
always when another user the client knows of shows under the same name, so no
one can pass as someone else. Without an avatar, a
person's initials sit on a muted tint whose hue is hashed from their `user_id`,
so the same person has the same color on every client. A user's `roles`
([PROTOCOL.md §3.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#33-identity)),
such as "admin" or "bot", show as small outlined badges beside the name in
message headers and the member list, never as part of it, so no name can pass
as a role; they grant nothing here. Senders whose `user_id` starts with `~`
(system identities, Appendix A.1) render as quiet centered system lines, except
the three that state a scope (`~private`, `~room`, `~server`), which render as
the design system's notice card: left-aligned, and titled by the sender as the
server names it, `Name (~user_id)`, such as "System message to you (~private)"
from the Apron example servers. From a server before protocol v7, `@private`,
`@room` and `@server` senders are read as those three (the client renames them
to `~` as they arrive); on a v7 server they are ordinary users, and no `@` ID
is ever special. A `~private` message reaches only the connection it was sent
on. Every `~private` message, whatever it carries, and every `message` without
a `message_id` (such as a command's reply), are transient notices: a dashed card for the session, never stored, and gone on
reload. A notice sent before authentication, such as a server's welcome
(PROTOCOL.md Appendix B), shows in the first room once one is listed; the next
connection's welcome replaces it, and signing in with a passkey or a stored
session drops it, since it speaks to whoever connected. A code block in a
notice wraps and has a Copy button, such as for the token `/invite-bot` gives
on the demo worker. A server-wide `~server` notice names
a room like any message; one for a room you haven't joined also shows as a
notice where you are. `~server`, `~room`, and `~private` are sender scopes, not rooms (Appendix A.1); a
room ID starting with `@` or `~` is an ordinary room.

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

The Member list button at the end of the room title bar toggles a right-hand
sidebar listing the open room's or thread's members from its `room_list`
snapshot, with their role badges. A server may list only the most recently
active members of a large room, with `member_count` for the total; the list
then says so, and the count in its header is the total. In a room you have
joined, with the `rooms` cap, **Add by @user_id** adds someone (`room_join`
with their `user_id`, suggesting people the client knows) and each other
member's remove button removes them (`room_leave` with their `user_id`, after
a confirm): how members bring people into a private room. Only a `user_id` is
accepted there, since display names aren't unique. Who may is the server's
policy; its error shows in the panel. A server before protocol v7, which would
ignore `user_id` and act on you, gets neither these controls nor such
requests, and one that answers `unsupported` gets no controls until its next
`server` frame. A count kept from a truncated listing stays while later records
of the room carry no `members`. On wide screens it is a column that resizes like the rooms list:
drag its left border, or click the border to collapse it (the header button
brings it back, and takes focus when the border collapsed it from the keyboard), and its width and whether it is collapsed are remembered.
Dragging either list shut restores its earlier width when it reopens. On
narrow screens it overlays the conversation, starts closed, and hides with
the conversation on the phone's rooms pane. It shows no
typing or connection status.

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
code) shows a known user's `@user_id` as a chip with their current name, a known room's
`#room_id` as a link showing its title that opens the room (or joins it), and unknown
IDs as written ([PROTOCOL.md Appendix A.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a3-prefixes-in-text)): `@` names only users. Typing `#` in the composer opens room autocomplete over known
rooms and threads, searchable by title or ID (a bare `#` lists them to browse, and
Enter there still sends; Tab picks); choosing one inserts a chip
showing `#title` that is sent as `#room_id`, and a typed `#room_id` naming a
known room collapses into the same chip once finished (it mentions no one).
Backspace right after either kind of chip turns it back into the text it
showed (`@Ada Lovelace`, `#Deploy checklist`) to edit. A reply's quote above
its message and the "Replying to" line above the composer show the replied
message's first line with its mentions drawn the same way. A fenced
code block that names a known language (` ```ts `, ` ```py `, ` ```diff `, …)
is syntax-highlighted once that language's highlighter loads, fetched the first
time a block needs it; other blocks stay plain. Only
`body.mentions` decides who is mentioned: a message that lists you tints its
row with a rust rule, pulses once as it arrives or when an edit adds you (never
on replayed history), raises an `@` badge on a room you aren't reading, and,
when it lands above the fold, turns the jump bar rust with **Jump to mention**.
Text that merely contains your `@user_id` does none of that.

A mention that lands while the tab is hidden or unfocused flashes the tab title
and plays a soft chime. **Preferences** (the gear beside your profile) can turn
on desktop notifications instead, for mentions or for every message from
someone else; turning them on asks the browser's permission, and **Send test**
shows a sample. While they're on, a notification replaces the chime (the chime
still plays if one couldn't be shown), each room keeps one notification that
the next message replaces (its newest mention, else its newest message), and
clicking it opens that room or thread. Where the page can't show notifications
itself (Android Chrome) the service worker shows them. Permission revoked in the
browser's site settings reads as off. **Appearance** picks a light or dark theme
over the system's, and an installed font for the interface, messages and code
(suggested from installed fonts where the browser allows listing them); the
font choice is marked experimental, to be replaced by a choice of themes. All
of these stay on this device; settings aren't synced.

With the `command` cap, composer text that starts with one `/` is a command
([PROTOCOL.md §4.8](https://github.com/shazow/apron/blob/main/PROTOCOL.md#48-command)): the composer shows a **Command** tag, sets the line in
monospace, and **Run** replaces **Send**. `/nick` (a `me` request), `/join`,
`/leave`, `/topic` (`room_join`, `room_leave`, and `room_set` with the room's
new `description`), and `/kick @user` and `/invite @user` (`room_leave` and
`room_join` with that `user_id`), with the `rooms` cap, are handled by the
client. `/kick` with a reason goes to the server, which alone can carry one,
and so do `/kick` and `/invite` on a server before protocol v7 and once the
server has answered them `unsupported` (the one that got that answer is sent on
as a command); anything else goes out
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
`room_update` (`joined`, `left`, `updated`) and each room's members from the
membership records in its `membership` ([PROTOCOL.md §4.3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#432-membership)); a `membership`
notification from an earlier protocol 7 draft still applies. Only joined rooms deliver live. Without the cap there is the server's default room, posted to
without a `room_id` until a message names it, plus any room a message arrives
in, titled by its `room_id`.

Threads are rooms with a `parent_room_id`. The sidebar lists top-level rooms
and the open room's joined threads under it; the room feed shows each thread as
a card where it was started that previews its description as text (or, without
one, its latest loaded message), including threads you haven't joined, which `room_list` with the
room's `parent_room_id` finds whenever the room is opened or its threads are
listed; that listing is also what refreshes their cards, since they deliver
nothing live. Opening one of those reads it through `history` without joining
it: its header offers **Join**, and replying joins it first.
With the `rooms` cap, the **+** beside Rooms in the sidebar creates a room
from a name and an optional Markdown description (`room_set` with `title` and
`description`); it opens once its `room_update` arrives, and the dialog stays
open, with the server's error, if creating fails. **Private** asks for
`private: true` ([PROTOCOL.md §4.3.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#434-creating-and-editing)):
a server that keeps no private rooms answers `unsupported`, which the dialog
says in words; one that creates the room without `private: true` in its record
gets an error toast instead of an opened room, so nothing meant to be private
is posted there (the room stays joined, to leave or use knowingly). A thread
is created without `private`, since it takes its parent's, and edits never send
it, since an omitted `private` is kept: a new thread of a private room that
comes back without `private: true` gets the same error, and neither the reply
composer opens on it nor do selected messages move into it. Private rooms and
threads show a lock beside their name.

A room's `description` (Markdown by convention) shows as one line of text
under its title in the header. With the `rooms` cap the header's **Edit** opens
a form for the open room's or thread's title and description ("Summary" for a
thread), saved with one `room_set`; the `room_update` that follows is what
shows, since the server may alter or decline it.

With the `rooms` cap, **Start thread** on a message creates a thread under the
room titled after the message's first line, with the message's text as its
`description` (unless the title already says it all), and opens it with the
composer replying to that message. Threads don't point at a message in v7, so
the thread's first reply carries the link back as its `reply_to` (the
convention of the protocol's fixtures): its quote shows the message and jumps
to it. The message stays in the room, with the thread's card after it. A
thread's description shows as a **Summary** pinned at the top of the thread,
rendered as Markdown. Threads load their newest page of
history when opened (50 records); one with older replies opens at its latest
reply, shows "N+ replies", and loads the page before whenever the reader nears
the top, keeping what is on screen in place. Drafts are kept per room, threads
included.

Each room or thread opened is a browser history entry (the URL stays the same),
so Back returns to the previous room or thread, and Forward the other way, until
Back leaves the page from the first room opened. A room left since stays put
for that step, and a thread left since is read without joining.

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

With the `reactions` cap, a message's **React** action opens the full emoji
picker right away, its frequently used row starting from emoji-mart's own
defaults; a pick toggles your reaction with that emoji. Reactions show as chips under the message: emoji and count,
highlighted when one is yours, with a tooltip naming who reacted. Clicking a
chip toggles your reaction. Tombstones show no reactions.

Typing `:shortcode` in the composer opens an emoji autocomplete; arrows move,
Tab or Enter inserts the highlighted native emoji in place of the shortcode,
and Escape dismisses it. Suggestions search emoji shortcodes, names, aliases and
keywords. The composer's emoji button (always there: emoji are text) opens the
same full picker and inserts the emoji at the caret, over any selection,
leaving mention chips and command mode as they were. The picker is
[emoji-mart](https://github.com/missive/emoji-mart), drawn by `EmojiPopover`
outside the app shell so nothing clips it: a popover beside its button on wide
screens, a bottom sheet on narrow ones, in the app's theme and tokens. Escape
or a press outside closes it. The emoji data loads with a dynamic `import()`
when shortcode autocomplete is first used; emoji-mart itself loads dynamically
the first time the full picker opens. Both stay out of the main bundle, and the
picker gets its data, English strings and native glyphs passed in, so it never
fetches from a CDN.

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
  the sender builds. A link is looked up as soon as it is pasted, or once
  typing pauses for a moment: its title, state, author, and an excerpt come
  from the GitHub REST API, which allows cross-origin reads; each link
  is fetched once, and a rate-limited answer pauses fetching until the limit
  resets. A message sent before the details arrive, or linking a private
  repository, gets a card built from the URL alone ("Pull request #60"). The
  server may keep, replace, or drop this `og`. The cards show above the
  composer as you write, each with an **(x)** that sends the message without
  it. A failed send restores the draft with those previews still removed;
  otherwise the draft forgets them once it is sent or cleared.

With the `edit` cap, each embed on your own messages shows an **(x)** on its
corner while hovered (always on touch screens), which saves the message without
that embed ([PROTOCOL.md §4.6.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#462-embed-identity)): it is identified by `embed_id`, or by
value on servers that store embeds as given. Removing an upload or stream asks
first, since the server deletes its content. A message's last embed has no (x)
when there is no text (delete the message instead), nor does an upload still
being written.

Media in `og` and stream URLs load only from the chat server's own origin;
links may point anywhere `http(s)`.

**Connect** in the
sidebar header opens the connect screen: a WebSocket URL or an HTTP(S) server
base URL, a display name, and a sign-in choice among the schemes the server
advertises (Guest by default; Passkey signs in with an existing passkey once
the guest session is up; Email and Token, below). Once the server in the field
has answered, its `server.welcome`
([PROTOCOL.md §3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#32-authentication))
shows at the top of the form, rendered as Markdown and sanitized like a message.
A server without the `guest` scheme opens this screen by itself once, since
nothing works before signing in. The server and name
are stored in local storage, and the last few backends are listed under the
form. The profile bar at the foot of the sidebar edits your handle, which is
sent with the protocol `me` request after authentication; the editor shows
what the server actually kept. With the `command` and `embed:upload` caps it
also sets your avatar: a `/avatar` command carrying one `upload` embed
([PROTOCOL.md §4.6.6](https://github.com/shazow/apron/blob/main/PROTOCOL.md#466-avatars)), whose result names the `write_url` the image is written to; the
server applies it with a `user` notification. **Remove** sends `me` with
`avatar: ""`.

The profile editor's Sign-in row offers, where the server's `auth` lists them,
**Sign in with a passkey**, **Sign in with email** and **Add email** to a
guest, and **Add passkey**, **Add email** and **Sign out** to a registered
account. A guest's Add email proposes and approves on the guest's connection,
which adds the address to the guest's account (§4.10); Sign in with email is a
sign-in to the address's own account. Adding needs the
scheme in `auth`, since adding is a way back in and a scheme listed only in
`signup` doesn't sign in (the spec doesn't say whether servers may allow
adding such a scheme; this client doesn't offer it). With the Go example, open
`http://localhost:5173` (or `http://localhost:8080` for a static build); other
deployments need HTTPS and configured RP/frontend origins. A passkey registered
on a signed-in connection is added to that account
([PROTOCOL.md §4.9](https://github.com/shazow/apron/blob/main/PROTOCOL.md#49-webauthn-authentication)),
so adding one keeps your guest identity and message ownership; signing in
restores the identity attached to your chosen passkey. **Add email** asks for
an address, proposes adding it on this signed-in connection (`auth` with
`scheme: "email"` and `email`), and approves the proposal with the emailed code
on this same connection (`scheme: "email"` and `token`, no address), which
adds the address to the account and answers `{}` (§4.10); a refused code says
the address may belong to another account. If this connection dropped in
between, the proposal went with it and the form asks for a new code. Adding doesn't change how
the session signed in: it is remembered beside it, as another way back in.
When, as far as this browser knows, the account has no way back in that the
server signs in with (only a kept token, pasted or an invite, or an account
made with a scheme the server lists only in `signup`), the profile bar says
"add a sign-in" and the Sign-in row suggests a passkey or an email.

A server may keep guests read-only; the demo worker does, and says so with
`ext.demo.guest_posting: false`. Signed in as a guest there, the composer gives
way to a bar saying so with a **Sign in** button (it opens the connect screen
on Passkey). Replying, reacting, starting threads, editing rooms and threads,
adding or removing members, and Join and Leave are hidden; Browse rooms and More threads… offer **Open** instead of
**Join**, which reads the room through its history without joining it. Other
servers' denials show as errors as usual.

Passkeys use the browser's native WebAuthn JSON APIs, with no frontend dependency.
An up-to-date browser is required; unsupported browsers can still chat as guests.
Browser cancellation and verification errors appear in the profile editor. A
connection change cancels the active ceremony. Chat requests pause while a
ceremony is active, preventing edits from crossing an identity change.

With `email` in the server's `auth` or `signup`
([PROTOCOL.md §4.10](https://github.com/shazow/apron/blob/main/PROTOCOL.md#410-email-authentication)),
the connect screen's **Email** asks for an address and proposes signing in
with it: `auth` with `scheme: "email"` and `email`, which authenticates nothing
and answers `{}` whether or not the address has an account. A proposal on a
signed-in connection (a guest's too) would propose adding the address to that
account, and a short code works only on the connection that proposed it, so
the client proposes on a connection of its own that is not signed in and keeps
it open while you type the code (pinging it at `server.ping`, and closing it
after 15 minutes, by when the proposal has expired). Nothing on screen changes
meanwhile: this connection, its identity and its rooms carry on. On a server
the connect screen isn't connected to yet, it proposes there the same way,
without first signing in as a guest. The code field then approves the proposal
on that same connection (`scheme: "email"` and `token`, no address). A wrong
code can be typed again on the same proposal; if that connection closes (the
proposal expired, the server went away), the code field goes and the form asks
for a new code. The code belongs to the server that proposed it: changing the
Server field drops it and closes that connection, as does "Use another
address". Once the code works, that connection, now signed in, becomes the
client's connection (on its server, if another): the previous one closes, the
page lets go of the view it held, and the rooms are listed on the new one. If
the sign-in gives no token of its own, the previous account's kept token is
forgotten, so a reconnect never silently brings that account back. The
profile's **Add email** is what proposes on the signed-in connection.

With `server.signup`, `auth` lists the schemes that sign in and `signup` those
that create an account (§3.1): the connect screen offers both, and its hint says
which each does. A scheme listed only in `signup` works end to end for joining
(an email code, or registering a passkey); one listed only in `auth` only signs
in (a passkey that only signs in is never registered from there).

The email's link is `#token=…`, with an optional `&server=` naming the
server's `ws:`/`wss:` URL (the suggested convention of §4.10), all
`application/x-www-form-urlencoded` in the URL fragment; it carries no address.
The fragment is read and scrubbed from the address bar before anything else
(an earlier draft's `#email=…&token=…` is scrubbed too, and its address
ignored). A link is a credential someone else may have crafted or forwarded,
so it is never used silently: a dialog asks "Sign in to *server* with this
email link?", says whom it signs out when you are signed in there (or that a
saved session is kept there, before it has resumed), and warns that a link
someone sent you can sign you in to their account, which matters all the more
as the link can't say which account it is for. A link pasted into an open tab
is taken the same way. On confirmation the client opens a fresh connection to
the link's server (this one unless it names another) that is not signed in,
presents the token there (`scheme: "email"` and `token`), and carries on with
that connection once it has worked, as above; only then is a switch to another
server remembered, and the server listed under Recent. A link never adds an
address to an account. If it fails (expired, used), nothing changes: the page
stays on its server, and the connect screen opens on Email, set to the link's
server, with the reason.
An email sign-in that can't be resumed (no token to resume with) shows as
signed out after a reconnect, never as a guest, unless a passkey was added to
the account, which then signs it back in; where email only signs up, the
message points to another way in rather than to email. The link dialog also
warns when the server a link switches to has a saved session here.

When the server advertises token authentication, the session token it returns
(after a passkey or email sign-in, or a replacement in reply to a token resume)
is kept in `localStorage`, keyed by server URL, the latest replacing any earlier, and automatically resumes the
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
