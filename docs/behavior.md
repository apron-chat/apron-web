# Client behavior

What the web client does, feature by feature, and which protocol capabilities
each needs. [architecture.md](architecture.md) covers how the code is laid out.

The default connection is `VITE_DEFAULT_SERVER_URL` from the build, which
`.env.production` sets to `wss://server.apron.chat/` for every production build
(web.apron.chat and pull request Previews). Local development, and a build with
`VITE_DEFAULT_SERVER_URL=` (empty), use same-origin `/ws` instead.

Embed media (`og` images, video and audio) loads from the chat server's origin
and from the origins in `VITE_TRUSTED_MEDIA_ORIGINS`, which `.env.production`
sets to `https://media.apron.chat`, the Cloudflare demo server's upload bucket.
Streams load from the chat server's origin only. Every link in chat, from
message text, link cards, uploads and HTML embeds, opens in a new tab.

`/__preview` mounts this same app against a page-local in-memory WebSocket
server, not the saved, configured, or same-origin backend. It seeds a guest,
rooms, a thread, people, CommonMark examples, and a message moved into the thread,
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
instead.
A request that takes more than 600ms says so in a toast above the composer
("Leaving…"), which goes when it's done; one that fails leaves its error there
until the next request, or until its × closes it. An error of the connection
itself shows in the corner, also with a ×; closed, it stays away until it
clears, and shows again if it comes back. The first time a room is shown on
a connection its messages wait for its thread listing, for at most three
seconds, so its thread cards arrive with them instead of shifting the timeline
afterwards.
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
mentions that came after you left (a tab loaded hidden and never used sends
`{idle: true}`). A server that refuses the seconds as `invalid_params` gets
`{idle: true}` instead, at once and for the rest of that connection. One `idle` request is in flight at a time; a change meanwhile goes
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
that signed in takes its own identity from the `auth` result or `you`. Message headers show the name with the muted `@user_id` beside it,
always when another user the client knows of shows under the same name, so no
one can pass as someone else; a name that is the user's own `user_id` needs no
handle beside it. Without an avatar, a
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
right border to resize it, and click the border, or the panel button in the
window's top-left corner, to collapse or expand it. The button stays in that
corner, over the list's header while it is open and over the room's once it
is shut, so the same spot opens and shuts it, with or without a room open. Its width and whether
it is collapsed are remembered. On
phones it is a pane of its own instead, which the title bar's back button
returns to.

The member list's panel button, in the window's top-right corner, toggles a right-hand
sidebar, **Members**, listing the open room's or thread's members from its `room_list`
snapshot, with their role badges. A server may list only the most recently
active members of a large room, with `member_count`, the number of users who have joined; the list
then says so, and the count in its header is the total. In a room you have
joined, with the `rooms` capability, the list's first row, **Add member** (laid
out as a member's: a dashed circle over the avatars, its words over the names),
opens a form under it, which adds someone by `user_id` (`room_join` with their `user_id`,
suggesting people the client knows; the form closes once they are added, or on
Escape) and each other
member's remove button removes them (`room_leave` with their `user_id`, after
a confirm): how members bring people into a private room. Only a `user_id` is
accepted there, since display names aren't unique. Who may is the server's
policy; its error shows in the panel. A server that answers `unsupported`
gets no controls until its next `server` frame. A count kept from a truncated listing stays while later records
of the room carry no `members`. On wide screens it is a column that resizes like the rooms list:
drag its left border, or click the border to collapse it (the corner button
brings it back, and takes focus when the border collapsed it from the keyboard), and its width and whether it is collapsed are remembered.
Dragging either list shut restores its earlier width when it reopens.

Both lists open and shut the same way, in 240ms: the column slides, its
contents keep their width against the edge facing the conversation (so they
ride the moving border rather than squeeze), and fade; below 960px the member
list's overlay slides in from the right edge instead. Each frame moves the
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
list doesn't grey out and reorder meanwhile. Then any the server didn't send
again show no dot, except an `offline` or `""`, which stays: the server sends
every other status, so its silence means one of those. A sign-in as someone
else drops them at once. A
sign-in is an `auth` as a user the connection isn't already signed in as: a
repeat `auth` as the same user, or adding a passkey or an email address,
keeps them.

In the composer, Enter sends and Shift+Enter starts a new line. On a phone or
tablet (a touch screen with no pointer that hovers) Enter starts a new line
instead, as mobile chat apps do, since an on-screen keyboard has no
Shift+Enter; the Send button sends. Where an autocomplete below offers Enter
to pick, it picks either way.

