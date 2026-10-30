# Client behavior

What the web client does, feature by feature, and which protocol capabilities
each needs. [architecture.md](architecture.md) covers how the code is laid out,
and [EXT.md](../EXT.md) the extensions it understands beyond the protocol.

The default connection is `VITE_DEFAULT_SERVER_URL` from the build, which
`.env.production` sets to `wss://server.apron.chat/` for every production build
(web.apron.chat and pull request Previews). Local development, and a build with
`VITE_DEFAULT_SERVER_URL=` (empty), use same-origin `/ws` instead.

Embed media (`og` images, video and audio) loads from the chat server's origin
and from the origins that server names for its media, such as its upload bucket
(`ext.media.origins`, [EXT.md §6](../EXT.md#6-extmedia)).
Live text (`terminal` and `append` embeds) loads from the chat server's origin
only. Every link in chat, from
message text, link cards, uploads and HTML embeds, opens in a new tab.

`/__preview` (in development builds only: `vite dev`, or `APRON_PREVIEW=1 vite build`, which the QA tools and
`npm run e2e` use; production builds leave it out) mounts this same app against a page-local in-memory WebSocket
server, not the saved, configured, or same-origin backend. It seeds a guest,
rooms, a thread, people, CommonMark examples, and a message moved into the thread,
and implements the app's protocol
requests (auth, room listings/history, messages, reactions, room changes,
profile updates, activity, commands, and ping). Changes last only for the page
lifetime, as do settings changed there (display name, sidebar, appearance),
so previewing never replaces the real ones; the preview does not advertise
uploads. It does advertise live text (`embed:terminal`, `embed:append`), which
it serves itself at `http://apron-preview.invalid/` (the page routes those
URLs to it; there is no network): `/embed-terminal [title]` and
`/embed-append [markdown]` answer as the servers do, with a write URL and a
`curl` recipe in a notice to you, and since nothing can `PUT` to it, a moment
later play a canned demo into a new message (a test run with colors, a
progress bar, box drawing and cursor movement; a Markdown reply cut at
arbitrary bytes). A `message` with a new `terminal` or `append` embed gets its
write URL too. The in-memory server loads only with that
route, never with the app itself.
Local development and builds with an empty `VITE_DEFAULT_SERVER_URL` retain the
same-origin default.
After a failed WebSocket handshake, the client makes a bounded HTTP diagnostic
request to the same URL with `?apron_connection_status=1`
([EXT.md §5](../EXT.md#5-connection-status)). A reply marked
`Apron-Connection-Status: 1` can carry a capacity error and `Retry-After`,
exposed through CORS; the client displays the reason and waits before retrying,
including manual retries. Any other reply is ignored, and servers without
this optional endpoint retain ordinary reconnect behavior.
The first reconnect after a connection that stayed up goes within a quarter
second, spread at random so a server's clients don't all come back at once;
repeated failures back off from 1 s to about one attempt per minute with jitter.
Where the server pings (§1), a tab shown again after 10 seconds or more away,
or a network that comes back, checks at once that its socket still answers:
one ping, and a socket that hears nothing back (a `pong`, or any other frame)
within 5 seconds is replaced as if it had closed, rather than looking connected
for up to a whole ping interval after a laptop slept. For 3 minutes after a
check replaced a socket, the next waits 30 seconds instead, so a slow network
that outlasts 5 seconds isn't met with one new connection after another. An explicit server retry window takes precedence, including a
`retry_after` error about the connection as a whole (`data.retry_after`
seconds); after such a `denied` error the client stops reconnecting, shows
**Signed out** with the server's message, and waits for **Sign in**.
When a newer version of the client is deployed (SvelteKit's version poll, or a
lazily loaded file the deploy removed), a notice at the top offers **Reload**
or **Later**; it never reloads by itself. Drafts live only in memory, so while
any room or thread has unsent text or files it adds that reloading clears your
unsent message.

A reload, or opening the app again, picks up where you were. With a session
saved on this device (a passkey or email account; a guest's isn't kept), the
page first shows the view kept from last time: the rooms and threads, the open
room with its messages from the last day (the newest 150 per room), its thread
cards and members, and who you are. While it checks for new messages, a pill
says so (below), and each room is replaced by the live one once it has
recovered: what arrived meanwhile comes in under the New divider, and edits,
deletions and reactions update in place. The kept view is only for showing: it
never sends a read cursor, notifies, or counts as unread, and the live session
recovers every room as it would without it. It is kept per server in IndexedDB
for the account signed in there, dropped after a week, removed on sign-out, and
dropped as soon as the server signs in as anyone else. Without one (a first
visit, or a guest), the page shows placeholder rooms, messages and members, with
"Connecting…" and then "Loading messages…" at the foot of the timeline, instead of
"Not signed in", "No rooms yet" or "No room open". While the open room or thread
recovers or loads its history, a pill floating just above the composer, in
the gap under the last message, says so ("Checking for new messages…", or replies in a
thread). It takes no space, so the timeline doesn't move as it comes and goes,
and it shows only once a check has taken 400ms, then for at least 600ms and
until 300ms after the check ends, so a quick check shows nothing and a slow one,
also one that comes in steps, doesn't flicker. A short drop of the connection
uses the same pill, saying "Reconnecting…" until the connection is back and then
that it's checking, so the way back reads as one quiet line, with everything
kept on screen; a longer drop, or one that needs you, gets the status banner
instead. The way back shows no pill at all for its first 1.5 seconds, counted
from when the client starts trying again where you can see it: the drop, or,
for a tab hidden meanwhile (which waits to reconnect until it's shown), coming
back to it. Most reconnects are done by then, so they show nothing. A tab
waiting while hidden shows nothing either, and the banner's "Still trying to
reconnect…" also counts only from then, never the time the tab was away (hiding
the tab mid-reconnect stops the count; a browser offline while the tab shows
still counts). Its **Try Again** shows the new attempt at once.
Through a quiet reconnect the page stays as it was (a guest who only reads
keeps reading): the rooms' and member list's + buttons, the Online and Offline headings, the Private section and the
profile bar's note stay up, and the composer still takes typing, while Send
waits for the connection. Only your own dot in the profile bar says it: a ring
broken into dashes, its tooltip the connection's state, in place of your status
until the connection is back. Screen readers hear it as the pill shows it: not
for those first moments, nor while a hidden tab waits (the status says nothing
then, rather than "Connected"). A link opened meanwhile waits for the new
connection's listings before deciding a room or thread isn't there. What was listed before
the drop stays listed: Other Rooms, Other Threads, and the room's thread cards,
until the new connection's listings replace them, so the open room shows what
came meanwhile without waiting on its thread listing again, and an open
thread's reply count stays while it catches up.
A request that takes more than 600ms says so in a toast above the composer
("Leaving…"), which goes when it's done; one that fails leaves its error there
until the next request, or until its × closes it. An error of the connection
itself shows in the corner, also with a ×; closed, it stays away until it
clears, and shows again if it comes back. The first time a room is shown in
a session its messages wait for its thread listing, for at most three
seconds, so its thread cards arrive with them instead of shifting the timeline
afterwards; a reconnect keeps what was listed, so it doesn't wait again.
With the `activity` capability, typing is reported as `activity` notifications that ask
for a 15-second indicator (`typing: 15`) and refresh it at most once every 12
seconds per room, with one `typing: 0` when typing pauses, to avoid charging a
frame per keystroke. Sending a message sends no `typing: 0`: the message itself
ends the indicator. Other people's indicators last as long as their `typing`
asks, or until their next message arrives in that room.
With the `status` capability (§4.5), the client tells the server whether
anyone is attending the tab, so the server can push instead. It sends a
`status` request (with an `id`) only once signed in, after the `auth`
result, never before. As other chat apps do, the tab is idle after five
minutes without input in it (a key, a click or tap, a pointer move, a
scroll), and any input, or coming back to the window or tab, ends it at once.
Losing focus alone doesn't make it idle, since a window on another monitor is
still read; it only makes the tab alert for mentions. A tab hidden on a
phone or tablet, where that is the app going to the background, is idle at
once. A connection starts attended, so a tab in use sends nothing. One that
starts idle (a tab loaded hidden and not used since, such as one a push
notification opened in the background, or a reconnect after five minutes
without input) reports idle at once. After that, the client reports idle when
the tab becomes idle and sends `{idle: false}` as soon as it is used again.
Idle goes as the whole seconds since the tab was last used (`{idle: 300}`
after five minutes), worked out as the request goes, so the server can push
mentions that came after you left (a tab loaded hidden and never used counts
from when it went idle, so it sends `{idle: 0}`). One `idle` request is in flight at a time; a change meanwhile goes
after the server's `{}`. If the server answers `retry_after`, the client sends
the tab's state as it is after the delay, not the refused one, and nothing if
that is what the server already has. After another error, or no answer, it
does the same after 5 seconds, doubling with each failure in a row up to five
minutes, so a tab in use is never left idle. A request that times out may or
may not have applied, so after one the tab's state goes even if it is what
the server had before. Typing and sending go through the input that ends
idle; the `activity` and `message` frames themselves don't carry it. Others never see `idle` itself: while your status is `online`, the
server folds it into the `status` they see (§4.5): `online` while a
connection is attended, `idle` while you are connected but none is, and
`offline` with no connections. After a sign-in's result the server sends the
`status` others see of each user this one shares a room with, other than
`offline` and `""`. A server without `status` gets none of this.
Explicit server URLs keep their path: a bare hostname connects at `/`, while
servers that require `/ws` should be entered with that suffix.

The client keeps one user object per `user_id` ([PROTOCOL.md §3.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#33-identity)), so a
rename or a new avatar shows on earlier messages too. A complete object — `you`
in an `auth` or `me` result, and the `users` of `room_list` and `room_update`
— replaces it: a field it leaves out is gone. Every other current object — the
`you` and `new` of a `user` notification, and room `members` — merges into it
field by field: a present field replaces (`null` too, as an ordinary value), an
empty one (`""`, `[]`, `{}`) clears it and is kept as cleared, and a missing
one changes nothing. `ext` merges the same way one level down
([PROTOCOL.md §4.12](https://github.com/shazow/apron/blob/main/PROTOCOL.md#412-ext)): each key replaces the kept value, an empty value
clears that key (kept as cleared), and `"ext": {}` changes nothing. Your own `status` comes only
from `you`, never from your entry in `users` or `members`. Recorded objects, a message's or reaction's `from` and a
membership's `user`, describe the user as of their record and never merge. A
user renders field by field from the kept object, falling back to the
recorded one the message carries only for fields the kept object lacks, so a
cleared avatar, name or `roles` stays cleared however stale the message; an
empty or unknown name shows as the `user_id`. A
`user` notification with `new` and `old` maps the retired ID to the new
identity: the same account under a new `user_id`, such as a guest that
becomes a new account. Signing in to an existing account isn't one: others
see the guest leave (a membership leave, `offline`) and the account arrive,
two people, the guest's messages staying the guest's, and the connection
that signed in takes its own identity from the `auth` result or `you`. Message headers, the member list and the list of who reacted show the muted
`@user_id` beside a name only where it tells people apart: when another user the
client knows of shows under the same name, so no one can pass as someone else (a
name that is the user's own `user_id` needs no handle beside it). A handle that
merely differs from the name says nothing more, so it isn't shown; one that is
shown is needed, so it stays whole, giving way only after the name and the role
badges. The profile card always shows the `@user_id`, and the mention picker
lists it to pick by. Without an avatar, a
person's initials sit on a muted tint whose hue is hashed from their `user_id`,
so the same person has the same color on every client. A user's `roles`
([PROTOCOL.md §3.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#33-identity)),
such as "admin" or "bot", show as small outlined badges beside the name in
message headers and the member list, never as part of it, so no name can pass
as a role; they grant nothing here. Short of room, the badges come first: the
name truncates, down to 6em (or all of a shorter name), before the badges that
don't fit go behind the last one that does, which ends with how many, its count in the role’s color ("BOT +2",
its tooltip naming every role),
then the first narrows, then they go; the time never wraps or shrinks. Senders whose `user_id` starts with `~`
(system identities, Appendix A.1) render as quiet centered system lines, except
the three that state a scope (`~private`, `~room`, `~server`), which render as
the design system's notice card: left-aligned, and titled by the sender as the
server names it, `Name (~user_id)`, such as "System message to you (~private)"
from the Apron example servers. No `@` ID is special. A `~private` message reaches only the connection it was sent
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
each membership record's `log_id` among the messages: "Ada joined", with the
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

On wide screens the rooms list is a column beside the conversation: drag its
inner border (its right one, or its left under a right-to-left layout, where
both lists mirror) to resize it, or move it with the arrow keys, the one
pointing toward the conversation widening it; and click the border, or the panel button at its
inner edge, to collapse or expand it. The button sits at the end of the list's
header, after the server, while it is open, and rides the border as the list
slides or is dragged; once it is shut, at the start of the room's header, beside
the window edge the list went to, with or without a room open. Its width and whether
it is collapsed are remembered. On
phones it is a pane of its own instead, which the title bar's back button
returns to.

The member list's panel button, at its inner edge (the start of its header,
before Members, or the end of the room's once it is shut), toggles a right-hand
sidebar, **Members**, listing the open room's or thread's members from its `room_list`
snapshot, with their role badges, in sections as Discord lists them, each
headed with its count: **Online**, then **Offline** (offline, or your own
invisible). Each heading folds its section, as the sidebar's headings do, to
no one (presence isn't news), with the **…** at its end that shows it again,
and which are folded is remembered for every room. Someone with no status isn't known to be offline, so stays under
Online. Without presence (a server without the `status` capability, or no
member with a status) it is one list with no heading, since a Members heading
would repeat the panel's own. Within a section, members sort by status, then
name. A server may list only the most recently
active members of a large room, with `member_count`, the number of users who have joined; the list
then says so, and the count in its header is the total. In a room you have
joined, with the `rooms` capability, a small **+** after the header's count
(**Add member**) opens **Add people to …**, a centered dialog with the same
people picker as New private conversation (below): the people the client knows
who aren't members yet, but you and the system identities, narrowed by a name
or `@user_id` typed; when none of them matches, the `@user_id` typed is offered
to add by it. **Add** sends `room_join` with each picked `user_id` in turn; one
the server refuses doesn't stop the rest, stays picked, and the dialog says
why, while those added are said in the panel. Pressing a member's row
anywhere drops down its menu beneath it (a right-click, the context menu key or a
long press opens it where that was): **Profile** opens their profile card;
**Direct message** (not to a system identity) opens the private conversation you
have with them, or starts one, as a profile card's Message does; and **Remove from
room** removes them
(`room_leave` with their `user_id`, after a confirm): how members bring people
into a private room. While either is under way the menu holds Profile alone; your
own row, or one where Profile is all the menu would hold, opens the profile card at once. Who may is the server's
policy; its error shows in the panel. A server that answers `unsupported`
gets no controls until its next `server` frame. A count kept from a truncated listing stays while later records
of the room carry no `members`. On wide screens it is a column that resizes like the rooms list:
drag its inner border (its left one, or its right under right-to-left), or click the border to collapse it (the panel button
brings it back, and takes focus when the border collapsed it from the keyboard), and its width and whether it is collapsed are remembered.
Dragging either list shut restores its earlier width when it reopens.

Both lists open and shut the same way, in 240ms: the column slides, its
contents keep their width against the edge facing the conversation (so they
ride the moving border rather than squeeze), and fade; below 960px the member
list's overlay slides in from the window's end instead (the right edge, or the
left under right-to-left, below its button). Each frame moves the
grid's columns only, nothing else's style; the timeline takes its final width
when the slide starts and keeps it until the slide ends, so its messages are
laid out once rather than re-wrapped on every frame (it stays at the latest
message if it was there), while the conversation sits on a compositor layer of
its own. The layout kept from the last visit shows without sliding in, a drag
follows the pointer with no slide, and there is no motion at all when the
system asks for reduced motion. On
narrow screens the member list overlays the conversation, starts closed, is toggled by a
button near the end of the room title bar instead, and hides with
the conversation on the phone's rooms pane. It shows no
typing or connection status. Where the server sends a `status` (§4.5), each
member's avatar carries a dot cut into its corner: online a filled dot, idle
a crescent, do not disturb a barred dot, and offline a hollow ring; the
row's tooltip and screen-reader text say it in words. A value the client
doesn't know is unknown, not offline: a placeholder, a ring broken into
dashes, whose tooltip says "Unknown status: brb", and the profile card shows
the literal value. A member with no status (none sent, or `""`, none) has no
dot and isn't taken for offline. The list sorts online, idle, do not
disturb, unknown, offline, then those with no status, by name within each,
and dims offline members. The client shows what the server sends: others see
a user's do not disturb only while that user is connected, and offline
otherwise, which the server works out. Your own row, the profile card and the profile bar
show the status you chose, from `you`: online, do not disturb, invisible (the
hollow ring others see, its tooltip "Invisible · others see you as offline"),
or no dot for none. Others' view of you (`offline` while you are invisible,
`idle`) arrives in `new` user objects and room `members`, and never replaces
your own. Pausing notifications doesn't change your status: a pause is
private. A lost connection keeps the others' statuses, and each sign-in
drops them, however short the reconnect; the server sends them again after
the sign-in's result for each connected user who shares a room, and in the
room `members` and `users` of `room_list` and `room_update`, which carry
`offline` and `""` too (a ring, and no dot). Signing in again as the same user
after a lost connection (a resume), the ones from before still show until the
joined `room_list` arrives, each replaced as a fresh one comes, so the member
list doesn't grey out and reorder meanwhile; the member list itself keeps
showing them all, in their order, until that listing, then changes over once,
rather than reordering as each fresh one comes. Then any the server didn't send
again show no dot, except an `offline` or `""`, which stays: the server sends
every other status, so its silence means one of those. A sign-in as someone
else drops them at once. A
sign-in is an `auth` as a user the connection isn't already signed in as: a
repeat `auth` as the same user, or adding a passkey or an email address,
keeps them.

A user object with a shown `offline` may carry `seen` (§4.5.2): when that
user's shown status last became `offline`, in the `log_id` format. While a
member shows offline, their profile card says "Last seen 3h ago" under the
status (as `15m`, `3h` or `12d ago` within two weeks, then the day as the
browser's locale writes it, such as `Last seen Sep 14` in en-US, with the
year when it isn't this one), with the exact local time as its tooltip, and
their row's tooltip (and its screen-reader text) says "Offline · last seen 3h
ago"; both move on each minute. Under ten minutes ago it says "Last seen
recently", with no number: a server may record `seen` coarsely (one records
it to the 10 minutes, and a departure within 10 minutes of the one before
announces the older time again), so "4m ago" could be off by as much as it
says. Its tooltip then says "Last seen within the last 10 minutes" rather
than an exact time the words decline to give, though the `<time>` keeps the
time in its `datetime`. A `seen` up to five minutes ahead of this device's
clock is recent too; one further ahead says its day, since "ago" would be
false. It merges like any other field, so a `seen` kept from before stays
when they come back online (`{"status": "online"}` carries none), but it
shows only while they show offline. One that isn't decimal digits of a
positive integer below 2^53, or is past the last date a JavaScript `Date`
holds (8.64e15 ms), shows nothing. It is never kept for you: your status is
the one you chose, and `you` carries no `seen`. A sign-in drops each `seen`
with the statuses. Resuming, a held `offline` shows with its `seen` until
the joined listing arrives; an `offline` kept after it because nothing was
said of them keeps no `seen`, since they may have come back and gone again
meanwhile (the sign-in sends no `offline`, and a listing of what changed
since leaves out rooms whose log didn't move), until an object that carries
one arrives.

The page also notes, in memory, when it received each other user's change
of shown status to `offline` (from a `user` notification, a room's
`members`, or a listing's or `room_update`'s `users`) from one it showed
them with on this signed-in connection: not from `offline`, `""` or none.
While they show offline, the later of that and their `seen` shows, so
someone this page watched leave never reads as gone longer than that,
however coarse the server's `seen`; it shows even where the server sent no
`seen`, since it is what this page saw, not something the server claims. It
is only ever the time a change was received: a status learnt after a
sign-in, or held through a resume, changes from none, so someone who left
while this page was away isn't given the time it came back. It is never
yours. It stays through a resume as the same user, except for someone the
resume's listing says nothing of (dropped with their `seen`, for the same
reason), and any other sign-in drops it, as it does the statuses. A reload
loses it, and the server's `seen` alone shows.

In the composer, Enter sends and Shift+Enter starts a new line. On a phone or
tablet (a touch screen with no pointer that hovers) Enter starts a new line
instead, as mobile chat apps do, since an on-screen keyboard has no
Shift+Enter; the Send button sends. Where an autocomplete below offers Enter
to pick, it picks either way. Pressing Send leaves the focus in the
field, so a phone's keyboard stays up between messages. However long the
room or thread's name, the field's placeholder takes one line, cut short.

The timeline is anchored at its bottom edge. When the area below it grows or
shrinks (the composer taking another line, a reply bar, staged files, the
typing row), the messages just above the composer stay in view, pushed up
rather than covered: at the latest message it stays there, and scrolled back,
the view moves with the edge. Resizing the window keeps the view where it is.

A phone's on-screen keyboard covers the page rather than resizing it, and the
browser pans the page to keep the field in view. While it's up, the app is
fitted to what's left above it instead: the header stays at the top, the
composer sits just above the keyboard, and the timeline is anchored as above,
so the latest message (or a message being edited) stays in view. Scrolling
past either end of the timeline doesn't carry on to the page. On iPhone and
iPad, fields type at 16px at least, so Safari doesn't zoom the page into them
as they take focus.

Mentions follow the `@user_id` convention ([PROTOCOL.md Appendix A.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a3-prefixes-in-text)). Typing `@` in the
composer opens the mention picker over the room's members (from the room's
listing, kept current by the membership records of joins and leaves), or the
room's recent senders on a server without `room_list`, filtered by name or ID.
A thread you read without joining lists its members with `room_list` and its
`room_id`. Arrows move, Tab or Enter picks,
Escape dismisses. A picked person becomes a chip showing their name, and a
typed `@name` (case-insensitive, spaces allowed) or `@user_id` collapses into
the same chip once finished, when exactly one person in the room goes by it;
one ending the draft collapses on send. Chips are always sent as `@user_id`, so
the field reads by name while the wire stays ID-based, and each chip's `user_id`
goes in `body.mentions` ([PROTOCOL.md §3.5](https://github.com/shazow/apron/blob/main/PROTOCOL.md#35-messages)): a chip deleted before sending mentions no one,
and an edit resubmits the message's mentions. A `markdown` body renders as CommonMark
([PROTOCOL.md §3.5](https://github.com/shazow/apron/blob/main/PROTOCOL.md#35-messages)) with three extensions beyond it: GitHub tables,
strikethrough, and a typed line break kept as a break; raw HTML shows as
text. What users write shows without the bidi embeddings and overrides U+202A
to U+202E, and isolated in its own direction ([PROTOCOL.md §3.5.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#352-rendering)):
message text, names, roles, bios, room and thread titles and descriptions,
embed titles and previews, notifications, and the server's title and
description. Only what shows drops them: the client keeps and sends what was
written, so an edited message or room goes back with every character its
author typed, and IDs, tokens and URLs are never changed. Times and days, as
the browser's locale writes them, keep their own direction too, so under a
right-to-left layout an English time still reads "3:42 PM". A rendered body (plain or CommonMark, never inside
code) shows a known user's `@user_id` as a chip with their current name, a known room's
`#room_id` as a link showing its title that opens the room (or joins it), and unknown
IDs as written ([PROTOCOL.md Appendix A.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a3-prefixes-in-text)): `@` names only users. The ID after
`@` or `#` is the longest run of letters, digits and `_.+@:-` that starts and
ends with a letter, a digit or `_`, so `@ada@example.com` and
`@carol:b.example` are whole IDs and a trailing `.` or `:` is punctuation; an
`@` or `#` right after a letter or digit is text (`mail@ada.example`). A typed
`@name` stays text where what follows it would carry on the `@user_id` it
sends (`@Ada.x`). Typing `#` in the composer opens room autocomplete over known
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
on replayed history), turns the unread bubble of the room or thread you aren't
reading orange with an `@` (a thread's on its own row, listed under its room
while it has news, not on the room as well), and,
when it lands above the fold, turns the jump bar rust with **Jump to mention**.
Text that merely contains your `@user_id` does none of that.

Clicking a user's mention chip in a message, a sender's name or avatar, or a
member in the member list opens their profile card: a popover beside it (a
bottom sheet on narrow screens) with their avatar, name, `@user_id` (always,
here, with a copy button beside it), role badges, "(you)", a warning when another known user shows under
the same name, their bio where the server keeps one (plain text with its
line breaks, never markup; its `http(s)` links open in a new tab), and whether they're in the open room. **Message**, the
card's primary action, opens a private conversation with them (below), for
anyone but you and the system identities, while you're signed in to an account
(not a guest) on a server with the `rooms` capability. **Mention** puts their
chip in the composer, and **Add to
room** appears where the member list would let you add them. Escape, a press
outside, or tabbing out closes it. Mentions inside a reply's quote only read,
since the quote is the button that jumps to its message.

A mention that lands while the tab is hidden or unfocused flashes the tab title
and plays a soft chime. **Preferences** (the gear beside your profile) starts
its Notifications section with **Notify me about**, one choice for desktop
notifications and push alike, one line per option: Mentions (messages whose
`body.mentions` list you, or an edit that adds you), Replies to my messages
(replies to one of your messages that is loaded here; with the replied-to
message not loaded, no notification), All messages in private rooms (a private
room or its threads) and All messages in joined rooms (a joined room or its
threads). Messages of your own never notify. At
least one stays checked: until you choose, mentions, replies and all messages
in private rooms, so a conversation started from a profile card alerts from
its first message, and push sends `private` in its `wake` (§4.9.4) for it to
push; the switches below turn notifications off. The choice is kept per account on each server,
and for a server's guests together (their `user_id`s change with each
connection), and applies in other tabs. The earlier device-wide "Everything"
carries over as every scope.

On a server with the `status` capability, the section starts with
**Status**, your presence status as others see it (§4.5). Its menu, with a
dot before each choice and a check on the current one, offers Online
(automatic: others see online, idle or offline as you come and go) and None
(no status), and Do not disturb (others see it while you're connected, and
offline otherwise) and Invisible (others see you offline) only where the
server frame's `server.status` lists them (§3.1); without `server.status`
the menu offers just Online and None. A status you already have stays in
the menu, checked, even when it isn't listed. Choosing one sends `me`
`{status}` (`""` for None); there are no durations. A server may still answer
another value: `you` in the result is the status in effect, the row shows it,
and a callout says what the server answered ("This server doesn't offer
Invisible. Your status is None."), which the dialog's one live region reads
out too; while a choice is being saved the button reads "Saving…" and can't
open, but keeps keyboard focus (`aria-disabled`, not disabled); for the rest of the session the menu stops
offering a value the server answered something else for. A value the client doesn't know
(one the server set) shows as itself, quoted, with nothing checked. Do not
disturb silences this page as a pause does: no desktop notifications, chime
or title flash, and the server sends no pushes with messages.

Below it, a signed-in account (not a guest) gets **Pause notifications**, a
private mute nobody else sees. **Pause…** opens a menu: For 1 hour, For 8
hours, Until tomorrow (the next 9:00; "Until this morning" before 9:00) and
Until I resume, each showing when it would end. The menu opens from the
keyboard with the arrow keys too; its items are out of the tab order, so Tab
closes it with focus back on the button and moves on from there. Choosing one sends a `status` request
`{mute}` with the seconds until then, or `true`, and **Resume** sends
`{mute: false}`. Neither changes anything here by itself: the server sends
each change to your mutes back to all your connections, this one included,
as a `status` notification (`{mute}` with seconds left, `true` or `false`)
before the request's `{}` result, and the client takes that as its own
setting. If the server answers with an error instead, such as `retry_after`,
nothing changed: the row keeps what it showed and adds a callout with the
server's message ("Notifications weren't paused", or "Notifications are
still paused" for a refused **Resume**) until the next ask. A refused mute is
not sent again on its own. So the row shows the pause the server kept, a shorter
one or none, and focus moves to **Resume** (or back to **Pause…**) once it
arrives; a pause set in another tab or on another device shows here too.
Every notification a sign-in causes comes after its result
([PROTOCOL.md §3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#32-authentication)), so at each sign-in the client drops the mutes
it kept, and after the result the server sends every mute in effect, which
the client applies as it arrives; any it doesn't send is off. Adding a
passkey or an email address to the signed-in connection isn't a sign-in, a
guest's included, nor is a repeat `auth` as the user the connection is
already signed in as: the mutes stand. A lost connection keeps the pause
until the next sign-in, so it doesn't flicker off while reconnecting. The client works out when the
pause ends as it arrives, and resumes on its own then. While paused, the row
reads "Paused until 14:30" (or "until tomorrow 9:00", "until you resume"),
the profile bar's gear carries a small bell-off badge, and nothing notifies
here: no desktop notifications, chime or title flash, and mentions that
arrive meanwhile don't alert once it ends. The server sends no pushes with
messages.

A `status` with a `room_id` mutes that room and its threads, mentions
included: they don't notify, chime or flash the title. It applies whether or
not the room is joined, and `false` (or `0`) ends it. The client has no
control for it yet, but follows mutes set elsewhere.

Below it, one **Notifications** switch turns notifications on for this device,
as chat apps have one per device rather than one per way of delivering them.
Turning it on asks the browser's permission, from that tap, and then turns on
both of what follows where they work: the page's own notifications, which
alert while Apron is open but hidden or unfocused, and push for the signed-in
account, which alerts while it's closed. Turning it off turns both off. It is
on if either is, so a choice made with the separate Desktop and Push switches
of earlier versions carries over. The note under it says how far it reaches:
"On · alerts on this device, even when Apron is closed", or "On · alerts while
Apron is open." and why not when it's closed (this server doesn't push; sign
in; add Apron to the Home Screen; this browser can't; this server pushes none
of the checked choices; not yet). Where push could work here but isn't on for
this account (another account turned notifications on, or a sign-in since), an
**Alert when it's closed, too** button turns it on; where another server holds
this browser's one subscription, **Alert for this server instead** moves it
here. **Send a test notification** under it shows a sample through the same
browser path as the page's own.

Until notifications are turned on or off on this device, the first mention
you'd hear (not in a room you muted, nor while paused or on do not disturb)
offers them once: a small prompt (the design system's `Nudge`), "Get
notified when you're mentioned?", saying who mentioned you and where, and how
far they'd reach (even when Apron is closed, where push works here; else while
it's open). Its **Turn on** does what the switch does, from the same tap;
**Not now**, or Escape within it, turns them off. Either answer, or using the
switch, is the choice, so it isn't offered again on this device, nor once the
browser blocks notifications. In an installed app (a Home Screen or desktop
app window) where push works for the signed-in account, the same prompt is
offered as soon as you're signed in, without the mention, since a phone that's
rarely open may not see one arrive for days, and each device asks for its own
permission. With the rooms list showing, it sits above the
profile bar, pointing at the Preferences gear where the switch lives, and says
so; on phones, or with the list collapsed, it sits above the composer. It
doesn't take focus from what you're typing; a screen reader reads it as it
appears. While they're on, a notification replaces the chime (the chime
still plays if one couldn't be shown), each room keeps one notification that
the next message replaces (its newest mention, else its newest message), and
clicking it opens that room or thread. Notifications show through the service
worker, or from the page where there is none yet. Permission revoked in the
browser's site settings reads as off.

When the server offers web push (`server.push.webpush` with its VAPID `key`,
§4.9), push is for a signed-in account (not a guest), also while it
reconnects. It is per account on each server, off until turned on, and
turning it on or off in one tab applies in the others. Turning it on (with the
Notifications switch, or its button) subscribes this browser with the
server's key (replacing a subscription made with another key), and sends
`push_register` `{kind: "webpush", url, push_id, keys: {p256dh, auth}, wake}`
from the subscription after each `auth` as that account. Turning it off sends
`push_unregister`. This browser has one subscription for all accounts: it goes
once no account here has push on (also checked on load, for one turned off
while offline), and accounts on servers with the same key share it. When
another server, with another key, holds it, the note names that server's host,
and **Alert for this server instead** takes it over;
tabs don't take it back on their own. Its `push_id`s are kept in IndexedDB for
the service worker, which drops a push for any account push isn't on for.
Subscribing and unsubscribing run one at a time, across tabs too under the
`apron-push` Web Lock where the browser has one, and a step that finishes
after push was turned off, or after the tab moved to another server or
account, registers nothing; waiting for the service worker gives up after 10
seconds. A replaced registration is unregistered, after the next `auth` as
the account it belonged to if not at once (never as another account, whose
registration of the same endpoint it would remove), and while push is off for
the account signed in, this browser's endpoint is unregistered after each
`auth`, in case an earlier unregister was missed; nothing is kept off before
the page knows the account, so a page load doesn't unregister and then
register again. Requests for the same endpoint go one at a time, each after
the last one's reply, so turning push off and straight back on can't apply
in the wrong order. Signing out unregisters; the connection is replaced before
the answer can come, so the unregister is kept for that account and sent again
after its next `auth` (not another account's) until the server answers it.
Once signing out has worked it turns push off for
that account here even when the server can't be told; a sign-out that fails
(with requests still pending, say) leaves push on. A registration the server refuses shows its
message in the setting.

Push's `wake` is the checked scopes that `server.push.wake` lists; when the
server lists none, no `wake` goes and the server's defaults apply. While push
is on, a checked scope the server doesn't push is marked "Only while open"
beside its title. When none of the checked scopes is pushed, push still
registers, with an empty `wake`, which wakes for nothing, and the setting says
so. A change to the choice registers again at once, with the same `url`.

On iPhone and iPad Safari outside a Home Screen app, push isn't offered: under
the Notifications switch, a callout gives the steps to add Apron to the Home
Screen. Where the browser offers to install Apron (Chromium's
`beforeinstallprompt`), the client holds that offer back and shows **Install
app** under the Notifications switch only, never elsewhere, and not once Apron runs installed. The web manifest
(`static/manifest.webmanifest`) names Apron, its icons, `start_url` and
`display: standalone`.

`push_id` names the account: 12 random bytes in base64url (16 characters),
made once per account on each server and kept in `apron.pushIds`, so it
reveals neither. The service worker reads each
push payload's `push_id`, `unread` and `message`, and shows the `message` as
its sender and room. A payload without `message` is a badge push: it only sets
the badge and never shows a notification. This client doesn't ask for those
on web push, where a push that shows nothing may get the browser's own
notice. `unread`
becomes the app badge where the browser has one, cleared at 0; while Apron is
in view, the badge is the page's own unread count. A message notification, the
page's or a pushed one, is tagged with the `push_id` and the `message_id`, and
a room's notifications are ordered by `message_id`: a message older than the
room's newest notified one doesn't notify, and a new one closes only older
ones. The same message again replaces its notification quietly (same tag,
`renotify: false`, silent) while it is showing: a push's with the page's own,
or an edit that newly mentions you, keeping the pushed one's title. Once
dismissed (remembered in IndexedDB), it doesn't notify again. Reading a room
here (its latest message in view, as moves your read cursor, in a window
that is focused, not only visible) closes that room's notifications on this
device up to what you read, pushed or the page's own, as chat apps clear
what you've seen; a window behind another, which notifies of what arrives,
leaves its notifications until you come back to it. Reading a room on another
device closes its pushed notifications here too, up to where you read it, once
this page learns of it: at once while it is open, from the read cursor the
server relays, else when it next lists your rooms and gets your read cursors
again (where the server keeps them). On Android, where the app icon's badge
only shows that notifications are waiting, this is what clears it. Until the
page runs, they stay: web push can't close them without showing something,
which browsers require of every push. Browsers expect each push to
show a notification, and WebKit revokes subscriptions whose pushes don't, so
every push but a badge push shows one: a push with nothing new, one for an
account push isn't on for here, or one that can't be read shows again, as it
is and silently, what is already showing, else the message quietly (never
one older than the room's newest), else "Open Apron to catch up". If the
service worker can't read the accounts push is on for from IndexedDB (as
opposed to their never having been saved), a push for an account shows only
"Open Apron to catch up", with no preview and no badge, since it may be any
account's. A dropped push leaves the badge alone, and so does
the service worker while a page of the app is in view, a tab it doesn't
control yet included (as with clicks). A click
on a pushed notification, or on the page's when its tab has gone, asks the
open tabs for their `push_id`, and the tab signed in to that account opens the
room. With no such tab, a new one opens at it, on that account's server if
push is on for it here. A pushed room that the listed rooms don't include, or
that isn't open after 30 seconds, is dropped. Browsers without
push say so; iPhone and iPad Safari say to add Apron to the Home Screen first.

**Appearance** picks a light or dark theme
over the system's, and an installed font for the interface, messages and code
(suggested from installed fonts where the browser allows listing them); the
font choice is marked experimental, to be replaced by a choice of themes. All
of these stay on this device; settings aren't synced.

**History** keeps what a signed-in session has loaded on this device, for
**30 days** unless changed (a day, a week, a year, everything loaded, or not at
all), and with it how far each joined room is caught up. The next visit shows it
at once and goes on as a reconnect does: each room asks the server only for what
came after its checkpoint (§4.3.5), and the joined listing only for rooms that
changed since (`latest_log_id`, §4.2.1); a thread opened again goes on from
where its last load got to. Each room opens with the newest fifty entries of its
log (messages, reaction sets and joins and leaves); as
you scroll back, older pages come from this device first, then from the server
once what is kept runs out, as messages older than the retention do. The retention counts by when a message
was logged, on servers whose `log_id`s are times (as the reference servers'
are); elsewhere everything loaded is kept. A room last caught up before the
cutoff starts over from its newest page rather than paging through everything
since (a quiet room saved recently counts as caught up then, however old its
last message). It is kept only for a session saved here (an account, or a token the
server resumes), never for a guest, and only in a browser that can list its
databases (so signing out can find it to delete); signing out removes it, as does choosing
not to keep any, in any tab: the others stop writing it back, and a retention
chosen in one tab holds in the others. Each account's history on each server
is kept apart, in a database of its own: switching to another server, or
connecting again from the sign-in screen, goes on from what was kept for that
server in the same way, and leaves the others' as they are. One account's is
kept per server, as one session is saved: signing in there as another deletes
the one before. One tab
writes at a time; another takes over when it closes. Preferences says how much Apron keeps on this device, and why it stopped
keeping more if the device ran out of space.

**Search local history** (first in the room header's ⋯ menu, or Ctrl+F, ⌘F on a Mac, in place of the browser's find while signed in and no other dialog is open)
starts narrowed to the open room or thread (`room:#general `, the caret after
it; Backspace widens it to everywhere), and looks through this server's history kept on this device for the
account signed in (none as a guest, or while keeping is off) and what the page has
loaded, as you type: a message matches when its text holds what is typed, as
one run (in any case, with or without accents, any spaces as one; quotes around
all of it are dropped). `user:` keeps what someone sent, by
`@user_id` or name (`user:@ada`, `user:"Ada Lovelace"`), and `room:` what is in
a room and its threads, by `#room_id` or title (`room:#general`); several of
one filter keep what matches any of them, and filters alone, without text,
list everything they keep. Typing a filter's value suggests people for `user:`
(everyone met) and rooms for `room:` (as the composer's `#` does), below the
field: ↑ ↓ move, Enter or Tab puts in `@user_id` or `#room_id` and a space, and
Escape puts the suggestions away. The newest hundred matches are
listed, newest first, each with its room (a thread's with its room after it),
sender, time and a line of it with what was found marked; ↑ ↓ and Enter, or a click,
open one where it is, paging back to it from this device as a link to it does.
One too far back to reach that way says so. The field's note says what is
searched: what is kept here, and for how long, or only what is loaded, for a
session that keeps nothing (a guest, "Don't keep", `/__preview`, `/archive`).
Its title's "history" links to Preferences at History (over the rooms list,
on a phone), where what this device keeps is chosen. There is no server search
in the protocol, so nothing is asked of the server.

**Export** saves what this page has loaded from the server as a `.jsonl` file
(`apron-<host>-<day>.jsonl`, in the format [ARCHIVE.md](../ARCHIVE.md)
specifies): the rooms and threads the rooms list shows, the rooms those are
threads of, and each room's records from the oldest page loaded to its latest,
compacted as the client keeps them (§4.3.4): each message's latest snapshot,
each message's reactions, and the join and leave records, with who you are and
the users as they were, without their statuses. A quoted message from before
that, or from another room, goes along only as the quote. Threads listed but
never opened load their newest page first; older messages of a room are in the
export only once scrolled back to (or restored on this device). **Open an export** opens `/archive` in a new tab, where a
chosen or dropped export opens in this same app, read-only, against a server in
the page that serves only that file: it signs in as the export's `you`, as a
guest who may only read (`ext:permissions` `write: false`), lists its
rooms and threads as they were joined, pages their history, and refuses
anything that would change them. The read-only bar says where and when the
export was saved, and offers no sign-in: the server offers only guests'. Nothing is sent to the exported server and nothing is
remembered, as in `/__preview`. An export names the sites its images load from
(the server's origin and those it named for its media), and since a file can
name any, `/archive` lists them and asks first: **Load images**, or **Open
without images**. Either way the page is held to **This server only**, whatever
Media says (until it's changed there): with images, media loads from the sites
it named and nowhere else; without, from nowhere, so images show as links,
avatars as initials, and cards without pictures.

With the `command` capability, composer text that starts with one `/` is a command
([PROTOCOL.md §4.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#41-command)): the composer shows a **Command** tag, sets the line in
monospace, and **Run** replaces **Send**. `/nick` (a `me` request), `/join`,
`/leave`, `/topic` (`room_join`, `room_leave`, and `room_set` with the room's
new `description`), and `/kick @user` and `/invite @user` (`room_leave` and
`room_join` with that `user_id`), with the `rooms` capability, are handled by the
client. `/kick` with a reason goes to the server, which alone can carry one,
and so do `/kick` and `/invite` once the server has answered them
`unsupported` (the one that got that answer is sent on as a command); anything
else goes out
as a `command` request with the params a message would have — `room_id`, the
text as typed, `mentions`, `reply_to`, and attached files as `upload` embeds —
and is never posted. `/help` lists what the server offers. The server's replies
arrive as notices, and a failed command shows its error as a local "System
message to you" notice and gives the draft back. `//` posts a message starting with one `/`.
Without the capability, `/` text is an ordinary message.

With the `activity` capability, reading the latest message of a room advances your
read cursor (`read_message_id`), which the server syncs across your
connections. Each room's goes to the server at most every 10 seconds: the
first at once, and the latest of those that came sooner at the end of the
interval, or at once when the page is hidden (it may be closing), or once
signed in again if the connection drops first (not if another account signs
in: they were the previous account's). A server whose settings say
`read_cursors: false` (below) keeps no cursors: the cursor still moves here,
but isn't sent.

Whatever the server offers, this device keeps how far you have read each room
and thread (a thread's own) for the next visit, in `localStorage`, per account
(guests without a kept session on a server share one): your read position. It is the furthest of the
latest message you had in view here, your read cursor as the server reports
it, and your own newest message, since one sent from another device says you
had read the room up to it. It only moves forward, and nothing of it is sent.
Opening a room or thread places a **New** divider above the first message after
your read position as it was when you arrived; it stays put while you read. The
pane opens at the divider, just below the top with what is new under it and
the jump button counting it, rather than at the latest message, unless
something moved it first (a jump to a message, your own scroll, or sending). A
thread that opens on its newest replies first loads its older ones back to the
divider. Only once you reach the latest message does your read position, and
your read cursor, move past what was new, or the pane's unread count clear.

The unread counts (each row's bubble, its `@` for mentions, and the tab title)
go by the read position too, so a reload, or coming back the next day, keeps
what you hadn't read: a joined room counts the messages from others after your
read position among those loaded (its newest page, or since it was last kept
here), and the mentions of you among them, which turn its bubble orange but
never pulse or notify. That takes a server that keeps your read cursors
(capability `activity`, without `read_cursors: false`), which carry what you
read on your other devices; elsewhere, as without a read position for a room,
only what arrives while the page is open counts, so nothing you read on
another device counts again here. A thread counts once it is opened, as its replies load only then.
A room someone else added you to counts from your join.

With the `rooms` capability, rooms come by request ([PROTOCOL.md §4.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#42-rooms)): right behind
`auth`, without waiting for its result ([PROTOCOL.md §3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#32-authentication)), the client lists
the rooms you have joined with `room_list` (`filter: "joined"`, `members:
true`), which is the complete set, threads included (if that `auth` fails, the
listing ran as the connection was, signed in as no one, and is dropped), and keeps it current from
`room_update` (`joined`, `left`, `updated`) and each room's members from the
membership records in its `memberships` ([PROTOCOL.md §4.2.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#422-membership)), as in a
`history` page's `memberships`. Only joined rooms deliver live. Without the capability there is the server's default room, posted to
without a `room_id` until a message names it, plus any room a message arrives
in, titled by its `room_id`.

Threads are rooms with a `parent_room_id`. A thread without a title is called
"Untitled" wherever it's named (its sidebar row, card and Moved to line, the
header, the move menu, the composer's "Reply in Untitled", room chips,
notifications), with its `room_id` on hover; a top-level room without one is
still called by its `room_id`, since several untitled rooms side by side would
be indistinguishable, unless it is private (below), when it is named for its
members. The sidebar lists top-level rooms (ordinary ones under **Rooms**,
private ones under **Private**, below)
and, under the open room, its threads in two groups. Under a room that isn't
open, it lists only that room's joined threads with news (unread replies or
mentions), in the same rows, so activity there isn't missed; picking one opens
its room with the thread open, and quiet threads wait until the room is opened.
Picking the open room again while reading it folds its threads the same way, to
those with news (on a phone the rooms list stays, its › going back to the room), and its row
shows a small **…** button before its **+** that says the list is cut short; the
**…**, or picking the room once more, unfolds them. A folded room stays folded as
you go to other rooms and come back (kept on this device, per account on each
server), and a thread you open in it is listed, picked out, while you read it. First the ones you've joined,
on a guide line from the room, most recently active first (by their newest
message, else the newest `log_id` the server reported, else their creation).
While the pointer or keyboard focus is on the list its rows hold still, a
thread that just got a reply moving up once it leaves, so nothing slides out
from under a click; a new thread leads at once:
each title in ink, heavier with unread replies, over up to two lighter lines:
its Description (its `description` as text, on one line) behind a text icon, then
its latest loaded message, the sender's name in ink, behind a reply arrow, in
ink too with unread replies. Either line shows alone when the thread has only
that one, and the icon says which it is. Only what's new is counted, in one
bubble: unread replies in grey, turning orange with an `@` when they include a
mention of you (the row tinted too); a thread with nothing new shows no number
and steps back, its title muted and its lines dimmed. A room shows the
same bubble for its own unread messages (its threads count their own), with
its name in bold, and none while you're reading it. The open room or thread has a neutral fill and an
accent bar at its left (on the window's edge for a room, on the guide line for a thread), so it never looks
unread. A row's fill, open or under the pointer, reaches the sidebar's outer edge and is square there, rounded
inside; the member list's rows do the same at its far edge. A door on hover leaves the thread. Then **Other Threads · N**, a heading
that folds as the sidebar's do, to the one you're reading if it's among them,
with the **…** at its end (it stays as you left it, on this device): the
threads you haven't joined, beside the guide line carried on dashed, their
titles muted, each with its Description line (from its listed `description`) and,
at the end of the row, when it was last active (`2h`, `Tue`, from its listed
head). They deliver nothing live
([PROTOCOL.md §3.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#34-rooms))
and so have no counts or latest message. It shows the three most recently active (the
server's `room_list` order) and the rest on **N more…**; picking one reads it
without joining (it stays in this list, picked out, with its Join showing, also
while the list is folded or past the first three), and **Join**, a door-in
button on the row (on hover, where it takes the time's place, or always on
touch, beside it) as Leave is a door out, joins it and opens it once its
`room_update` arrives. Leaving is how a thread is put
away: it stops counting unread and alerting, moves down to Other Threads, and
does so on every device, since it's a membership; its card stays in the room.
The protocol lets a client hide threads, so nothing here is a server limit.
The room feed shows each thread as
a card where it was started with the same preview lines as its sidebar row
(the shared `ThreadLines`): its description as text, up to three lines, then
its latest loaded message, each marked by its icon. When it was last
replied to sits at the right of its title line, unlabelled: `now`, `12m`, `9h`,
`12d` within two weeks, then the day (`14 Sep`), with the exact time on hover. Cards cover threads you haven't joined, which `room_list` with the
room's `parent_room_id` finds whenever the room is opened or its threads are
listed; that listing is also what refreshes their cards, since they deliver
nothing live. Opening one of those reads it through `history` without joining
it: its header offers **Join**, which makes it live and lists it under the room,
and replying joins it first.
Every new thread is named in the same centered **Start thread** dialog, with the
`rooms` capability: a title (required) and an optional CommonMark **Description**
(`room_set` with `parent_room_id`, `title` and `description`, which an emptied
Description leaves out). The thread opens once its `room_update` arrives, and the
dialog stays open, with the server's error, if creating fails. There is no
Private choice, since a thread takes its room's; in a private room the dialog
says the thread will be private too, and one that comes back without
`private: true` gets the error described below. A **+** on the open room's row
opens the dialog empty (on a phone, over the room list; the thread then opens
in place of it); Start thread on a message and New thread in select mode
fill it in (below).
The **+** beside Rooms in the sidebar creates a room in the same centered
dialog, as **Create a room**: a title (required), an optional CommonMark
description (`room_set` with `title` and `description`) and the **Private**
choice; it opens once its `room_update` arrives, and the dialog stays open,
with the server's error, if creating fails. **Private** asks for
`private: true` ([PROTOCOL.md §4.2.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#424-creating-and-editing)):
a server that keeps no private rooms answers `unsupported`, which the dialog
says in words; one that creates the room without `private: true` in its record
gets an error toast instead of an opened room, so nothing meant to be private
is posted there (the room stays joined, to leave or use knowingly). A thread
is created without `private`, since it takes its parent's, and edits never send
it, since an omitted `private` is kept: a new thread of a private room that
comes back without `private: true` gets the same error, and neither the reply
composer opens on it nor do selected messages move into it. Private rooms and
threads show a lock beside their name.

The sidebar's section headings fold as picking the open room does: **Rooms** or
**Private** folds to the rooms with news, in them or in their threads, and
the open room (which reading would otherwise take away), and the heading shows
the **…** before its **+**; the **…**, or the heading again, shows them all.
**Other Rooms** folds alike, to nothing, as its rooms have no news. Each starts
open and stays as you left it, on this device.

**Rooms** and **Private** list their rooms in an order kept on this device, per
account on each server, rather than the order a server happens to send them in,
which may differ from one visit to the next. A room takes the next place the
first time it's listed, so a new one goes last and nothing you arranged moves.
Drag a room by its row to another place in its own section: with a mouse it
lifts once the pointer has moved a few pixels (a click that drifts stays a
click); on a touch screen hold it for a moment and it
lifts (a tap still opens it, and a swipe still scrolls). While it's carried
every room's threads fold away, so the list is just its rooms and the others
make way for it, and they come back as they were once it's dropped. They fold
around the room in hand, which stays under the pointer: threads above it fold
toward it (the sidebar scrolling back, and a gap left above the section for
whatever it can't), and the room let go stays where it was as they come back. It keeps to
its section's column, moving only up and down within the part of the section in
view, so it lands where it's seen; carried past either end it goes to that end. While a
room is carried the sidebar scrolls only to bring more of its section into view,
as the pointer nears the sidebar's top or bottom, never past the section, and
nothing scrolls under a pointer that isn't near either. A
drag starts only from the room's own row, not its threads, its **+** or its **…**, and never opens the room. From the
keyboard, Alt+↑ or Alt+↓ on a room moves it a place (as in the WAI-ARIA
rearrangeable listbox; its row names the keys as `aria-keyshortcuts`), the keyboard staying on it and the move announced. In a
folded section a room moves among the ones shown, the hidden ones keeping their
places. Threads keep their own order, most recently active first.

The sidebar's **Private** section, right below Rooms and above Other Rooms,
lists every joined top-level private room (`private: true` and no
`parent_room_id`, [PROTOCOL.md §4.2.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#424-creating-and-editing)):
conversations started with people and titled private rooms alike. Nothing is
read from a `room_id`, which is opaque. Its threads stay under it as under any
room, and its rows count unread messages and mentions, open, and show the open
one as Rooms' rows do, with no lock, since the section says so: in place of the
lock, the faces of who it's with, one person's 20px avatar with their status
dot, or two of a group's stacked, or yours where you're alone in it. A private
room without a title is named for its other members, by display name, sorted
and joined with ", " ("Dev, Mira"), or "You" when no one else is left, or
"Private room" while its members aren't known; the one naming rule is the
client's, so the sidebar, the header, the composer's "Message Bob", room chips
and notifications (just "Bob" where the room is named for its sender alone)
agree. A titled private room keeps its title, with the same faces. The
section shows whenever you're in a private room; with none, it shows (empty,
just its heading) only where you could start one, for its **+**, **New private
conversation**, which is there for an account signed in (not a guest) on a
server with the `rooms` capability. Guests see the private rooms they were
added to, and start none.

**Message** on a profile card opens the private room you already have with
that person: joined, untitled, and with exactly the two of you as members
(from a complete member list). Otherwise it starts one, saying "Opening…" on
the button: `room_set` with `private: true` and no title, which joins you;
once its `room_update` `joined` record arrives and says `private: true`, adds
them with `room_join` and their `user_id`, then opens it. A server without
private rooms answers `unsupported`, which the card's note words as "This
server doesn't have private rooms."; any other refusal, such as a limit
(`denied`), shows the server's message as it is. A room that comes back
without `private: true` gets the same error as a room created private from
Create a room, and no one is added to it. One that started but couldn't add
them is kept, and the note says who couldn't be added and why.

The **+** beside Private opens **New private conversation**, a centered dialog:
**To** holds the people picked as chips (each with its ×), over everyone the
client knows but you and the system identities, sorted by name, each with
their avatar, status dot, name and `@user_id`, narrowed by a name or
`@user_id` typed in the field. The field is a combobox and the people a
listbox: the arrows move through them, Enter picks (or takes back) the one the
keyboard is on, and Backspace in the empty field takes back the last chip.
While no one is picked, someone you already have a conversation with says
"Already talking · Open", and picking them opens it; once someone is picked,
they join the chips instead, for a group. With two or more picked, an optional
**Name** sets the room's `title`. The primary button reads "Message Bob" for
one person, else "Start conversation". It creates the room as Message does,
then adds each person in turn; an add that fails doesn't stop the rest, the
room is kept and opens, and a toast says who couldn't be added and why. Where
the server states a limit (`ext.settings.private_rooms`, [EXT.md §3.1](../EXT.md#31-apron-web)),
the dialog's foot says how many private rooms you're in of it ("2 of 5"), and
at the limit a warning takes the people's place, with your private rooms, the
quietest first (five, and "and N more"), each with **Leave**, and the primary
button can't be used.

An untitled private room's header shows its faces before its name, and under
it who can see it: "Online · only you and Bob can see this room" with one
other person (their status, where the server sends one), else "Only members
can see this room". The header keeps its plum wash and lock. Once its history
reaches back to its creation (all loaded, and its `history_log_id` at or
before the room's first record, or none retrievable at all), a private room's
timeline starts with a card: its faces, its name, the person's `@user_id`
and the first line of their bio for a conversation with one person (else how
many members), and "Private room. Only members and the server host can read
messages here. Only members can add others." Nothing in it says how long
messages are kept: that is the server's.

A private room that arrives in a `room_update` `joined` without this page
having asked for it (no room creation or join of it in flight, and not one
it started) is one someone else added you to: until its × puts it away, it
shows "You were added to this private room." under its header, with
**Mute** (the room's own mute, `status` with its `room_id`, where the server
has the `status` capability and you're signed in to an account; **Unmute**
once muted), **Leave** and the ×. Which rooms still show it is kept on this
device, per account, until it's put away or you leave. In a private room the
member list's **+** and a profile card's **Add to room** are offered even
without `add_members` ([EXT.md §7](../EXT.md#7-extpermissions)), and moving
messages into one of its threads adds their authors, since members of a
private room add people to it. Elsewhere they are offered where the
server grants you `add_members`, or on a server without `ext:permissions`,
which decides each add itself (a refusal shows its reason). Leaving a private room asks first and says it can't be
joined again (only someone in it can add you back), or, as its last member,
that it ends when you leave: the server removes it then.

A room's or thread's `description` (CommonMark by convention) shows as a
**Description** pinned under the header, above the timeline, so it stays in view
while the messages scroll: rendered as CommonMark beside the description icon (its
title says Description), the text indented past it on every line, three lines of it, fading
out where a longer one is cut. A click on its text (not on a link or mention)
opens the rest, scrolling within the description past a third of the pane, and
another folds it again; from the keyboard, its toggle is the next stop after
the text's links. Its × puts it away, on this device, until
the description is edited; a room's then shows as one line of text under its
title in the header instead, and the header gains a **Description** button, just
before its ⋯ menu (the icon alone on a phone), that pins it again. With the `rooms` capability the header's ⋯ menu
holds the occasional actions: **Edit room** (or **Edit thread**) opens
a centered dialog with the open room's or thread's title and description, saved with one `room_set`; the `room_update` that
follows is what shows, since the server may alter or decline it.

With the `rooms` capability, **Start thread** on a message opens the same
dialog to name the new thread: its title starts as the message's first line,
selected so typing replaces it, and its Description as the message's text quoted
in Markdown (`> `). **Start thread** there creates the thread under the room
with that title and Description as its `description` (a title is required; an
emptied Description sends none), and opens it with the composer replying to that
message. Threads don't point at a message, so
the thread's first reply carries the link back as its `reply_to` (the
convention of the protocol's fixtures): its quote shows the message and jumps
to it. The message stays in the room, with the thread's card after it. A
thread's description shows as its pinned **Description** (above). A thread opens
at its latest reply, as a room does. Threads load their newest page of
history when opened (50 records); one with older replies shows "N+ replies",
and loads the page before whenever the reader nears the top, keeping what is
on screen in place. Drafts are kept per room, threads
included.

The address names where the page is, all in the fragment, so the host serving
this app never learns which server, room or message anyone opens:
`#server=wss://chat.example/ws&room=general&thread=t-1&message=1724803200042`,
leaving out `server` when it is the one the page connects to anyway, and
`thread`, `message` and `user` (whose profile card opens) without a room.
Opening one, or pasting one into an open tab, goes there; one on another server
opens the connect screen for it first. Each room or thread opened is a browser
history entry, so Back returns to the previous room or thread, and Forward the
other way, until Back leaves the page from the first room opened. A room left since stays put
for that step, and a thread left since is read without joining.

With the `rooms` capability the header's ⋯ menu also offers **Leave**, which leaves the room or
the thread after asking; a thread's door in the sidebar leaves it without
asking, since Join brings it back from the same list. A thread is a room of its
own, so leaving its parent keeps it. A
server that keeps you in a room answers `denied`, and its message shows as
the error.
**Other Rooms** in the sidebar lists, via `room_list` with
`filter: "not_joined"`, the most active visible rooms you haven't joined, each
with its member count and **Join**. It starts open, so a newcomer sees what
else there is without looking for it, and folds as the other sections do;
unfolding it lists afresh.
Picking one joins it and opens it once its `room_update` arrives.

With the `edit` capability, several messages move at a time: shift-click a
message (or press `x` on it, or pick **Select** from its More menu) to enter select mode, shift-click another to fill the range, and the
selection bar replaces the composer with the count, **Move to thread** (or, in a
thread, back to the room), **New thread** (with the `rooms` capability) and Cancel. A
move is a save of the message with the destination's `room_id`, one request per
message. Anyone's messages can be picked, and the server decides whose you may
move: your own, and anyone's where the server grants `move_any`
([EXT.md §7](../EXT.md#7-extpermissions)). A move is all
or nothing as far as that goes: when the selection holds a message that isn't
yours, that one is sent first, alone, and if the server refuses it nothing else
is sent, the selection stays, and the error says no messages were moved. Otherwise
the rest go together. **New thread** opens the Start thread dialog (as **Move to a
new thread**, saying how many messages move) with the earliest selected
message's first line as the title and an empty Description; Escape there closes the
dialog and keeps the selection. The thread is created first and the moves follow
once the server has named it; the dialog isn't offered when the selection holds
someone else's message and you lack `move_any`, so a refused move
never leaves an empty thread. If the moves fail once the thread exists, the
dialog closes and the error says so, as for any move. Messages refused after the first (say, over a posting limit)
stay selected and the bar says how many didn't move. A thread delivers to its
members only, so once messages move into one (new or existing, but not back to
the room), each of their authors who isn't in it yet is added to it (`room_join`
with their `user_id`, §4.2.2), where you may add people: in a private room's
thread, or where the server grants you `add_members` (or lacks `ext:permissions`). The server
decides each (it adds no guests); the moves stand either way, and the toast says
how many authors weren't added and why. Escape leaves select mode.

A reply's quote is one line above the sender's name (the quoted sender's
avatar and name, then the start of their message), with a line from the
reply's avatar bending into it. A markdown message is quoted as plain text, as
are a link card's lines and a message's notification: `**0 errors**` reads
"0 errors", code keeps what's in it, and a link shows its text. A reply always starts a new sender group, so
it always has that avatar and name. The quote may point into another room:
clicking it opens that room or thread, loading the thread's history if needed,
and highlights the message.

On touch screens a message's actions wait for a long press, which a finger
may drift up to 10px through (further is a scroll), or the system's own long
press; a tap shows nothing, and messages take no text selection, so a stray
press doesn't select words or pop the toolbar. The press opens a larger
toolbar with **Reply** and **React** up front and ⋯ opening the rest as a
menu of rows: Start thread, Edit, Select, **Copy text**, Copy link, Remove reply
reference and Delete, as each applies. A tap on the message, Escape or focus
leaving puts it away. A press on a reaction chip, a link or media is theirs.

With the `reactions` capability, a message's **React** action opens the full emoji
picker right away, its frequently used row starting from emoji-mart's own
defaults; a pick toggles your reaction with that emoji. The pick goes on the
message it was opened from, whatever arrives meanwhile: the picker names that
message above itself (“React to Ada” and its first line), since new messages can
scroll it away or, on a phone, under the sheet, and while the picker is open that
message keeps its hover highlight and no other message takes one. Reactions show as chips under the message: emoji and count,
highlighted when one is yours, with a tooltip naming who reacted. Clicking a
chip toggles your reaction. Right-clicking a chip (or the context menu key on
it), or long-pressing it on touch, lists everyone who reacted with that emoji,
you first, each with their avatar, name and `@user_id` where it differs: a
popover beside the chip (a bottom sheet on narrow screens) that follows
reactions as they change, and closes with Escape, a press outside, tabbing out,
or once nobody is left on it. The list opens even where you can't react. A long
press on a chip doesn't toggle it or enter select mode. Tombstones show no reactions.
Entries that differ only in U+FE0F, such as ❤ and ❤️, are one chip, shown in
the fully-qualified form; the picker sends that form, and a toggle takes away
whichever form your set has ([PROTOCOL.md §4.7](https://github.com/shazow/apron/blob/main/PROTOCOL.md#47-reactions)).
An entry that isn't an emoji sequence is a key, such as `:partyparrot:`: a
chip shows its custom emoji's image where the server's catalog has it
([EXT.md §9](../EXT.md#9-extemoji)), with its `alt` in the tooltip, and
otherwise a dashed placeholder with the key in the tooltip. Clicking either
toggles your reaction with that key.

Typing `:shortcode` in the composer opens an emoji autocomplete; arrows move,
Tab or Enter inserts the highlighted native emoji in place of the shortcode,
and Escape dismisses it. Suggestions search emoji shortcodes, names, aliases and
keywords, and with `ext:emoji` the server's custom emoji first, by key, `alt`
and tags, which insert their key. A key in a message, a description, a
welcome or the server's description shows as its image, at the height of the
line, once the catalog has arrived (it is fetched the first time a key shows
or a picker opens); keys in code stay text. The composer's emoji button (always there: emoji are text) opens the
same full picker and inserts the emoji at the caret, over any selection,
leaving mention chips and command mode as they were. The picker is
[emoji-mart](https://github.com/missive/emoji-mart), drawn by `EmojiPopover`
outside the app shell so nothing clips it: a popover beside its button on wide
screens, a bottom sheet on narrow ones, in the app's theme and tokens. Escape
or a press outside closes it. The emoji data loads with a dynamic `import()`
when shortcode autocomplete is first used; emoji-mart itself loads dynamically
the first time the full picker opens. Both stay out of the main bundle, and the
picker gets its data, English strings and native glyphs passed in, so it never
fetches from a CDN. With `ext:emoji` it lists the server's custom emoji too,
without hidden ones, each under its category after the standard emoji; a
pick reacts with or inserts its key.

Embeds render by kind, in the design system's components ([PROTOCOL.md §4.8](https://github.com/shazow/apron/blob/main/PROTOCOL.md#48-embeds-and-avatars)):

- **Uploads** (capability `embed:upload`): files picked with the paperclip,
  dropped anywhere on the conversation (which shows a "Drop files to attach"
  outline while they are dragged over it), or pasted, and voice clips from the
  microphone, are attached to the draft rather than sent. A paste attaches
  files whether or not the field has focus; pasted text wins over a picture of
  it, as office apps copy both, unless the text only names the copied files,
  as file managers add. Folders are left out of a drop, and a file dropped
  outside the conversation is refused rather than opened in the tab. Attached
  files show above the composer (the design system's `Attachments`: an image as
  a thumbnail, audio with a player, anything else as a file card), each
  labeled with its name and the size it will be sent at — "Preparing…" while
  an image is still being shrunk, then its new size and name (a re-encoded
  photo becomes `.webp`),
  each with an **(x)** to take it off, and are kept per room or thread like the
  draft's text. Clicking a file's name (hovered or focused, its size line reads
  **Rename**; on touch a pencil follows the size) turns it into a field holding
  the whole name, extension included and all selected: Enter or clicking away
  keeps the new name, Escape the old one, and an empty name changes nothing.
  The file is sent under that name, as the embed's `title`. A long name
  loses its middle rather than its end, so its extension stays in view. Images start shrinking as soon as they are attached; one that
  can't be made small enough comes off again with the reason. Where the server
  states the types it takes and their limits
  ([EXT.md §6](../EXT.md#6-extmedia)), images shrink to those limits, the
  file picker offers only those types, the microphone shows only when one of
  them is an audio type the browser records, and a file of another type, or
  one over its type's limit that can't be shrunk (audio, video, an animated
  image), comes off again with the limit. Send (with or
  without text) posts the message with one `upload` embed per attached file,
  then writes each file to the `write_url` in the result. A failed send gives
  the draft back with its files. The message shows a pending
  card with progress until the server publishes the finished file: an image, a
  video or audio player from its `og`, or else a file card. A write the server
  refuses (a file larger than it takes, say) shows its sender "Upload failed"
  with the reason. The server then drops it from the message (§4.8.3); one
  still pending ten minutes after its message was sent (its sender left
  mid-write, or the server never dropped the failed write) shows everyone
  "Upload failed" instead of uploading. A failed card recedes: dimmed, with a
  crossed-out file, and no longer dashed. A plain click (or
  Enter) on an image opens it full screen in the image viewer: its name, who
  sent it and when, **Open original** (the file, in a new tab) and **Close**,
  with ← and → (and the arrow buttons) paging through every image in the open
  room or thread, oldest first. Escape, Close, or a click beside the image
  closes it, with focus back on the image last shown. A Cmd, Ctrl, Shift, Alt
  or middle click keeps the link's own behavior: the file in a new tab or window.
- **Terminals** (`terminal` embeds, capability `embed:terminal`,
  [PROTOCOL.md §4.8.6](https://github.com/shazow/apron/blob/main/PROTOCOL.md#486-embedterminal)):
  a card titled by the embed's `title` (else "Terminal") over a real terminal
  emulator, xterm.js, loaded the first time a terminal is shown, 80 columns by
  40 rows: colors (16, 256 and true color), emphasis, carriage returns
  (progress bars), cursor movement, erasing, box drawing and the alternate
  screen of full-screen programs all show as a terminal would show them. A
  bare line feed starts a new line, as a terminal's driver would make it. The
  font is scaled so the 80 columns fit the message's width, at most 13px on a
  wide screen (about 6px on a 390px phone, 5.5px at 360px; the page never
  scrolls sideways), and only the rows down to the last one written show,
  unless a program is on the alternate screen, which shows all 40; nothing
  scrolls inside it (no scrollback: what scrolls off the top is gone, as on
  the terminal), and a wheel or swipe over it scrolls the page. It only reads:
  nothing typed reaches it, its cursor isn't drawn, and nothing a program
  prints acts outside it: no window title, bell or clipboard (OSC 52), its
  answers to queries go nowhere, and OSC 8 links show but open nothing.
  While the embed has no `output` it is live, under a Live badge: the client
  reads `url` with a streaming `GET` and writes each chunk as it arrives. A
  drop or a failure keeps what it shows and tries again (after 1 s, then
  longer, up to 15 s), and the new response replaces it, from a fresh
  terminal. Once `GET` ends it says Ended, and when a snapshot carries
  `output`, it shows that, from a fresh terminal, as Finished.
  **Expand terminal** (the ⤢ in its header, or on a touch screen a tap on
  the terminal; a mouse click there still selects text) opens it full screen
  in the terminal viewer, on the image viewer's dark ground: its title, Live
  or how it stopped, and **Close**, over the same 80 by 40 screen at a
  readable size. The font is the largest that fits the 80 columns in the
  viewer's width and, where the screen is tall enough, the 40 rows in its
  height (about 17.75px at 1280×900), but the rows never take it below 13px
  (a phone on its side, 844×390: 13px, and a screen using all 40 rows
  scrolls up and down inside the viewer), and the columns never take it
  below 9px (a phone upright, 390px: 9px, and the screen scrolls sideways
  inside the viewer; the page never does). It shows the same text as the
  message, live or finished, and keeps up with it as it arrives, without
  reading `url` a second time (a server caps how often a live text is
  read). Escape, Close or Back closes it (opening it adds a history entry),
  with focus back on Expand, and it closes if its message goes.
- **Live text in the body** (`append` embeds, capability `embed:append`,
  [§4.8.5](https://github.com/shazow/apron/blob/main/PROTOCOL.md#485-embedappend)),
  such as a model's reply as it writes: no card. The message shows its
  `body.text` and right after it the text `GET url` has streamed so far, as
  one text in the body's format (Markdown rendered as any message is), with
  a quiet "Writing…" under it while the text arrives. The bytes are decoded
  as UTF-8 as they come (a character split between chunks shows once whole),
  and the body is redrawn at most once an animation frame. While it is still
  arriving, Markdown cut off mid-construct is settled for display only: an
  open code fence or code span is closed, an odd `**` or `~~` in the last
  paragraph is closed after the text so far (or held back with nothing after
  it), a link whose destination hasn't closed shows as its label, and a last
  line that is only a list marker, or a `-` or `=` that would make the line
  above a heading, waits for more. When `GET` ends (Writing… goes) or fails,
  what it shows stays until the snapshot without the embed arrives, with the
  text in the body; a failure tries again, and the new response replaces what
  was streamed. Edit, Copy text, a reply's quote and a thread's preview use
  the message as recorded (`body.text`), never the streamed text, and a save
  sends the embed back by its `embed_id`, so editing doesn't end it; leaving
  it out of a save (its tile's (x) in the editor) ends it there, dropping what
  had arrived. A message with only live text and none yet shows as "Live
  text" in previews and notifications, and one with only a terminal as
  "Terminal" or "Terminal: its title".
- A `stream` embed (protocol v9 and before) is a kind like any other the
  client doesn't know: it shows the fallback card.
- **`iframe`** embeds stay a paused placeholder until **Load live view**, then
  load sandboxed (`allow-scripts`, never same-origin, no referrer), clamped to
  480px. **`html`** embeds are sanitized with DOMPurify before insertion.
- Any other kind renders from its `og` as a link card, else as the fallback card
  with its kind name and its `url` or `text`.
- **Link previews**: any link in a message is checked against a map of sites
  by host (`SITES` in `link-sites.ts`), and up to three links on those sites
  each get a `link` embed, with an `og` the sender builds from the site's
  public API, which allows cross-origin reads: GitHub pull requests, issues,
  commits, and repositories (title, state, author, and an excerpt, from the
  REST API); YouTube videos (title and channel, from oEmbed); posts on X
  (author, date, and text, from oEmbed); Bluesky posts and profiles (author
  and text or bio, from the public AppView); and Wikipedia articles in any
  language (title and opening sentences, from the REST page summary). A link
  is looked up as soon as it is pasted, or once typing pauses for a moment;
  each is fetched once, the same page linked two ways (`youtu.be` and
  `youtube.com/watch`) is one preview, and a rate-limited answer pauses
  fetching from that site until the limit resets. A message sent before the
  details arrive, or for a link the API won't describe (a private repository,
  a deleted post), gets a card built from the URL alone where it says enough
  ("Pull request #60", "Post by @jack", an article's title), else none. Images
  are not included. The server may keep, replace, or drop this `og`. The cards show above the
  composer as you write, each with an **(x)** that sends the message without
  it. A failed send restores the draft with those previews still removed;
  otherwise the draft forgets them once it is sent or cleared.
- **Links as chips**: an Apron link in a message's text written as its URL,
  in either form of
  [PROTOCOL.md Appendix A.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a4-links),
  `https://link.apron.chat/#…` or `apron:?…` (no other: `web+apron:?…` is
  neither linked nor read as one; one without `server` is the sending
  server's), reads as a mention that says
  in words what it is, from what this client knows: "Message in #general", a
  room's name, a thread's name "in #general", a known user as `@name`. Each but
  a user's leads with its kind's icon, the same icons as the link cards. A room
  not known here reads as its `room_id`. A link to another server is no place
  here, so it is no mention: an outlined chip in the ink of the text, a globe
  and the server's host first, then "Message" or "Room", and an arrow after,
  since opening it switches servers (the connect screen asks first); nothing
  is looked up for it, and it has no card. Another endpoint on the same host
  is another server. One written with its own text keeps it, and a token, or
  a user on another server, stays a URL. Only a link read strictly as a place
  is drawn as one, as a chip or a card: the shapes Appendix A.4 lists (`room`;
  `room` and `message`; `room` and `user`), every key one of those or `server`
  and given once, every part `key=value` with a value that decodes and is of
  its type (IDs without whitespace, control or bidi characters, a `message_id`
  in `log_id` form), and at most one `server`, one this client can reach. A
  link with a key it doesn't know, or an empty or malformed part, stays a
  plain link, so nothing that isn't what it seems looks official. Each is still
  the link, in its `https` form with the server, so copying it gives a link
  that opens the same place anywhere, a click opens it here, and a modified
  click opens link.apron.chat in a new tab.
- **Opening a link**: a plain click on any Apron link opens it here, read as
  Appendix A.4 says: its keys as `application/x-www-form-urlencoded` pairs,
  each key's first value (a repeat is ignored, so a key appended to a link
  can't replace one before it, PROTOCOL.md §5.4), and keys it doesn't know
  ignored. Only the first `server` counts: if this client can't reach it
  (`wss:`, or `ws:` only to this device), the link isn't opened here at all,
  rather than opening a later `server` that may have been appended to it; the
  click is left to the browser. So is a link with a message but no room, or a
  token but no server.
- **Link cards**: a link to a message, room or thread that this client knows
  more of than where it is also shows as a card under the text, up to three
  per message, in the shape of a link preview. Its first line is where it is,
  as a path: the server's host, the room a message or thread is in, and a tag
  that says which it is (Message, Room or Thread, with a room's member count).
  Under it is what this client already knows: a loaded message's sender, time
  and first three lines (or "Message deleted"), a joined or listed room's name,
  lock if private, and two lines of its description. Nothing is fetched to draw
  a card, and a link with nothing more to show than its path (a message that
  isn't loaded, a room known only by name or not at all, any link to another
  server) has none: its chip says as much. A card is the link, as a chip is.
  The cards follow what the text links, so a link inside code (inline,
  indented or fenced) has none, nor has one to the message itself, and a
  place written twice, with its server and without, has one. A link preview
  another client sent with the message (a `link` embed, or any embed, whose
  `url` is a link to the same place, with or without its server, its keys in
  any order) doesn't show under a card for that place, so the link isn't
  previewed twice; where there's no card, the preview shows.

With the `edit` capability, **Edit** on your own message opens it in place, in
a box like the composer: its text, with its embeds above it as tiles like a
draft's files (an upload as its picture, audio with a player, or a file card;
a terminal as a card with its title, saying "Live terminal" or "Terminal
output"; live text in the body as "Live text", "Still arriving"; a link
preview or other embed as a card named by its title or address; a file card
says what kind of file it is from its name, such as "PDF file"). The message's toolbar hides while it is edited. Each tile's (x) leaves that embed out, and an upload's name can be
changed as on a draft; nothing is sent until **Save changes** (or Enter; on a
phone or tablet Enter starts a new line), which saves the new text and the
embed changes in one save: the embeds left out are dropped, and a renamed
upload gets its new `title` (with its `og.title`, when that showed the old
name, for a server that keeps embeds as given; a server that hosts the file
keeps its own `og`, and the timeline shows the `title`). **Cancel** or Escape
drops it all, and Save with nothing changed just closes. Save is off once
neither text nor an embed is left (delete the message instead), and an upload
still being written has no (x).

Outside the editor, each embed on your own messages shows an **(x)** on its
corner while hovered (always on touch screens), which saves the message without
that embed ([PROTOCOL.md §4.8.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#482-embed-identity)): it is identified by `embed_id`, or by
value on servers that store embeds as given. Removing an upload or a terminal
asks first, since the server deletes its content (a live terminal stops
showing its output). A message's last embed has no (x)
when there is no text (delete the message instead), nor does an upload still
being written.

Media loads from where Preferences, under **Media**, says. **Default** is as Apron always has: `og` media only from the chat server's own
origin and the origins it names with `ext:media`, avatars from any `https:`
site, and images in markdown messages from any site. **This server only**
loads all of them only from the server's origins; **This server and sites I
add** also from the sites listed under it (hosts or URLs, one per line, kept as
`https:` origins); **Any site** from anywhere. Where an image in a message may
not load, it shows as a link to it (its alt text, else its URL), an avatar as
initials, and a card without its picture. Small `data:` images always show.
The choice is kept on this device, and another tab's applies at once. Live
text URLs load only from the server's own origin, whatever the choice; links may
point anywhere `http(s)`.

**Connect to a server…** in the profile editor (the profile bar at the foot of
the sidebar, for guests and accounts alike) opens the connect screen: a WebSocket URL or an HTTP(S) server
base URL, a display name, and a sign-in choice among the schemes the server
advertises (Guest by default; Passkey, below; Email, External and Token, further down). Once the server in the field
has answered, the top of the form shows it as it shows itself
([PROTOCOL.md §3.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#31-server-frame)):
its `avatar` (or its initials) and its `title` (or its host), always above
its address, which a server can't copy as it can a title and an avatar, then
its `description`, and its `server.welcome`
([PROTOCOL.md §3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#32-authentication)),
both rendered as CommonMark and sanitized like a message.
A server without the `guest` scheme opens this screen by itself once, since
nothing works before signing in, and so does a session held for a sign-in
(below) with nothing on screen yet. The server and name
are stored in local storage, and the last few backends are listed under the
form, each once by its address normalized by RFC 3986 (lowercase scheme and
host, no default port, `/` for an empty path, percent-encoding normalized,
no fragment, which a WebSocket URL can't carry; `ws:` and `wss:` are two servers), with the title and avatar its last
`server` frame sent, and always its address. A server is never found by its
title or avatar, and a session token kept under an address written another
way moves to its normalized one. The sidebar's head shows the connected
server, and is not a control: its avatar (or its initials), its title over its
host (with a port that isn't the default), or its host alone without a title,
both cut short with an ellipsis, the host always left to right; its address is
the tooltip. The profile bar at the foot of the sidebar edits your handle, which is
sent with the protocol `me` request after authentication; the editor shows
what the server actually kept. The kept name is the one asked for from then
on, and the one remembered for the next visit, so a server that normalizes
names isn't sent `me` again at each reconnect. With the `command` and `embed:upload` capabilities it
also sets your avatar: a `/avatar` command carrying one `upload` embed
([PROTOCOL.md §4.8.6](https://github.com/shazow/apron/blob/main/PROTOCOL.md#486-avatars)), whose result names the `write_url` the image is written to; the
server applies it with a `user` notification. **Remove** sends `me` with
`avatar: ""`.

The profile editor's Sign-in row offers, where the server's `auth` lists them,
**Sign in with a passkey**, **Sign in with email**, **Sign in externally**,
**Add email** and **Add external sign-in** to a guest, and **Add passkey**,
**Add email**, **Add external sign-in** and **Sign out** to a registered
account. A guest's Add email proposes and approves on the guest's connection,
which adds the address to the guest's account (§4.11); Sign in with email is a
sign-in to the address's own account. Adding needs the
scheme in `auth`, since adding is a way back in and a scheme listed only in
`signup` doesn't sign in (the spec doesn't say whether servers may allow
adding such a scheme; this client doesn't offer it). With the Go reference server, open
`http://localhost:5173` (or `http://localhost:8080` for a static build); other
deployments need HTTPS and configured RP/frontend origins. A passkey registered
on a signed-in connection is added to that account
([PROTOCOL.md §4.10](https://github.com/shazow/apron/blob/main/PROTOCOL.md#410-webauthn-authentication)),
so adding one keeps your guest identity and message ownership; signing in
restores the identity attached to your chosen passkey. **Add email** asks for
an address, proposes adding it on this signed-in connection (`auth` with
`scheme: "email"` and `email`), and approves the proposal with the emailed code
on this same connection (`scheme: "email"` and `token`, no address), which
adds the address to the account and answers `{}` (§4.11.3); a refused code says
the address may belong to another account. A typed code works only on the
connection that proposed it, so if this connection dropped in between, the
form asks for a new code; the link in the email still adds the address (below).
**Add external sign-in** proposes on this connection (`scheme: "external"`,
`return_url` and `state`) and opens the server's page in place of this one; the
page comes back with a link that adds the identity, or, where the server won't
return here, shows a code for the form. Adding doesn't change how
the session signed in: it is remembered beside it, as another way back in.
When, as far as this browser knows, the account has no way back in that the
server signs in with (only a kept token, pasted or an invite, or an account
made with a scheme the server lists only in `signup`), the profile bar says
"add a sign-in" and the Sign-in row suggests a passkey, an email or an external sign-in.

The connect screen's form is the one sign-in panel (`SignIn.svelte`, its
state machine in `$lib/ui/sign-in`), and every way into signing in lands on
it: the connect screen, the profile's **Sign in with a passkey** and **Sign in
with email**, the read-only bar's **Sign in**, and the status banner's **Sign
in** for a held session. Each tap does one explicit thing, and a passkey
sheet only ever opens for a tap:

- On Passkey, the panel asks which of two paths it is, side by side:
  **Sign in** ("I have a passkey", the default) or **Create account** ("I’m
  new here"). The choice comes before any field it needs, and the main
  button runs only that one; Enter does what it says. **Sign in with
  passkey** runs a login: the browser's sheet offers this server's passkeys
  (no `allowCredentials`), and the account is the one attached to the
  passkey picked. **Create account with passkey** registers a new passkey.
  The client never guesses between them: where the server's `signup` lets
  passkeys only sign in or only sign up, the panel doesn't ask and offers
  only that one (on a server that hasn't answered yet, it asks).
- A ceremony needs a connection to the server in the form. Where there is
  none yet (another server, or a held session whose connection closed),
  the tap opens one (as a guest where the server has guests, else signed
  in as no one; a held session reconnects in place) and the ceremony
  follows once it has settled, if the server lets passkeys do what was
  asked. A browser may refuse a sheet that long after the tap: the panel
  then says "Connected. Tap again to continue with your passkey.", ready
  on that connection. Connected as a guest, **Stay a guest** leaves the
  panel as it is. On Guest, **Connect** connects without a ceremony.
- Connected, the sign-in hint says each server has its own accounts, and
  names the server in the form by its host (as code): a passkey saved for
  another server is no account here. A sign-in whose sheet is dismissed
  says "Cancelled."; where passkeys also create accounts, it says
  "Cancelled. No passkey for this server? Choose Create account." and marks
  **Create account** with a dot until another choice or tap. A device with
  no passkey for the server offers only another device or a security key
  (on iOS, a QR code), which otherwise reads as a fault.
- Signing in asks no display name: the account keeps the name it has, and
  the guest's name the ceremony started from isn't sent to it with `me`.
  The form, and the name remembered for the next visit, take the account's.
- Creating an account asks for the display name, the requested `name`
  (§3.2): it goes with the register `begin` so the server can name the
  account and its passkey, the
  client labels the passkey with it too (password managers show the
  creation options' `user.name` and `user.displayName`, which a server fills
  from the guest session the ceremony starts on), and once the account is
  made it is sent with `me` if the server kept another. **Add passkey** in the
  profile labels the new passkey with the account's name. After a passkey
  login, where the browser has the WebAuthn Signal API, the passkey's label
  is updated to the account's display name
  (`PublicKeyCredential.signalCurrentUserDetails`), so a passkey saved under
  a guest's name picks up the account's; this is best effort and never
  waited on.
- The panel is busy from the tap on (also while the client waits for
  requests sent as the old identity to settle). Where the panel has a
  **Cancel**, it stops the ceremony, whether it is still waiting or the
  browser's sheet is up, and closes the panel.

The client makes no WebAuthn request of its own: no conditional (autofill)
or `immediate` mediation and no capability probes, which password-manager
extensions don't always settle. It reads the credential's fields as soon as
the browser returns it and falls back to them when `toJSON` is missing or
throws, as it can for a credential an extension proxies (1Password in
Firefox), or when it disagrees with them (an extension's own `toJSON`
encoding a field otherwise).

A failed ceremony leaves one console entry, `[apron] passkey <action> failed
during <stage>: <message>` (a warning; only info for a sheet the user
dismissed). The stage is `waiting` (for in-flight requests), `begin`,
`browser` or `finish`. The entry holds the error (with the server's code),
the server and page origin, the options that decide what an authenticator
does (RP ID, user name, authenticator selection, algorithms, excluded
credentials; not the challenge), and the credential decoded: whether
`toJSON` or the fields were sent and why, the client data's type and
whether its origin and challenge are the expected ones, and the
authenticator data's flags (user present, user verified, backup), whether
its RP ID hash matches, and its AAGUID with the provider it names
(Bitwarden, 1Password, iCloud Keychain…). Servers answer every
verification failure alike (§4.10 `denied`), so this is where the reason
shows. The connection's own sign-in, as a guest or by a saved session,
warns too when refused, without the token.

A server may let someone only read, such as its guests, and says so in their
`you` with `write: false` ([EXT.md §7](../EXT.md#7-extpermissions)). Signed in
as a guest there, the composer gives way to a bar saying so with a **Sign in**
button (it opens the sign-in panel on Passkey); signed in to an account, or as
a guest on a server whose `auth` offers only `guest` (nothing would lift it,
as on `/archive`), the bar only says so. Replying, reacting, editing, moving and deleting messages,
starting threads, editing rooms and threads, adding or removing members, and
Join and Leave are hidden; a room picked under Other Rooms (which says no
Join) opens to read through its history without joining it, and Other Threads
offers no Join, since picking one already reads it. Other
servers' denials show as errors as usual.

The client understands `ext:settings` ([EXT.md §3](../EXT.md#3-extsettings)):
a server that advertises it in `capabilities` describes how it runs in its
`server` frame's `ext.settings`, `{read_cursors?, private_rooms?}`; without
the capability the client reads none of them. `read_cursors: false` says the
server keeps no read cursors, so the client doesn't send `read_message_id`.
A guest who only reads (`write: false`, above) sees it in the connect screen's
Guest hint too. Other
extension data (`ext`, [PROTOCOL.md §4.12](https://github.com/shazow/apron/blob/main/PROTOCOL.md#412-ext))
on users, messages and rooms is kept as the server sends it, and the client
writes `ext` (with `me`, a message, or `room_set`) only to a server with the
capability `ext`, which keeps it; the app itself writes none.

A refusal with `retry_after` holds back further requests of its method when
that is `history` or `message`, and fails only itself otherwise. A server that
advertises `ext:limits` ([EXT.md §4](../EXT.md#4-extlimits)) may say more in
the refusal's `data.ext.limits`. After `write`, Send counts down under
"Sending is paused", and reactions, joins, leaves and room edits are refused
without being sent; a reaction, join or leave says so in a toast, with the
server's words and the wait. After `upload`, a notice above the composer says
"Uploads are paused", Send counts down only while files are attached, and a
message or command that adds a file is refused without being sent; text, and
an edit that keeps its files, still go. `read`, a category the client doesn't
know, or none holds back by method, as without the extension.

Passkeys use the browser's native WebAuthn JSON APIs, with no frontend dependency.
An up-to-date browser is required; unsupported browsers can still chat as guests.
Browser cancellation and verification errors appear in the profile editor. A
connection change cancels the active ceremony. Chat requests pause while a
ceremony is active, preventing edits from crossing an identity change.

With `email` in the server's `auth` or `signup`
([PROTOCOL.md §4.11](https://github.com/shazow/apron/blob/main/PROTOCOL.md#411-email-and-external-sign-in)),
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
for a new code, though the link in the email may still work (below). The code belongs to the server that proposed it: changing the
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

With `external` in the server's `auth` or `signup` (§4.11.5), the connect
screen's **External** proposes on a connection of its own, as Email does
(`scheme: "external"`, with `return_url`, this app's origin and path, and
`state`), and opens the page the server answers with in place of this one,
but only an `https` page, or `http` on a loopback host; any other `url`, such
as `javascript:`, is refused. The page signs you in however the server
chooses, and comes back with a link. A server that refuses the `return_url`
(`invalid_params`: an origin it doesn't trust) is asked again without it: its
page then shows a code, the connect screen offers the page as a link to open in a new tab, and
the code field approves on the proposing connection, as an emailed code does.
Any other refusal, `denied` included, is shown as the server words it, without
asking again.

Every proposal, email or external, sign-in or addition, carries a new random
`state` (§4.11.1), remembered in local storage for an hour with the server it
went to and whether it signs in or adds, for the account that proposed it. A
proposal outlives its connection (a disconnect doesn't cancel it, and a newer
one on another connection doesn't either), so its link still works after the
code field has gone. The link, from the email or the page's return, is
`#token=…&state=…`, with `&server=` naming the server's `ws:`/`wss:` URL
when it opens a client that isn't tied to one, all
`application/x-www-form-urlencoded` in the URL fragment; it carries no address.
The token and state are read and scrubbed from the address bar before anything else,
and a link pasted into an open tab is taken the same way. A link with the
`state` of a sign-in this browser proposed (in this tab or another) is used at
once, on the server it was proposed to, whatever `server` the link names: the
client opens a fresh connection there that is not signed in, presents the
token with the proposal's scheme (`token`, no address), and carries on with
that connection once it has worked, as above. One with the `state` of an
addition waits for this page's session to settle, and adds on its connection
only if it is signed in to the account that proposed it, on that server
(any connection of it, not only the one that proposed); otherwise it says
which account to sign in as. Any other link is a credential someone else may
have crafted or forwarded, so it is never used silently: a dialog asks "Sign
in to *server* with this link?", says whom it signs out when you are signed in
there (or that a saved session is kept there, before it has resumed), and warns
that a link someone sent you can sign you in to their account, which matters
all the more as the link can't say which account it is for. Nor can it say
whether it signs in or adds (one proposed on another device could be either):
when this page is signed in on the link's server (a guest too) and that server
signs in with email or an external page, the dialog asks "Use this link on
*server*?" and offers **Add it** to the signed-in account, as well as
**Sign in**. Adding approves on this connection, which the server allows only
if this account proposed it (§4.11.3); a refusal says it may have been for
signing in, or for another account. On **Sign in** it
is used as a sign-in, on the link's server (this one unless it names another;
a `server` that isn't a WebSocket URL makes it unusable), with a scheme that
server offers, since approval takes either (§4.11.3). Such a sign-in is
recorded as the only scheme the server offers, or as an email or external
sign-in, not saying which, when it offers both. A link never adds to an
account without its addition's `state` or the viewer's **Add it**. Only once a sign-in has
worked is a switch to another server remembered, and the server listed under
Recent; on the same server the account signed in before is signed out of as
**Sign out** does, so push goes off for it here. If it fails (expired, used,
`denied`), nothing changes: the page stays on its server, and the connect
screen opens on the link's scheme, set to the link's server, with the reason;
for a link of no proposal here, it adds that the link may have been sent to
add a way of signing in, which works where that account is signed in. An
addition's link waits for a kept session to resume (through retries after a
limit) before saying it can't be used.
An email or external sign-in that can't be resumed (no token to resume with) shows as
signed out after a reconnect, never as a guest, unless a passkey was added to
the account, which then signs it back in (with a tap, as below); where the
scheme only signs up, the message points to another way in rather than to it. The link dialog also
warns when the server a link switches to has a saved session here.

**Token** signs in with a token the server gave you, pasted into the form
(`scheme: "token"`), and keeps it like a session token (below). Its optional
name field, "Your name, if this is an invite", goes with the token as `name`
only when filled, for an invite that creates an account
([PROTOCOL.md Appendix B.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#b3-an-invite-token-signs-up-several-people));
left empty, no name is sent, and the account keeps the one the server gives it.

When the server advertises token authentication, the session token it returns
(after a passkey or email sign-in, or a replacement in reply to a token resume)
is kept in `localStorage`, keyed by server URL, the latest replacing any earlier, and automatically resumes the
same identity after a transport disconnect, a page reload, or in a new tab, for
as long as the server keeps the session alive (the example servers renew it on
every resume). Servers that offer passkeys without token resume get no stored
credential, and a reload starts as a guest. There a reconnect needs another
passkey login, and so does an expired session: the client holds the
connection (open, signed in as no one, and not reconnecting meanwhile), the
status banner says "Sign in with your passkey to continue", and its **Sign
in** opens the sign-in panel ready for that tap. A refused resume (an
expired or revoked token) of a passkey session does the same, on the
connection that was refused. If the server has closed that connection
meanwhile, the passkey tap reconnects in place first, keeping the rooms
on screen. It never prompts on its own
and never replaces the session with a guest identity. Signing out clears the stored
credentials and reconnects as a guest. The Go reference server keeps unexpired
sessions across restarts unless it runs with `--store memory`.

The WebAuthn exchange follows [§4.10 of the protocol](https://github.com/shazow/apron/blob/main/PROTOCOL.md#410-webauthn-authentication):
both registration and login use `action` plus `step: "begin"` or
`step: "finish"`, with the server's `challenge_id` and `public_key` and the
browser's standard JSON credential representation. The implementation details
for the Go reference server are documented in its
[`SERVER.md`](https://github.com/apron-chat/apron-server-go/blob/main/SERVER.md#example-webauthn-exchange).