The timeline is anchored at its bottom edge. When the area below it grows or
shrinks (the composer taking another line, a reply bar, staged files, the
typing row), the messages just above the composer stay in view, pushed up
rather than covered: at the latest message it stays there, and scrolled back,
the view moves with the edge. Resizing the window keeps the view where it is.

Mentions follow the `@user_id` convention ([PROTOCOL.md Appendix A.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a3-mention-text)). Typing `@` in the
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
text. A rendered body (plain or CommonMark, never inside
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

Clicking a user's mention chip in a message, a sender's name or avatar, or a
member in the member list opens their profile card: a popover beside it (a
bottom sheet on narrow screens) with their avatar, name, `@user_id` (always,
here), role badges, "(you)", a warning when another known user shows under
the same name, and whether they're in the open room. **Mention** puts their
chip in the composer, **Copy @user_id** copies their handle, and **Add to
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
least one stays checked, mentions and replies until you choose; the switches
below turn notifications off. The choice is kept per account on each server,
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
browser blocks notifications. With the rooms list showing, it sits above the
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
leaves its notifications until you come back to it. Notifications on your other
devices stay: web push can't close them without showing something, which
browsers require of every push. Browsers expect each push to
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
connections. Opening a room places a **New** divider above the first message
after the cursor as it was when you arrived; it stays put while you read. A
server whose settings say `read_cursors: false` (below) keeps no cursors: the
cursor still moves here, for the divider, but isn't sent.

With the `rooms` capability, rooms come by request ([PROTOCOL.md §4.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#43-rooms)): right behind
`auth`, without waiting for its result ([PROTOCOL.md §3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#32-authentication)), the client lists
the rooms you have joined with `room_list` (`filter: "joined"`, `members:
true`), which is the complete set, threads included (if that `auth` fails, the
listing ran as the connection was, signed in as no one, and is dropped), and keeps it current from
`room_update` (`joined`, `left`, `updated`) and each room's members from the
membership records in its `memberships` ([PROTOCOL.md §4.3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#432-membership)), as in a
`history` page's `memberships`. Only joined rooms deliver live. Without the capability there is the server's default room, posted to
without a `room_id` until a message names it, plus any room a message arrives
in, titled by its `room_id`.

Threads are rooms with a `parent_room_id`. The sidebar lists top-level rooms
and, under the open room, its threads in two groups. First the ones you've joined,
on a guide line from the room:
each title in ink, heavier with unread replies, over a lighter line of preview,
with a door on hover that leaves it. Then **Other threads · N**, a heading
that folds like Browse rooms (it stays as you left it, on this device): the
threads you haven't joined, titles only, since they deliver nothing live
([PROTOCOL.md §3.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#34-rooms))
and so have no counts or previews. It shows the three most recently active (the
server's `room_list` order) and the rest on **N more…**; picking one reads it
without joining (it stays in this list, picked out, with its Join showing, also
while the list is folded or past the first three), and **Join** on the row (on hover, or always on touch) joins it
and opens it once its `room_update` arrives. Leaving is how a thread is put
away: it stops counting unread and alerting, moves down to Other threads, and
does so on every device, since it's a membership; its card stays in the room.
The protocol lets a client hide threads, so nothing here is a server limit.
The room feed shows each thread as
a card where it was started that previews its description as text (or, without
one, its latest loaded message), including threads you haven't joined, which `room_list` with the
room's `parent_room_id` finds whenever the room is opened or its threads are
listed; that listing is also what refreshes their cards, since they deliver
nothing live. Opening one of those reads it through `history` without joining
it: its header offers **Join**, which makes it live and lists it under the room,
and replying joins it first.
With the `rooms` capability, a **+** on the open room's row starts a thread in it
without a message to start from: **New thread in General** asks for a name and
an optional CommonMark **Summary** (`room_set` with `parent_room_id`, `title`
and `description`), and the thread opens once its `room_update` arrives. There
is no Private choice, since a thread takes its room's; a thread of a private
room that comes back without `private: true` gets the error described below.
The **+** beside Rooms in the sidebar creates a room
from a name and an optional CommonMark description (`room_set` with `title` and
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

A room's `description` (CommonMark by convention) shows as one line of text
under its title in the header. With the `rooms` capability the header's ⋯ menu
holds the occasional actions: **Edit room** (or **Edit thread**) opens
a form for the open room's or thread's title and description ("Summary" for a
thread), saved with one `room_set`; the `room_update` that follows is what
shows, since the server may alter or decline it.

With the `rooms` capability, **Start thread** on a message creates a thread under the
room titled after the message's first line, with the message's text as its
`description` (unless the title already says it all), and opens it with the
composer replying to that message. Threads don't point at a message, so
the thread's first reply carries the link back as its `reply_to` (the
convention of the protocol's fixtures): its quote shows the message and jumps
to it. The message stays in the room, with the thread's card after it. A
thread's description shows as a **Summary** pinned at the top of the thread,
rendered as CommonMark. Threads load their newest page of
history when opened (50 records); one with older replies opens at its latest
reply, shows "N+ replies", and loads the page before whenever the reader nears
the top, keeping what is on screen in place. Drafts are kept per room, threads
included.

Each room or thread opened is a browser history entry (the URL stays the same),
so Back returns to the previous room or thread, and Forward the other way, until
Back leaves the page from the first room opened. A room left since stays put
for that step, and a thread left since is read without joining.

With the `rooms` capability the header's ⋯ menu also offers **Leave**, which leaves the room or
the thread after asking; a thread's door in the sidebar leaves it without
asking, since Join brings it back from the same list. A thread is a room of its
own, so leaving its parent keeps it. A
server that keeps you in a room answers `denied`, and its message shows as
the error.
**Browse rooms** in the sidebar lists, via `room_list` with
`filter: "not_joined"`, the most active visible rooms you haven't joined;
picking one joins it and opens it once its `room_update` arrives.

With the `edit` capability, several messages move at a time: shift-click a
message (or press `x` on it, long-press it on touch, or pick **Select** from its
More menu) to enter select mode, shift-click another to fill the range, and the
selection bar replaces the composer with the count, **Move to thread** (or, in a
thread, back to the room), **New thread** (with the `rooms` capability) and Cancel. A
move is a save of the message with the destination's `room_id`, one request per
message. Anyone's messages can be picked, and the server decides whose you may
move (this server: your own, and anyone's for an admin or a mod). A move is all
or nothing as far as that goes: when the selection holds a message that isn't
yours, that one is sent first, alone, and if the server refuses it nothing else
is sent, the selection stays, and the error says no messages were moved. Otherwise
the rest go together. A new thread is created first and the moves follow once the
server has named it; it isn't created when the selection holds someone else's
message and you have neither `admin` nor `mod`, so a refused move never leaves
an empty thread. Messages refused after the first (say, over a posting limit)
stay selected and the bar says how many didn't move. Escape leaves select mode.

A reply's quote may point into another room: clicking it opens that room or
thread, loading the thread's history if needed, and highlights the message.

With the `reactions` capability, a message's **React** action opens the full emoji
picker right away, its frequently used row starting from emoji-mart's own
defaults; a pick toggles your reaction with that emoji. The pick goes on the
message it was opened from, whatever arrives meanwhile: the picker names that
message above itself (“React to Ada” and its first line), since new messages can
scroll it away or, on a phone, under the sheet, and while the picker is open that
message keeps its hover highlight and no other message takes one. Reactions show as chips under the message: emoji and count,
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
  The file is sent under that name, as the embed's `title`. Images start shrinking as soon as they are attached; one that
  can't be made small enough comes off again with the reason. Send (with or
  without text) posts the message with one `upload` embed per attached file,
  then writes each file to the `write_url` in the result. A failed send gives
  the draft back with its files. The message shows a pending
  card with progress until the server publishes the finished file: an image, a
  video or audio player from its `og`, or else a file card. A plain click (or
  Enter) on an image opens it full screen in the image viewer: its name, who
  sent it and when, **Open original** (the file, in a new tab) and **Close**,
  with ← and → (and the arrow buttons) paging through every image in the open
  room or thread, oldest first. Escape, Close, or a click beside the image
  closes it, with focus back on the image last shown. A Cmd, Ctrl, Shift, Alt
  or middle click keeps the link's own behavior: the file in a new tab or window.
- **Streams** (capability `embed:stream`): while the embed has a `url` the client reads
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

With the `edit` capability, **Edit** on your own message opens it in place, in
a box like the composer: its text, with its embeds above it as tiles like a
draft's files (an upload as its picture, audio with a player, or a file card;
a link preview, stream or other embed as a card named by its title or
address). Each tile's (x) leaves that embed out, and an upload's name can be
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
value on servers that store embeds as given. Removing an upload or stream asks
first, since the server deletes its content. A message's last embed has no (x)
when there is no text (delete the message instead), nor does an upload still
being written.

Media in `og` and stream URLs load only from the chat server's own origin;
links may point anywhere `http(s)`.

**Connect** in the
sidebar header opens the connect screen: a WebSocket URL or an HTTP(S) server
base URL, a display name, and a sign-in choice among the schemes the server
advertises (Guest by default; Passkey, below; Email and Token, further down). Once the server in the field
has answered, its `server.welcome`
([PROTOCOL.md §3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#32-authentication))
shows at the top of the form, rendered as CommonMark and sanitized like a message.
A server without the `guest` scheme opens this screen by itself once, since
nothing works before signing in, and so does a session held for a sign-in
(below) with nothing on screen yet. The server and name
are stored in local storage, and the last few backends are listed under the
form. The profile bar at the foot of the sidebar edits your handle, which is
sent with the protocol `me` request after authentication; the editor shows
what the server actually kept. The kept name is the one asked for from then
on, and the one remembered for the next visit, so a server that normalizes
names isn't sent `me` again at each reconnect. With the `command` and `embed:upload` capabilities it
also sets your avatar: a `/avatar` command carrying one `upload` embed
([PROTOCOL.md §4.8.6](https://github.com/shazow/apron/blob/main/PROTOCOL.md#486-avatars)), whose result names the `write_url` the image is written to; the
server applies it with a `user` notification. **Remove** sends `me` with
`avatar: ""`.

The profile editor's Sign-in row offers, where the server's `auth` lists them,
**Sign in with a passkey**, **Sign in with email** and **Add email** to a
guest, and **Add passkey**, **Add email** and **Sign out** to a registered
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
adds the address to the account and answers `{}` (§4.11); a refused code says
the address may belong to another account. If this connection dropped in
between, the proposal went with it and the form asks for a new code. Adding doesn't change how
the session signed in: it is remembered beside it, as another way back in.
When, as far as this browser knows, the account has no way back in that the
server signs in with (only a kept token, pasted or an invite, or an account
made with a scheme the server lists only in `signup`), the profile bar says
"add a sign-in" and the Sign-in row suggests a passkey or an email.

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

A server may keep guests read-only, and says so with `guest_posting: false`
in its settings (below). Signed in as a guest there, the composer gives
way to a bar saying so with a **Sign in** button (it opens the sign-in panel
on Passkey). Replying, reacting, starting threads, editing rooms and threads,
adding or removing members, and Join and Leave are hidden; Browse rooms offers **Open** instead of
**Join**, which reads the room through its history without joining it, and Other threads
offers no Join, since picking one already reads it. Other
servers' denials show as errors as usual.

The client understands `ext:settings`, an extension that the Cloudflare demo
server defines: a server that advertises it in `capabilities` describes how it runs in its `server`
frame's `ext.settings`, `{guest_posting?, read_cursors?}`. Both are booleans,
and a setting left out is `true`; without the capability the client reads
none of them. `guest_posting: false` keeps guests read-only, as above, and
the connect screen's Guest hint says so. `read_cursors: false` says the server
keeps no read cursors, so the client doesn't send `read_message_id`. Other
extension data (`ext`, [PROTOCOL.md §4.12](https://github.com/shazow/apron/blob/main/PROTOCOL.md#412-ext))
on users, messages and rooms is kept as the server sends it, and the client
writes `ext` (with `me`, a message, or `room_set`) only to a server with the
capability `ext`, which keeps it; the app itself writes none.

Passkeys use the browser's native WebAuthn JSON APIs, with no frontend dependency.
An up-to-date browser is required; unsupported browsers can still chat as guests.
Browser cancellation and verification errors appear in the profile editor. A
connection change cancels the active ceremony. Chat requests pause while a
ceremony is active, preventing edits from crossing an identity change.

With `email` in the server's `auth` or `signup`
([PROTOCOL.md §4.11](https://github.com/shazow/apron/blob/main/PROTOCOL.md#411-email-authentication)),
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
server's `ws:`/`wss:` URL (the suggested convention of §4.11), all
`application/x-www-form-urlencoded` in the URL fragment; it carries no address.
The fragment is read and scrubbed from the address bar before anything else. A link is a credential someone else may have crafted or forwarded,
so it is never used silently: a dialog asks "Sign in to *server* with this
email link?", says whom it signs out when you are signed in there (or that a
saved session is kept there, before it has resumed), and warns that a link
someone sent you can sign you in to their account, which matters all the more
as the link can't say which account it is for. A link pasted into an open tab
is taken the same way. On confirmation the client opens a fresh connection to
the link's server (this one unless it names another) that is not signed in,
presents the token there (`scheme: "email"` and `token`), and carries on with
that connection once it has worked, as above; only then is a switch to another
server remembered, and the server listed under Recent. On the same server the
account signed in before is signed out of as **Sign out** does, so push goes
off for it here. A link never adds an
address to an account. If it fails (expired, used), nothing changes: the page
stays on its server, and the connect screen opens on Email, set to the link's
server, with the reason.
An email sign-in that can't be resumed (no token to resume with) shows as
signed out after a reconnect, never as a guest, unless a passkey was added to
the account, which then signs it back in (with a tap, as below); where email
only signs up, the message points to another way in rather than to email. The link dialog also
warns when the server a link switches to has a saved session here.

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
