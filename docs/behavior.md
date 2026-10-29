# Client behavior

What the web client does, feature by feature, and which protocol capabilities
each feature needs. [architecture.md](architecture.md) covers how the code is
laid out, and [EXT.md](../EXT.md) the extensions it understands beyond the
protocol.

## Overview

### Which server it connects to

The default connection is `VITE_DEFAULT_SERVER_URL` from the build.
`.env.production` sets it to `wss://server.apron.chat/` for every `vite build`:
web.apron.chat, pull request Previews and local builds. Local development
(`vite dev`), and a build with `VITE_DEFAULT_SERVER_URL=` (empty), use
same-origin `/ws` instead. To connect elsewhere, see the
[connect screen](#signing-in).

### What it loads, and from where

- Embed media (`og` images, video and audio) loads only from the chat server's
  own origin and from the origins that server names for its media, such as its
  upload bucket (`ext.media.origins`, [EXT.md §6](../EXT.md#6-extmedia)).
- Streams load only from the chat server's own origin.
- Links may point anywhere `http(s)`. Every link in chat, from message text,
  link cards, uploads and HTML embeds, opens in a new tab.

### Capabilities at a glance

The server lists its capabilities in its `server` frame. Without one, the
features that need it are left out; nothing else changes.

| Capability | What it turns on |
|---|---|
| `rooms` | Listing, joining, creating and leaving rooms and threads; private rooms; adding and removing members ([Rooms and threads](#rooms-and-threads)) |
| `edit` | Editing messages, removing embeds, moving messages ([Messages](#messages)) |
| `reactions` | Reactions ([Messages](#messages)) |
| `command` | Slash commands, and setting your avatar ([Messages](#messages), [Signing in](#signing-in)) |
| `activity` | Typing indicators and read cursors ([People and presence](#people-and-presence), [Reading and unread](#reading-and-unread)) |
| `status` | Presence, idle reporting, pausing notifications ([People and presence](#people-and-presence), [Notifications](#notifications-and-preferences)) |
| `embed:upload`, `embed:stream` | Uploads and live streams ([Embeds and links](#embeds-and-links)) |
| `ext:settings`, `ext:permissions`, `ext:limits`, `ext:media`, `ext:emoji` | See [EXT.md](../EXT.md) and [Server settings, permissions and limits](#server-settings-permissions-and-limits) |

### The preview page

`/__preview` mounts this same app against an in-memory WebSocket server in the
page, not the saved, configured or same-origin backend. It exists only in
development builds: `vite dev`, or `APRON_PREVIEW=1 vite build`, which the QA
tools and `npm run e2e` use. Production builds leave it out, and the in-memory
server loads only with that route, never with the app itself.

- It seeds a guest, rooms, a thread, people, CommonMark examples, and a message
  moved into the thread.
- It implements the requests the app makes: auth, room listings and history,
  messages, reactions, room changes, profile updates, activity, commands and
  ping.
- It doesn't advertise uploads or streaming.
- Changes last only for the page's lifetime, as do settings changed there
  (display name, sidebar, appearance), so previewing never replaces the real
  ones.

## Connection

### Reconnecting

When the connection drops, the client reconnects on its own. The first
reconnect after a connection that stayed up (signed in for 30 seconds) goes
within a quarter second. It is spread at random so a server's clients don't
all come back at once. Repeated failures back off from 1 s to about one
attempt per minute, with jitter.

A tab that is hidden, or a browser that reports being offline, waits to
reconnect until it is shown or the network is back. A background tab needs no
socket until someone looks at it.

An explicit server retry window takes precedence over the backoff:

- A `retry_after` error about the connection as a whole delays the next
  reconnect by its `data.retry_after` seconds.
- After a `denied` error the client stops reconnecting. It shows **Signed
  out** with the server's message and waits for **Sign in**.

### Connection status

After a failed WebSocket handshake, the client makes a bounded HTTP diagnostic
request (4 seconds at most) to the same URL with `?apron_connection_status=1`
([EXT.md §5](../EXT.md#5-connection-status)). The client uses a reply only
when it is marked `Apron-Connection-Status: 1`, has status 403, 429 or 503,
and carries a JSON error. Such a reply can carry a capacity error and
`Retry-After`, exposed through CORS.

The client displays the reason and waits before retrying, including manual
retries: **Try Again** stays off until the wait is over. Any other reply is
ignored. Servers without this optional endpoint keep ordinary reconnect
behavior.

### Liveness check

Where the server pings (§1), the client checks at once that its socket still
answers in two cases:

- a tab shown again after 10 seconds or more away;
- a network that comes back.

The check is one ping. A socket that hears nothing back (a `pong`, or any
other frame) within 5 seconds is replaced as if it had closed. Otherwise a
socket could look connected for up to a whole ping interval after a laptop
slept.

For 3 minutes after a check replaced a socket, the next check waits 30 seconds
instead. A slow network that outlasts 5 seconds then isn't met with one new
connection after another.

### New version

When a newer version of the client is deployed, a notice at the top says
"Apron has been updated" and offers **Reload** or **Later**. It never reloads
by itself. Two things raise it:

- SvelteKit's version poll;
- a lazily loaded file the deploy removed.

Drafts live only in memory. So while any room or thread has unsent text or
files, the notice adds that reloading clears your unsent message.

### Resuming from the kept view

A reload, or opening the app again, picks up where you were. With a session
saved on this device (a passkey or email account; a guest's isn't kept), the
page first shows the view kept from last time:

- the rooms and threads;
- the open room with its messages from the last day (the newest 150 per room);
- the open room's thread cards and members;
- who you are.

While it checks for new messages, a pill says so (see
[The checking pill](#the-checking-pill)). Each room is replaced by the live
one once it has recovered. What arrived meanwhile comes in under the New
divider, and edits, deletions and reactions update in place.

The kept view is only for showing. It never sends a read cursor, notifies, or
counts as unread. The live session recovers every room as it would without
it.

The kept view is stored in IndexedDB, per server, for the account signed in
there. It is:

- dropped after a week;
- removed on sign-out;
- dropped as soon as the server signs in as anyone else.

### Placeholders

Without a kept view (a first visit, or a guest), the page shows placeholder
rooms, messages and members. The foot of the timeline says "Connecting…" and
then "Loading messages…". These replace "Not signed in", "No rooms yet" or
"No room open", which would be wrong while the page is still coming up.

### The checking pill

While the open room or thread recovers or loads its history, a pill says so:
"Checking for new messages…", or "Checking for new replies…" in a thread. It
floats just above the composer, in the gap under the last message. It takes
no space, so the timeline doesn't move as it comes and goes.

The pill's timing keeps it from flickering:

- It shows only once a check has taken 400ms, so a quick check shows nothing.
- Once shown, it stays for at least 600ms.
- It stays until 300ms after the check ends, so a check that comes in steps
  reads as one.

### Quiet reconnects

A short drop of the connection uses the same pill. It says "Reconnecting…"
until the connection is back, and then that it's checking. The way back reads
as one quiet line, with everything kept on screen. A longer drop (10 seconds
while you can see it), or one that needs you, gets the status banner instead.

The way back shows no pill at all for its first 1.5 seconds. That time counts
from when the client starts trying again where you can see it:

- from the drop itself;
- for a tab hidden meanwhile, from coming back to it.

Most reconnects are done by then, so they show nothing. A tab waiting while
hidden shows nothing either. The banner's "Still trying to reconnect…" also
counts only from then, never the time the tab was away. Hiding the tab
mid-reconnect stops the count, but a browser offline while the tab shows still
counts. The banner's **Try Again** shows the new attempt at once.

Through a quiet reconnect the page stays as it was, and a guest who only reads
keeps reading. These stay up:

- the rooms' and member list's + buttons;
- the Online and Offline headings;
- the Private section;
- the profile bar's note;
- the composer, which still takes typing, while Send waits for the
  connection.

Only your own dot in the profile bar shows the drop. It becomes a ring broken
into dashes, with the connection's state as its tooltip, in place of your
status until the connection is back. Screen readers hear it as the pill shows
it: not for those first moments, nor while a hidden tab waits. The status
says nothing then, rather than "Connected".

What was listed before the drop stays listed until the new connection's
listings replace it:

- Other Rooms and Other Threads;
- the room's thread cards.

So the open room shows what came meanwhile without waiting on its thread
listing again, and an open thread's reply count stays while it catches up. A
link opened meanwhile waits for the new connection's listings before deciding
a room or thread isn't there.

### Waiting for a room's threads

With the `rooms` capability, the first time a room is shown in a session its
messages wait for its thread listing, for at most three seconds. Its thread
cards then arrive with the messages instead of shifting the timeline
afterwards. A reconnect keeps what was listed, so it doesn't wait again.

### Toasts

A request that takes more than 600ms says so in a toast above the composer
(for example "Leaving…"). The toast goes when the request is done. A request
that fails leaves its error there until the next request, or until its ×
closes it.

An error of the connection itself shows in the corner, also with a ×. It
doesn't show while reconnecting, when the banner already says it. Once
closed, it stays away until the error clears, and shows again if it comes
back.

## Signing in

### The connect screen

**Connect to a server…** in the profile editor opens the connect screen. The
profile editor is the profile bar at the foot of the sidebar, for guests and
accounts alike. The screen has three parts:

- a Server field, taking a WebSocket URL or an HTTP(S) server base URL;
- a display name;
- a sign-in choice among the schemes the server advertises: Guest by default
  (Passkey for a registered session), then
  [Passkey](#the-sign-in-panel-and-passkeys), [Email](#email-sign-in),
  [External](#external-sign-in) and [Token](#tokens-invites-and-sessions).

Explicit server URLs keep their path. A bare hostname connects at `/` (as
`ws:`), while servers that require `/ws` should be entered with that suffix.
An `http:` or `https:` URL becomes `ws:` or `wss:`, and a value starting with
`/` is a path on the page's own host.

Once the server in the field has answered, the top of the form shows it as it
shows itself ([PROTOCOL.md §3.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#31-server-frame)):

- its `avatar` (or its initials) and its `title` (or its host);
- always its address below them, which a server can't copy as it can a title
  and an avatar;
- its `description`;
- its `server.welcome`
  ([PROTOCOL.md §3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#32-authentication)).

The description and the welcome are both rendered as CommonMark and sanitized
like a message.

The screen opens by itself once in two cases, since nothing works before
signing in there:

- a server without the `guest` scheme;
- a session held for a sign-in (see
  [Tokens, invites and sessions](#tokens-invites-and-sessions)) with nothing
  on screen yet.

### Recent servers and the sidebar head

The server and name are stored in local storage. The last few backends (up
to five) are listed under the form, each once by its address. Each shows the
title and avatar its last `server` frame sent, and always its address.

Addresses are normalized by RFC 3986:

- lowercase scheme and host;
- no default port;
- `/` for an empty path;
- percent-encoding normalized;
- no fragment, which a WebSocket URL can't carry.

`ws:` and `wss:` are two servers. A server is never found by its title or
avatar. A session token kept under an address written another way moves to
its normalized one.

The sidebar's head shows the connected server, and is not a control. It
shows:

- its avatar (or its initials);
- its title over its host (with a port that isn't the default), or its host
  alone without a title.

Both are cut short with an ellipsis, and the host always reads left to right.
The server's address is the tooltip.

### Profile: name and avatar

The profile bar at the foot of the sidebar edits your handle. It is sent with
the protocol `me` request after authentication, and the editor shows what the
server actually kept. The kept name is the one asked for from then on, and the
one remembered for the next visit. So a server that normalizes names isn't
sent `me` again at each reconnect.

With the `command` and `embed:upload` capabilities, the editor also sets your
avatar. It sends a `/avatar` command carrying one `upload` embed
([PROTOCOL.md §4.8.6](https://github.com/shazow/apron/blob/main/PROTOCOL.md#486-avatars)).
The command's result names the `write_url` the image is written to, and the
server applies it with a `user` notification. **Remove** sends `me` with
`avatar: ""`; if the server keeps the old one, the editor says "The server
kept your previous avatar."

### Profile: the Sign-in row

The profile editor's Sign-in row offers these actions, each only where the
server's `auth` lists its scheme:

- to a guest: **Sign in with a passkey**, **Sign in with email**, **Sign in
  externally**, **Add email** and **Add external sign-in**;
- to a registered account: **Add passkey**, **Add email**, **Add external
  sign-in** and **Sign out**.

The Sign in actions open the [sign-in panel](#the-sign-in-panel-and-passkeys),
carrying a handle typed in the editor along. Sign in with email is a sign-in
to the address's own account. A guest's **Add email**, by contrast, proposes
and approves on the guest's connection, which adds the address to the guest's
account (§4.11) and makes it a registered one.

Adding needs the scheme in `auth`, since adding is a way back in, and a scheme
listed only in `signup` doesn't sign in. The spec doesn't say whether servers
may allow adding such a scheme; this client doesn't offer it.

**Add passkey** registers a passkey on the signed-in connection, which adds it
to that account
([PROTOCOL.md §4.10](https://github.com/shazow/apron/blob/main/PROTOCOL.md#410-webauthn-authentication)).
So adding one keeps your guest identity and message ownership, while signing
in restores the identity attached to your chosen passkey. The new passkey is
labelled with the account's name. With the Go reference server, open
`http://localhost:5173` (or `http://localhost:8080` for a static build); other
deployments need HTTPS and configured RP/frontend origins.

**Add email** asks for an address, then:

1. proposes adding it on this signed-in connection (`auth` with
   `scheme: "email"` and `email`);
2. approves the proposal with the emailed code on this same connection
   (`scheme: "email"` and `token`, no address).

This adds the address to the account and answers `{}` (§4.11.3). A refused
code says the address may belong to another account. A typed code works only
on the connection that proposed it: if this connection dropped in between, the
form asks for a new code. The link in the email still adds the address (see
[Sign-in links](#sign-in-links)).

**Add external sign-in** proposes on this connection (`scheme: "external"`,
`return_url` and `state`) and opens the server's page in place of this one.
The page comes back with a link that adds the identity. Where the server won't
return here, the page shows a code for the form instead.

Adding doesn't change how the session signed in. The added way is remembered
beside it, as another way back in.

Sometimes, as far as this browser knows, the account has no way back in that
the server signs in with. That happens with only a kept token (pasted, or an
invite), or with an account made with a scheme the server lists only in
`signup`. The profile bar then says "add a sign-in", and the Sign-in row
suggests a passkey, an email or an external sign-in. Its hint explains why:
"Only this browser’s saved session gets you back into this account." or "This
server doesn’t sign in the way you joined."

### The sign-in panel and passkeys

The connect screen's form is the one sign-in panel (`SignIn.svelte`, its
state machine in `$lib/ui/sign-in`). Every way into signing in lands on it:

- the connect screen;
- the profile's **Sign in with a passkey**, **Sign in with email** and **Sign
  in externally**;
- the read-only bar's **Sign in**;
- the status banner's **Sign in** for a held session.

Each tap does one explicit thing, and a passkey sheet only ever opens for a
tap. On Guest, **Connect** connects without a ceremony.

On Passkey, the panel asks which of two paths it is, side by side:

- **Sign in** ("I have a passkey", the default);
- **Create account** ("I’m new here").

The choice comes before any field it needs. The main button runs only that
one, and Enter does what it says. **Sign in with passkey** runs a login: the
browser's sheet offers this server's passkeys (no `allowCredentials`), and the
account is the one attached to the passkey picked. **Create account with
passkey** registers a new passkey. The client never guesses between them.
Where the server's `signup` lets passkeys only sign in or only sign up, the
panel doesn't ask and offers only that one. On a server that hasn't answered
yet, it asks.

A ceremony needs a connection to the server in the form. Where there is none
yet (another server, or a held session whose connection closed), the tap opens
one:

- as a guest where the server has guests, else signed in as no one;
- a held session reconnects in place.

The ceremony follows once that connection has settled, if the server lets
passkeys do what was asked. A browser may refuse a sheet that long after the
tap. The panel then says "Connected. Tap again to continue with your
passkey.", ready on that connection. Connected as a guest, **Stay a guest**
leaves the panel as it is.

Connected as a guest, the sign-in hint says each server has its own accounts,
and names the server in the form by its host (as code). A passkey saved for
another server is no account here. A sign-in whose sheet is dismissed says
"Cancelled.". Where passkeys also create accounts, it says instead "Cancelled.
No passkey for this server? Choose Create account." and marks **Create
account** with a dot until another choice or tap. The reason: a device with no
passkey for the server offers only another device or a security key (on iOS,
a QR code), which otherwise reads as a fault.

Signing in asks no display name. The account keeps the name it has, and the
guest's name the ceremony started from isn't sent to it with `me`. The form,
and the name remembered for the next visit, take the account's.

Creating an account asks for the display name, the requested `name` (§3.2):

- It goes with the register `begin`, so the server can name the account and
  its passkey.
- The client labels the passkey with it too. Password managers show the
  creation options' `user.name` and `user.displayName`, which a server fills
  from the guest session the ceremony starts on.
- Once the account is made, the name is sent with `me` if the server kept
  another.

After a passkey login, where the browser has the WebAuthn Signal API, the
passkey's label is updated to the account's display name
(`PublicKeyCredential.signalCurrentUserDetails`). So a passkey saved under a
guest's name picks up the account's. This is best effort and never waited on.

The panel is busy from the tap on. That includes the wait (up to 5 seconds)
for requests sent as the old identity to settle. Where the panel has a
**Cancel**, it stops the ceremony, whether it is still waiting or the
browser's sheet is up, and closes the panel.

### WebAuthn in the browser

Passkeys use the browser's native WebAuthn JSON APIs, with no frontend
dependency. An up-to-date browser is required; unsupported browsers (or a page
that isn't HTTPS or localhost) can still chat as guests, and the panel doesn't
offer Passkey there. Browser cancellation and verification errors appear in
the sign-in panel, or in the profile editor for **Add passkey**.

A connection change cancels the active ceremony. While a ceremony is active,
the client refuses other requests ("Finish signing in before sending
requests"), so edits can't cross an identity change.

The client makes no WebAuthn request of its own. It uses no conditional
(autofill) or `immediate` mediation and no capability probes, which
password-manager extensions don't always settle.

The client reads the credential's fields as soon as the browser returns it.
It falls back to them when `toJSON` is missing or throws, as it can for a
credential an extension proxies (1Password in Firefox). It also falls back
when `toJSON` disagrees with them, as with an extension's own `toJSON`
encoding a field otherwise. Where `toJSON` leaves out
`clientExtensionResults`, the credential's own are sent with it.

### Email sign-in

With `email` in the server's `auth` or `signup`
([PROTOCOL.md §4.11](https://github.com/shazow/apron/blob/main/PROTOCOL.md#411-email-and-external-sign-in)),
the connect screen's **Email** asks for an address and proposes signing in
with it. The proposal is `auth` with `scheme: "email"` and `email`. It
authenticates nothing, and answers `{}` whether or not the address has an
account.

The proposal goes on a connection of its own that is not signed in, for two
reasons:

- a proposal on a signed-in connection (a guest's too) would propose adding
  the address to that account;
- a short code works only on the connection that proposed it.

The client keeps that connection open while you type the code. It pings it at
`server.ping`, and closes it after 15 minutes, by when the proposal has
expired. Nothing on screen changes meanwhile: this connection, its identity
and its rooms carry on. On a server the connect screen isn't connected to yet,
it proposes there the same way, without first signing in as a guest. A newer
proposal closes the previous one's connection.

The code field then approves the proposal on that same connection
(`scheme: "email"` and `token`, no address).

- A wrong code can be typed again on the same proposal.
- If that connection closes (the proposal expired, the server went away), the
  code field goes and the form asks for a new code. The link in the email may
  still work (see [Sign-in links](#sign-in-links)).
- The code belongs to the server that proposed it. Changing the Server field
  drops it and closes that connection, as does "Use another address, or send
  a new code".

Once the code works, that connection, now signed in, becomes the client's
connection (on its server, if another). The previous one closes, the page lets
go of the view it held, and the rooms are listed on the new one. If the
sign-in gives no token of its own, the previous account's kept token is
forgotten, so a reconnect never silently brings that account back.

The profile's **Add email** is what proposes on the signed-in connection (see
[Profile: the Sign-in row](#profile-the-sign-in-row)).

### Sign-in and sign-up schemes

With `server.signup`, `auth` lists the schemes that sign in and `signup` those
that create an account (§3.1). The connect screen offers both, and its hint
says which each does.

- A scheme listed only in `signup` works end to end for joining: an email
  code, or registering a passkey.
- A scheme listed only in `auth` only signs in. A passkey that only signs in
  is never registered from there.

### External sign-in

With `external` in the server's `auth` or `signup` (§4.11.5), the connect
screen's **External** proposes on a connection of its own, as Email does. The
proposal is `scheme: "external"`, with `return_url` (this app's origin and
path) and `state`.

The client opens the page the server answers with in place of this one. It
opens only an `https` page, or `http` on a loopback host; any other `url`,
such as `javascript:`, is refused. The page signs you in however the server
chooses, and comes back with a link. Since a link needs no particular
connection, the proposing connection then closes.

A server may refuse the `return_url` (`invalid_params`: an origin it doesn't
trust). The client then asks again without it, and the server's page shows a
code. The connect screen offers the page as a link to open in a new tab ("Open
the sign-in page"), and the code field approves on the proposing connection,
as an emailed code does. Any other refusal, `denied` included, is shown as the
server words it, without asking again.

### Sign-in links

Every proposal, email or external, sign-in or addition, carries a new random
`state` (§4.11.1). The client remembers it in local storage for an hour (at
most eight at once), with the server it went to, whether it signs in or adds,
and for an addition the account that proposed it. A proposal outlives its
connection: a disconnect doesn't cancel it, and a newer one on another
connection doesn't either. So its link still works after the code field has
gone.

The link, from the email or the page's return, is `#token=…&state=…`. It adds
`&server=` naming the server's `ws:`/`wss:` URL when it opens a client that
isn't tied to one. All of it is `application/x-www-form-urlencoded` in the URL
fragment, and it carries no address. The token and state are read and
scrubbed from the address bar before anything else. A link pasted into an open
tab is taken the same way.

What happens next depends on the link's `state`:

- **A sign-in this browser proposed** (in this tab or another) is used at
  once, on the server it was proposed to, whatever `server` the link names.
  The client opens a fresh connection there that is not signed in, presents
  the token with the proposal's scheme (`token`, no address), and carries on
  with that connection once it has worked, as for a code.
- **An addition this browser proposed** waits for this page's session to
  settle. It adds on that session's connection only if it is signed in to the
  account that proposed it, on that server (any connection of it, not only the
  one that proposed). Otherwise it says which account to sign in as. It waits
  for a kept session to resume (through retries after a limit) before saying
  it can't be used.
- **Any other link** is a credential someone else may have crafted or
  forwarded, so it is never used silently. The link dialog asks first.

### The link dialog

For a link of no proposal here, a dialog asks "Sign in to *server* with this
link?". It says:

- whom it signs you out of, when you are signed in there, or that a saved
  session is kept there, before it has resumed;
- when the link switches servers, that it does, and whether the server it
  switches to has a saved session here;
- that a link someone sent you can sign you in to their account. This matters
  all the more as the link can't say which account it is for.

Nor can the link say whether it signs in or adds; one proposed on another
device could be either. So when this page is signed in on the link's server (a
guest too), and that server signs in with email or an external page, the
dialog asks "Use this link on *server*?". It offers **Add it** to the
signed-in account, as well as **Sign in**.

- **Add it** approves on this connection, which the server allows only if
  this account proposed it (§4.11.3). A refusal says it may have been for
  signing in, or for another account.
- **Sign in** uses it as a sign-in, on the link's server: this one unless it
  names another. A `server` that isn't a WebSocket URL makes the link
  unusable. The approval uses a scheme that server offers, since approval
  takes either (§4.11.3); on a server with neither email nor external, the
  token goes as `scheme: "token"`, like a pasted one.

Such a sign-in is recorded as the only scheme the server offers. When it
offers both, it is recorded as an email or external sign-in, not saying
which. A link never adds to an account without its addition's `state` or the
viewer's **Add it**.

### After a link

Only once a sign-in has worked is a switch to another server remembered, and
the server listed under Recent. On the same server, the account signed in
before is signed out of as **Sign out** does, so push goes off for it here.

If the link fails (expired, used, `denied`), nothing changes. The page stays
on its server, and the connect screen opens set to the link's server, with
the reason; for this browser's own proposal it opens on the proposal's scheme.
For a link of no proposal here, the message adds that the link may have been
sent to add a way of signing in, which works where that account is signed in.

An email or external sign-in that can't be resumed (no token to resume with)
shows as signed out after a reconnect, never as a guest. The exception is an
account a passkey was added to: the passkey then signs it back in, with a tap
(see [Tokens, invites and sessions](#tokens-invites-and-sessions)). Where the
scheme only signs up, the message points to another way in rather than to
it.

### Tokens, invites and sessions

**Token** signs in with a token the server gave you, pasted into the form
(`scheme: "token"`), and keeps it like a session token. Its optional name
field, "Your name, if this is an invite", goes with the token as `name` only
when filled, for an invite that creates an account
([PROTOCOL.md Appendix B.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#b3-an-invite-token-signs-up-several-people)).
Left empty, no name is sent, and the account keeps the one the server gives
it.

When the server advertises token authentication, the client keeps the session
token it returns in `localStorage`, keyed by server URL. That token comes
after a passkey, email or link sign-in, or as a replacement in reply to a
token resume; the latest replaces any earlier. It automatically resumes the
same identity after a transport disconnect, a page reload, or in a new tab,
for as long as the server keeps the session alive. The example servers renew
it on every resume.

Servers that offer passkeys without token resume get no stored credential, and
a reload starts as a guest. There a reconnect needs another passkey login, and
so does an expired session. The client holds the connection: open, signed in
as no one, and not reconnecting meanwhile. The status banner says "Signed out:
Sign in with your passkey to continue.", and its **Sign in** opens the sign-in
panel ready for that tap.

A refused resume (an expired or revoked token) of a passkey session does the
same, on the connection that was refused. If the server has closed that
connection meanwhile, the passkey tap reconnects in place first, keeping the
rooms on screen. The client never prompts on its own and never replaces the
session with a guest identity.

Signing out clears the stored credentials and reconnects as a guest. The Go
reference server keeps unexpired sessions across restarts unless it runs with
`--store memory`.

### The WebAuthn exchange

The WebAuthn exchange follows [§4.10 of the protocol](https://github.com/shazow/apron/blob/main/PROTOCOL.md#410-webauthn-authentication).
Both registration and login use `action` plus `step: "begin"` or
`step: "finish"`, with the server's `challenge_id` and `public_key` and the
browser's standard JSON credential representation. The implementation details
for the Go reference server are documented in its
[`SERVER.md`](https://github.com/apron-chat/apron-server-go/blob/main/SERVER.md#example-webauthn-exchange).

### Diagnostics

A failed ceremony leaves one console entry, `[apron] passkey <action> failed
during <stage>: <message>`. It is a warning, and only info for a sheet the
user dismissed. The stage is `waiting` (for in-flight requests), `begin`,
`browser` or `finish`.

The entry holds:

- the error, with the server's code;
- the server and page origin;
- the options that decide what an authenticator does: RP ID, user name,
  authenticator selection, algorithms, excluded credentials (not the
  challenge);
- the credential decoded: whether `toJSON` or the fields were sent and why,
  the client data's type, and whether its origin and challenge are the
  expected ones;
- the authenticator data's flags (user present, user verified, backup),
  whether its RP ID hash matches, and its AAGUID with the provider it names
  (Bitwarden, 1Password, iCloud Keychain…).

Servers answer every verification failure alike (§4.10 `denied`), so this is
where the reason shows. The connection's own sign-in, as a guest or by a saved
session, warns too when refused (`[apron] sign-in by saved session failed: …`
or `… as a guest failed: …`), without the token.

## People and presence

### Who someone is

The client keeps one user object per `user_id`
([PROTOCOL.md §3.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#33-identity)),
so a rename or a new avatar shows on earlier messages too. How an incoming
object updates the kept one depends on where it comes from.

- **Complete objects replace it.** These are `you` in an `auth` or `me`
  result, and the `users` of `room_list` and `room_update`. A field a
  complete object leaves out is gone.
- **Other current objects merge into it field by field.** These are the
  `you` and `new` of a `user` notification, and room `members`. A present
  field replaces (`null` too, as an ordinary value). An empty one (`""`,
  `[]`, `{}`) clears it and is kept as cleared. A missing one changes
  nothing.
- **`ext` merges the same way, one level down**
  ([PROTOCOL.md §4.12](https://github.com/shazow/apron/blob/main/PROTOCOL.md#412-ext)).
  Each key replaces the kept value, an empty value clears that key (kept as
  cleared), and `"ext": {}` changes nothing.
- **Recorded objects never merge.** A message's or reaction's `from` and a
  membership's `user` describe the user as of their record.

Your own `status` comes only from `you`, never from your entry in `users` or
`members` (see [Your status](#your-status)).

A user renders field by field from the kept object. It falls back to the
recorded object the message carries only for fields the kept object lacks. So
a cleared avatar, name or `roles` stays cleared, however stale the message.
An empty or unknown name shows as the `user_id`.

A `user` notification with `new` and `old` maps the retired ID to the new
identity: the same account under a new `user_id`, such as a guest that
becomes a new account. Signing in to an existing account isn't one. Others
see the guest leave (a membership leave, `offline`) and the account arrive,
as two people, and the guest's messages stay the guest's. The connection that
signed in takes its own identity from the `auth` result or `you`.

### Names, handles and avatars

Message headers, the member list and the list of who reacted show the muted
`@user_id` beside a name only where it tells people apart. That is when
another user the client knows of shows under the same name, so no one can
pass as someone else. A name that is the user's own `user_id` needs no handle
beside it.

A handle that merely differs from the name says nothing more, so it isn't
shown. One that is shown is needed, so it stays whole: it gives way only
after the name and the role badges. The profile card always shows the
`@user_id`, and the mention picker lists it to pick by.

Without an avatar, a person's initials sit on a muted tint. Its hue is hashed
from their `user_id`, so the same person has the same color on every client.

### Roles

A user's `roles`
([PROTOCOL.md §3.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#33-identity)),
such as "admin" or "bot", show as small outlined badges beside the name in
message headers and the member list. They are never part of the name, so no
name can pass as a role. They grant nothing here.

Short of room, the badges come first. The name truncates first, down to 6em
(or all of a shorter name). Then the badges that don't fit go behind the last
one that does. That badge ends with how many are behind it, as a count in the
role's color ("BOT +2"), and its tooltip names every role.

### Status

Where the server sends a `status` (§4.5), each member's avatar carries a dot
cut into its corner. The row's tooltip and screen-reader text say the status
in words.

| Status | Indicator |
| --- | --- |
| `online` | a filled dot |
| `idle` | a crescent |
| `dnd` (do not disturb) | a barred dot |
| `offline` | a hollow ring |
| any other value (unknown) | a placeholder: a ring broken into dashes |
| none (not sent, or `""`) | no dot |

- **Unknown is not offline.** An unknown value's tooltip says "Unknown
  status: brb" (the value cut to 64 characters), and the profile card shows
  the literal value.
- **No status is not offline either.** A member with none has no dot and
  isn't taken for offline.
- **Order.** The list sorts online, idle, do not disturb, unknown, offline,
  then those with no status, by name within each. It dims offline members.

The client shows what the server sends. Others see a user's do not disturb
only while that user is connected, and offline otherwise; the server works
that out.

### Your status

Your own row, the profile card and the profile bar show the status you chose,
from `you`:

- online;
- do not disturb;
- invisible: the hollow ring others see, its tooltip "Invisible · others see
  you as offline";
- or no dot for none.

Others' view of you (`offline` while you are invisible, `idle`) arrives in
`new` user objects and room `members`. It never replaces your own. Pausing
notifications doesn't change your status: a pause is private.

On a server with the `status` capability, the Notifications section of
Preferences starts with **Status**, your presence status as others see it
(§4.5). Its menu has a dot before each choice and a check on the current one.

- **Online** (automatic: others see online, idle or offline as you come and
  go) and **None** (no status) are always offered.
- **Do not disturb** (others see it while you're connected, and offline
  otherwise) and **Invisible** (others see you offline) are offered only where
  the server frame's `server.status` lists them (§3.1). Without
  `server.status` the menu offers just Online and None.
- A status you already have stays in the menu, checked, even when it isn't
  listed.
- A value the client doesn't know (one the server set) shows as itself,
  quoted, with nothing checked.

Choosing one sends `me` `{status}` (`""` for None). There are no durations.
While a choice is being saved, the button reads "Saving…" and can't open.
It keeps keyboard focus (`aria-disabled`, not disabled).

A server may answer another value. `you` in the result is the status in
effect, and the row shows it. A callout says what the server answered ("This
server doesn't offer Invisible. Your status is None."), and the dialog's one
live region reads it out too. For the rest of the session the menu stops
offering a value the server answered something else for.

Do not disturb silences this page as a pause does: no desktop notifications,
chime or title flash. The server sends no pushes with messages.

### Statuses across reconnects

A lost connection keeps the others' statuses. Each sign-in drops them,
however short the reconnect. The server sends them again after the sign-in's
result for each connected user who shares a room. They also come in the room
`members` and the `users` of `room_list` and `room_update`, which carry
`offline` and `""` too (a ring, and no dot).

Signing in again as the same user after a lost connection (a resume) holds
the old statuses until the joined `room_list` arrives:

- The ones from before still show, each replaced as a fresh one comes, so the
  member list doesn't grey out and reorder meanwhile.
- The member list itself keeps showing them all, in their order, until that
  listing. Then it changes over once, rather than reordering as each fresh one
  comes.
- After the listing, any status the server didn't send again shows no dot.
  The exception is an `offline` or `""`, which stays: the server sends every
  other status, so its silence means one of those.

A sign-in as someone else drops them at once. A sign-in is an `auth` as a
user the connection isn't already signed in as. A repeat `auth` as the same
user, or adding a passkey or an email address, keeps them.

### Last seen

A user object with a shown `offline` may carry `seen` (§4.5.2): when that
user's shown status last became `offline`, in the `log_id` format. While a
member shows offline, it shows in two places:

- **The profile card** says "Last seen 3h ago" under the status, with the
  exact local time as its tooltip.
- **Their row's tooltip** (and its screen-reader text) says "Offline · last
  seen 3h ago".

Both move on each minute. Within two weeks the time reads as `15m`, `3h` or
`12d ago`. After that it is the day as the browser's locale writes it, such
as `Last seen Sep 14` in en-US, with the year when it isn't this one.

Under ten minutes ago it says "Last seen recently", with no number. A server
may record `seen` coarsely: one records it to the 10 minutes, and a departure
within 10 minutes of the one before announces the older time again. So "4m
ago" could be off by as much as it says. The tooltip then says "Last seen
within the last 10 minutes" rather than an exact time the words decline to
give, though the `<time>` keeps the time in its `datetime`.

- **Clock skew.** A `seen` up to five minutes ahead of this device's clock is
  recent too. One further ahead says its day, since "ago" would be false.
- **Merging.** `seen` merges like any other field. A `seen` kept from before
  stays when they come back online (`{"status": "online"}` carries none), but
  it shows only while they show offline.
- **Invalid values.** One that isn't decimal digits of a positive integer
  below 2^53, or is past the last date a JavaScript `Date` holds (8.64e15 ms),
  shows nothing.
- **Never yours.** It is never kept for you: your status is the one you chose,
  and `you` carries no `seen`.
- **Sign-ins.** A sign-in drops each `seen` with the statuses.
- **Resumes.** A held `offline` shows with its `seen` until the joined listing
  arrives. An `offline` kept after it, because nothing was said of them, keeps
  no `seen` until an object that carries one arrives. They may have come back
  and gone again meanwhile: the sign-in sends no `offline`, and a listing of
  what changed since leaves out rooms whose log didn't move.

### Offline time seen here

The page also notes, in memory, when it received each other user's change of
shown status to `offline`. That change can come from a `user` notification, a
room's `members`, or a listing's or `room_update`'s `users`. It counts only
from a status the page showed them with on this signed-in connection: not
from `offline`, `""` or none.

While they show offline, the later of that time and their `seen` shows. So
someone this page watched leave never reads as gone longer than that, however
coarse the server's `seen`. It shows even where the server sent no `seen`,
since it is what this page saw, not something the server claims.

- It is only ever the time a change was received. A status learnt after a
  sign-in, or held through a resume, changes from none, so someone who left
  while this page was away isn't given the time it came back.
- It is never yours.
- It follows a `user_id` change (`new` and `old`) to the new identity.
- It stays through a resume as the same user, except for someone the resume's
  listing says nothing of (dropped with their `seen`, for the same reason).
- Any other sign-in drops it, as it does the statuses.
- A reload loses it, and the server's `seen` alone shows.

### Typing

With the `activity` capability, typing is reported as `activity`
notifications that ask for a 15-second indicator (`typing: 15`). The client
refreshes it at most once every 12 seconds per room, rather than charging a
frame per keystroke. When typing pauses for 5 seconds it sends one
`typing: 0`.

Sending a message sends no `typing: 0`: the message itself ends the
indicator. Other people's indicators last as long as their `typing` asks (at
most 300 seconds), or until their next message arrives in that room.

### Idle

With the `status` capability (§4.5), the client tells the server whether
anyone is attending the tab, so the server can push instead. It sends a
`status` request (with an `id`) only once signed in, after the `auth` result,
never before.

As in other chat apps, the tab is idle after five minutes without input in
it: a key, a click or tap, a pointer move, or a scroll. Any input, or coming
back to the window or tab, ends it at once.

- **Losing focus** alone doesn't make it idle, since a window on another
  monitor is still read. It only makes the tab alert for mentions.
- **A hidden tab on a phone or tablet**, where that is the app going to the
  background, is idle at once.

A connection starts attended, so a tab in use sends nothing. One that starts
idle reports idle at once: a tab loaded hidden and not used since (such as
one a push notification opened in the background), or a reconnect after five
minutes without input. After that, the client reports idle when the tab
becomes idle, and sends `{idle: false}` as soon as it is used again.

Idle goes as the whole seconds since the tab was last used (`{idle: 300}`
after five minutes), worked out as the request goes. This lets the server
push mentions that came after you left. A tab loaded hidden and never used
counts from when it went idle, so it sends `{idle: 0}`.

- **One at a time.** One `idle` request is in flight at a time. A change
  meanwhile goes after the server's `{}`.
- **`retry_after`.** The client sends the tab's state as it is after the
  delay, not the refused one, and nothing if that is what the server already
  has.
- **Other errors, or no answer.** It does the same after 5 seconds, doubling
  with each failure in a row up to five minutes, so a tab in use is never left
  idle.
- **Timeouts.** A request that times out may or may not have applied. So
  after one, the tab's state goes even if it is what the server had before.

Typing and sending go through the input that ends idle. The `activity` and
`message` frames themselves don't carry it.

Others never see `idle` itself. While your status is `online`, the server
folds it into the `status` they see (§4.5): `online` while a connection is
attended, `idle` while you are connected but none is, and `offline` with no
connections. After a sign-in's result the server sends the `status` others
see of each user this one shares a room with, other than `offline` and `""`.
A server without `status` gets none of this.

## Layout

### Rooms list

On wide screens (720px and up) the rooms list is a column beside the
conversation. It resizes and collapses from its inner border: the right one,
or the left one under a right-to-left layout, where both lists mirror.

- Drag the border to resize the list. Dragging it under half its minimum
  width shuts it.
- Or move the border with the arrow keys. The arrow pointing toward the
  conversation widens the list.
- Click the border, or the panel button at its inner edge, to collapse or
  expand the list.

While the list is open, the panel button sits at the end of the list's header,
after the server. It rides the border as the list slides or is dragged. Once
the list is shut, the button sits at the start of the room's header, beside
the window edge the list went to, with or without a room open.

The list's width, and whether it is collapsed, are remembered. Dragging it
shut restores its earlier width when it reopens.

On phones (under 720px) the rooms list is a pane of its own instead. The title
bar's back button returns to it. Opening the list is a history entry of its
own, so Back returns from it to the room or thread it opened over (see
[The address bar and history](#the-address-bar-and-history)).

### Member list

The member list's panel button toggles a right-hand sidebar, **Members**. It
lists the open room's or thread's members from its `room_list` snapshot, with
their role badges. The button sits at the panel's inner edge: the start of its
header, before Members, or the end of the room's header once it is shut. Status
dots on each member's avatar are described under
[People and presence](#people-and-presence). The list shows no typing or
connection status.

#### Sections

The members are in sections, as Discord lists them, each headed with its
count:

- **Online**.
- **Offline**: members who are offline, and yourself while invisible.

Someone with no status isn't known to be offline, so stays under Online.
Within a section, members sort by status, then name.

Without presence, the list is one list with no heading, since a Members
heading would repeat the panel's own. That is the case on a server without
the `status` capability, or when no member has a status.

Each heading folds its section, as the sidebar's headings do. A section folds
to no one (presence isn't news), with the **…** at its end that shows it
again. Which sections are folded is remembered for every room.

#### Large rooms

A server may list only the most recently active members of a large room,
with `member_count`, the number of users who have joined. The list then says
so ("Showing 12 of 300: the most recently active"), and the count in its
header is the total. A count kept from a truncated listing stays while later
records of the room carry no `members`.

#### Adding members

In a room you have joined, with the `rooms` capability and signed in with
writes allowed, a small **+** after the header's count (**Add member**) opens
**Add people to …**. Adding is offered where you hold `add_members` (see
[Server settings, permissions and limits](#server-settings-permissions-and-limits)),
on a server without that extension, or in a private room you are a member of.

The dialog is centered, with the same people picker as New private
conversation (see [New private conversation](#new-private-conversation)):

- It lists the people the client knows who aren't members yet, except you and
  the system identities, up to 50 at a time.
- A name or `@user_id` typed narrows the list.
- When none of them matches, the `@user_id` typed is offered to add by it
  ("Add by @user_id: @…").

**Add** sends `room_join` with each picked `user_id` in turn. One the server
refuses doesn't stop the rest. It stays picked, and the dialog says why.
Those added are said in the panel ("Added Bo and Cy.").

#### A member's menu

Pressing a member's row anywhere drops down its menu beneath it. A
right-click, the context menu key or a long press opens it where that was
instead. A tap with a finger opens their profile card straight away, since a
finger has the long press for the menu. The menu holds:

- **Profile** opens their profile card.
- **Direct message** (not to a system identity) opens the private
  conversation you have with them, or starts one, as a profile card's Message
  does.
- **Remove from room** removes them, after a confirm ("Remove … from …?"),
  with `room_leave` and their `user_id`. This is how members bring people into
  a private room, and take them out.

While a direct message or a removal is under way, the menu holds Profile
alone. Your own row, or one where Profile is all the menu would hold, opens
the profile card at once.

Who may add or remove whom is the server's policy, and its error shows in the
panel. A server that answers `unsupported` gets no controls until its next
`server` frame. Meanwhile the panel says "This server doesn’t let members add
or remove others."

#### Column and overlay

On wide screens (960px and up) the member list is a column that resizes like
the rooms list. Drag its inner border (its left one, or its right one under
right-to-left) to resize it, or click the border to collapse it. The panel
button brings it back, and takes focus when the border collapsed it from the
keyboard. Its width and whether it is collapsed are remembered, and dragging
it shut restores its earlier width when it reopens.

On narrower screens the member list overlays the conversation instead:

- It starts closed, and isn't remembered.
- It is toggled by a button near the end of the room's title bar.
- On a phone it hides with the conversation on the rooms pane.

### Opening and closing panels

Both lists open and shut the same way, in 240ms:

- The column slides.
- Its contents keep their width against the edge facing the conversation, so
  they ride the moving border rather than squeeze.
- The contents fade.

Below 960px the member list's overlay slides in from the window's end
instead: the right edge, or the left under right-to-left, below its button.

Each frame moves the grid's columns only, nothing else's style. The timeline
takes its final width when the slide starts and keeps it until the slide
ends. Its messages are thus laid out once rather than re-wrapped on every
frame, and it stays at the latest message if it was there. Meanwhile the
conversation sits on a compositor layer of its own.

There is no slide in three cases:

- The layout kept from the last visit shows without sliding in.
- A drag follows the pointer with no slide.
- There is no motion at all when the system asks for reduced motion.

### Composer

In the composer, Enter sends and Shift+Enter starts a new line. On a phone or
tablet (a touch screen with no pointer that hovers) Enter starts a new line
instead, as mobile chat apps do, since an on-screen keyboard has no
Shift+Enter. The Send button sends there. Where an autocomplete offers Enter
to pick, Enter picks either way.

Pressing Send leaves the focus in the field, so a phone's keyboard stays up
between messages. However long the room's or thread's name, the field's
placeholder takes one line, cut short.

### Timeline

The timeline is anchored at its bottom edge. When the area below it grows or
shrinks, the messages just above the composer stay in view, pushed up rather
than covered. That area changes with the composer taking another line, a
reply bar, staged files, or the typing row.

- At the latest message, the view stays there.
- Scrolled back, the view moves with the edge.
- Resizing the window keeps the view where it is.

### Phones and touch

A phone's on-screen keyboard covers the page rather than resizing it, and the
browser pans the page to keep the field in view. While the keyboard is up, the
app is fitted to what's left above it instead:

- The header stays at the top.
- The composer sits just above the keyboard.
- The timeline is anchored as in [Timeline](#timeline), so the latest message
  (or a message being edited) stays in view.

Scrolling past either end of the timeline doesn't carry on to the page. On
iPhone and iPad, fields type at 16px at least, so Safari doesn't zoom the page
into them as they take focus.

Long-pressing a message on a touch screen shows its actions: see
[Messages](#message-actions-on-touch-screens).

### The address bar and history

The address names where the page is, all in the fragment. The host serving
this app thus never learns which server, room or message anyone opens:

```text
#server=wss://chat.example/ws&room=general&thread=t-1&message=1724803200042
```

- `server` is left out when it is the one the page connects to anyway. It
  must be a `ws:` or `wss:` URL. One carrying a user name or password is
  ignored on the way in, and credentials are stripped on the way out.
- `thread`, `message` and `user` (whose profile card opens) count only with a
  `room`.

Opening an address, or pasting one into an open tab, goes there. One on
another server opens the connect screen for it first.

Each room or thread opened is a browser history entry. Back returns to the
previous room or thread, and Forward goes the other way, until Back leaves the
page from the first room opened. On returning to an entry:

- A room left since stays put for that step: the entry takes the room you are
  in.
- A thread left since is read without joining, or else its room opens
  instead.

On a phone, the rooms list is an entry too. A room or thread picked from it
takes the list's entry, so Back doesn't return to the list.

## Rooms and threads

### Listing rooms

With the `rooms` capability, rooms come by request
([PROTOCOL.md §4.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#42-rooms)).
Right behind `auth`, without waiting for its result
([PROTOCOL.md §3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#32-authentication)),
the client lists the rooms you have joined with `room_list` (`filter:
"joined"`, `members: true`). That listing is the complete set, threads
included. If that `auth` fails, the listing ran as the connection was, signed
in as no one, and is dropped.

From then on the client keeps the set current from `room_update` (`joined`,
`left`, `updated`). It keeps each room's members from the membership records
in its `memberships`
([PROTOCOL.md §4.2.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#422-membership)),
as in a `history` page's `memberships`. Only joined rooms deliver live.

Without the capability there is the server's default room, posted to without
a `room_id` until a message names it. Any other room a message arrives in is
added too, titled by its `room_id`.

### Naming rooms and threads

Threads are rooms with a `parent_room_id`. A thread without a title is called
"Untitled" wherever it's named, with its `room_id` on hover:

- its sidebar row, its card and its Moved to line;
- the header and the move menu;
- the composer's "Reply in Untitled";
- room chips and notifications.

A top-level room without a title is still called by its `room_id`, since
several untitled rooms side by side would be indistinguishable. The exception
is a private room, which is named for its members (see
[Private rooms](#private-rooms)).

### The sidebar

The sidebar lists top-level rooms: ordinary ones under **Rooms**, private ones
under **Private** (see [Private rooms](#private-rooms)), then **Other Rooms**
(see [Joining and leaving](#joining-and-leaving)). A joined thread whose parent
isn't among your rooms is listed at the top level too, so it stays reachable.
Before any room arrives, Rooms says "Waiting for rooms…", or "No rooms yet."
once connected.

A room's row shows the same unread bubble as a thread's (see
[Thread rows](#thread-rows)) for its own unread messages, with its name in
bold. Its threads count their own. The row shows no count while you're reading
the room.

The open room or thread has a neutral fill and an accent bar at its left: on
the window's edge for a room, on the guide line for a thread. It never looks
unread. A row's fill, open or under the pointer, reaches the sidebar's outer
edge and is square there, rounded inside. The member list's rows do the same
at its far edge.

#### Threads under a room

Under the open room, the sidebar lists its threads in two groups: the ones
you've joined, then **Other Threads** (see [Other Threads](#other-threads)).

Under a room that isn't open, it lists only that room's joined threads with
news (unread replies or mentions), in the same rows, so activity there isn't
missed. Picking one opens its room with the thread open. Quiet threads wait
until the room is opened.

#### Folding a room's threads

Picking the open room again while reading it folds its threads the same way,
to those with news. On a phone it returns to the room instead. While folded:

- the room's row shows a small **…** button before its **+**, saying the list
  is cut short;
- the **…**, or picking the room once more, unfolds them;
- a thread you open in it is listed, picked out, while you read it.

A folded room stays folded as you go to other rooms and come back. This is
kept on this device, per account on each server.

#### Folding sections

The sidebar's section headings fold the same way. **Rooms** or **Private**
folds to the rooms with news (in them or in their threads) and the open room,
which reading would otherwise take away. The folded heading shows the **…**
before its **+**. The **…**, or the heading again, shows them all.

**Other Rooms** folds alike, to nothing, as its rooms have no news. Each
section starts open and stays as you left it, on this device.

### Threads

#### Thread rows

The threads you've joined hang on a guide line from the room, most recently
active first. Activity is their newest message, else the newest `log_id` the
server reported, else their creation.

While the pointer or keyboard focus is on the list, its rows hold still. A
thread that just got a reply moves up once the pointer or focus leaves, so
nothing slides out from under a click. A new thread leads at once.

Each row shows:

- its title in ink, heavier with unread replies;
- up to two lighter lines below it:
  - its Description (its `description` as text, on one line) behind a text
    icon;
  - its latest loaded message, behind a reply arrow, the sender's name in ink,
    and the whole line in ink too with unread replies.

Either line shows alone when the thread has only that one, and the icon says
which it is.

Only what's new is counted, in one bubble. Unread replies show in grey,
turning orange with an `@` when they include a mention of you (the row is
tinted too). A thread with nothing new shows no number and steps back: its
title muted and its lines dimmed. A door on hover leaves the thread (see
[Joining and leaving](#joining-and-leaving)).

#### Other Threads

**Other Threads · N** lists the open room's threads you haven't joined. It is
a heading that folds as the sidebar's sections do, to just the one you're
reading if it's among them, with the **…** at its end. It starts open and
stays as you left it, on this device.

Its rows sit beside the guide line, carried on dashed, with their titles
muted. Each has its Description line (from its listed `description`) and, at
the end of the row, when it was last active (`2h`, `3d`, `2w`, from its
listed head). The one you're reading shows its message count there instead.
These threads deliver nothing live
([PROTOCOL.md §3.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#34-rooms)),
so they have no counts or latest message.

It shows the three most recently active (the server's `room_list` order) and
the rest on **N more…**. Picking one reads it without joining. It stays in
this list, picked out, with its Join showing, also while the list is folded or
past the first three. One opened from elsewhere (a link, or past what the
server listed) leads the list while it's open.

**Join** is a door-in button on the row, as Leave is a door out. It shows on
hover, where it takes the time's place, or always on touch, beside the time.
It joins the thread and opens it once its `room_update` arrives.

Other Threads (and Other Rooms) only show when there is something to join. So
the client lists both in the background: the rooms whenever the rooms you've
joined change, and the open room's threads whenever it, or what you've joined,
changes. Such a listing is reused for 60 seconds. One refused with
`retry_after` lists again once the wait is over.

#### Reading a thread

Threads load their newest page of history when opened (50 records), and open
at their latest reply, as a room does. A thread with older replies shows
"N+ replies" in the header. It loads the page before whenever the reader nears
the top, keeping what is on screen in place.

A thread's description shows as its pinned **Description** (see
[Descriptions and editing](#descriptions-and-editing)). Drafts are kept per
room, threads included.

#### Reading without joining

Cards cover threads you haven't joined too. `room_list` with the room's
`parent_room_id` finds them whenever the room is opened or its threads are
listed. That listing is also what refreshes their cards, since they deliver
nothing live.

Opening one of those reads it through `history` without joining it. Its
header offers **Join**, which makes it live and lists it under the room.
Replying joins it first.

The protocol lets a client hide threads, so nothing here is a server limit.

### Thread cards

The room feed shows each thread as a card where it was started. The card
carries:

- the faces of its latest participants, its title, and the same unread bubble
  as its sidebar row;
- when it was last replied to, at the right of its title line, unlabelled:
  `now`, `12m`, `9h`, `12d` within two weeks, then the day (`14 Sep` in the
  browser's locale, with the year when it isn't this one), with the exact time
  on hover;
- the same preview lines as its sidebar row (the shared `ThreadLines`): its
  description as text, up to three lines, then its latest loaded message, each
  marked by its icon.

A thread's card stays in the room after you leave the thread.

### Creating rooms and threads

#### Start thread

Every new thread is named in the same centered **Start thread** dialog, with
the `rooms` capability. It asks for:

- a title (required);
- an optional CommonMark **Description**.

It sends `room_set` with `parent_room_id`, `title` and `description`. An
emptied Description leaves `description` out. The thread opens once its
`room_update` arrives. If creating fails, the dialog stays open with the
server's error.

There is no Private choice, since a thread takes its room's. In a private room
the dialog says the thread will be private too. One that comes back without
`private: true` is refused (see [Private rooms](#private-rooms)).

The dialog opens three ways:

- A **+** on the open room's row opens it empty. On a phone it opens over the
  room list, and the thread then opens in place of it.
- **Start thread** on a message fills it in (see
  [Start thread from a message](#start-thread-from-a-message)).
- **New thread** in select mode fills it in (see [Messages](#messages)).

#### Start thread from a message

With the `rooms` capability, **Start thread** on a message opens the same
dialog to name the new thread:

- its title starts as the message's first line (shortened to 60 characters,
  or "Thread" without text), selected so typing replaces it;
- its Description starts as the message's text quoted in Markdown (`> `),
  shortened to about 500 characters.

**Start thread** there creates the thread under the room with that title, and
that Description as its `description`. A title is required; an emptied
Description sends none. The thread opens with the composer replying to that
message. If a thread was already started from that message, Start thread opens
it instead.

Threads don't point at a message, so the thread's first reply carries the link
back as its `reply_to` (the convention of the protocol's fixtures). Its quote
shows the message and jumps to it. The message stays in the room, with the
thread's card after it.

#### Create a room

The **+** beside Rooms in the sidebar ("Create room") creates a room in the
same centered dialog, as **Create a room**. It asks for:

- a title (required);
- an optional CommonMark description;
- the **Private** choice ("Only members see it, and members add others.").

It sends `room_set` with `title` and `description`. The room opens once its
`room_update` arrives. If creating fails, the dialog stays open with the
server's error.

#### The Private choice

**Private** asks for `private: true`
([PROTOCOL.md §4.2.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#424-creating-and-editing)).
A server that keeps no private rooms answers `unsupported`, which the dialog
says in words: "This server doesn’t keep private rooms. Uncheck Private to
create an ordinary room."

A server might create the room without `private: true` in its record. That
room gets an error toast instead of being opened, so nothing meant to be
private is posted there. The room stays joined, to leave or use knowingly.

A thread is created without `private`, since it takes its parent's. Edits
never send it, since an omitted `private` is kept. A new thread of a private
room that comes back without `private: true` gets the same error. The reply
composer doesn't open on it, and selected messages don't move into it.

Private rooms and threads show a lock beside their name.

### Private rooms

#### The Private section

The sidebar's **Private** section sits right below Rooms and above Other
Rooms. It lists every joined top-level private room (`private: true` and no
`parent_room_id`,
[PROTOCOL.md §4.2.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#424-creating-and-editing)):
conversations started with people and titled private rooms alike. Nothing is
read from a `room_id`, which is opaque.

Its threads stay under it as under any room. Its rows count unread messages
and mentions, open, and show the open one, as Rooms' rows do. They show no
lock, since the section says so. In place of the lock they show the faces of
who it's with:

- one person's 20px avatar with their status dot;
- two of a group's, stacked;
- yours, where you're alone in it.

The section shows whenever you're in a private room. With none, it shows
(empty, just its heading) only where you could start one, for its **+**
("New private conversation"). That needs an account signed in (not a guest)
on a server with the `rooms` capability. Guests see the private rooms they
were added to, and start none.

#### How private rooms are named

A private room without a title is named for its other members:

- by display name, sorted and joined with ", " ("Dev, Mira");
- "You" when no one else is left;
- "Private room" while its members aren't known.

The one naming rule is the client's, so the sidebar, the header, the
composer's "Message Bob", room chips and notifications agree. Notifications
say just "Bob" where the room is named for its sender alone. A titled private
room keeps its title, with the same faces.

#### Message on a profile card

**Message** on a profile card (and **Direct message** in the member list)
opens the private room you already have with that person. That is one that is
joined, untitled, and has exactly the two of you as members, from a complete
member list.

Otherwise it starts one, saying "Opening…" on the button:

1. `room_set` with `private: true` and no title, which joins you.
2. It waits (up to 10 seconds) for the room's `room_update` `joined` record,
   and checks that it says `private: true`.
3. It adds them with `room_join` and their `user_id`.
4. It opens the room.

How it can fail:

- A server without private rooms answers `unsupported`. The card's note words
  that as "This server doesn't have private rooms."
- Any other refusal, such as a limit (`denied`), shows the server's message as
  it is.
- A room that comes back without `private: true` gets the same error as one
  created private from Create a room, and no one is added to it.
- A room that started but couldn't add them is kept. The note says who
  couldn't be added and why, and that the room is kept under Private.

#### New private conversation

The **+** beside Private opens **New private conversation**, a centered
dialog. **To** holds the people picked, as chips (each with its ×). Below it
are everyone the client knows but you and the system identities, sorted by
name, each with their avatar, status dot, name and `@user_id`. A name or
`@user_id` typed in the field narrows them (up to 50 are listed).

The field is a combobox and the people a listbox:

- the arrows move through them;
- Enter picks (or takes back) the one the keyboard is on;
- Backspace in the empty field takes back the last chip.

While no one is picked, someone you already have a conversation with says
"Already talking · Open", and picking them opens it. Once someone is picked,
they join the chips instead, for a group. With two or more picked, an
optional **Name** sets the room's `title`.

The primary button reads "Message Bob" for one person, else "Start
conversation". It creates the room as Message does, then adds each person in
turn. An add that fails doesn't stop the rest. The room is kept and opens, and
a toast says who couldn't be added and why.

#### The private room limit

Where the server states a limit (`ext.settings.private_rooms`,
[EXT.md §3.1](../EXT.md#31-apron-web)), the dialog's foot says how many
private rooms you're in of it ("2 of 5").

At the limit, a warning takes the people's place. It lists your private
rooms, the quietest first (five, and "and N more"), each with **Leave**. The
primary button can't be used.

#### Header and intro card

An untitled private room's header shows its faces before its name. Under the
name it says who can see it:

- "Online · only you and Bob can see this room" with one other person (their
  status, where the server sends one);
- "Only you can see this room" when you're alone in it;
- "Only members can see this room" otherwise.

The header keeps its plum wash and lock.

A private room's timeline starts with an intro card once its history reaches
back to its creation. That is when it's all loaded, and its `history_log_id`
is at or before the room's first record, or nothing is retrievable at all. The
card shows:

- its faces and its name;
- for a conversation with one person, their `@user_id` and the first line of
  their bio; else how many members;
- "Private room. Only members and the server host can read messages here. Only
  members can add others."

Nothing in it says how long messages are kept: that is the server's.

#### Added to a private room

A private room can arrive in a `room_update` `joined` without this page having
asked for it: no room creation or join of it in flight, and not one it
started. That is one someone else added you to. Until its × puts it away, it
shows "You were added to this private room." under its header, with:

- **Mute**: the room's own mute (`status` with its `room_id`), where the
  server has the `status` capability and you're signed in to an account;
  **Unmute** once muted;
- **Leave**;
- the ×.

Which rooms still show it is kept on this device, per account, until it's put
away or you leave.

#### Who adds members to a private room

Members of a private room add people to it. So in a private room the member
list's **+** and a profile card's **Add to room** are offered even without
`add_members` ([EXT.md §7](../EXT.md#7-extpermissions)). Moving messages into
one of its threads adds their authors. A new thread started in a private room
adds the room's other members, since only its members see it. Where the server
listed only some of a large room's members, only those are added, and a toast
says so.

Elsewhere these are offered where the server grants you `add_members`, or on
a server without `ext:permissions`, which decides each add itself. A refusal
shows its reason.

### Descriptions and editing

#### The pinned Description

A room's or thread's `description` (CommonMark by convention) shows as a
**Description** pinned under the header, above the timeline. It stays in view
while the messages scroll. It is rendered as CommonMark beside the
description icon (whose title says Description), with the text indented past
it on every line. Three lines of it show, fading out where a longer one is
cut.

- A click on its text (not on a link or mention, nor the end of selecting
  text) opens the rest, scrolling within the description past a third of the
  window's height. Another click folds it again.
- From the keyboard, its toggle is the next stop after the text's links.
- Its × puts it away, on this device, until the description is edited.

Once put away, a room's description shows as one line of text under its title
in the header instead. The header gains a **Description** button, just before
its ⋯ menu (the icon alone on a phone), that pins it again.

#### Edit room

With the `rooms` capability, the header's ⋯ menu holds the occasional
actions. **Edit room** (or **Edit thread**) opens a centered dialog with the
open room's or thread's title and description. It saves them with one
`room_set` carrying only the fields that changed. An emptied field is cleared
(`null`), and with nothing changed the dialog just closes. The `room_update`
that follows is what shows, since the server may alter or decline it.

### Joining and leaving

#### Leave

With the `rooms` capability, the header's ⋯ menu also offers **Leave room**
(or **Leave thread**). It leaves the room or the thread after asking. The
question says how to come back:

- a thread: "You can join it again from Other Threads under its room.";
- an ordinary room: "You can join it again from Other Rooms.";
- a private room: it can't be joined again, since only someone in it can add
  you back;
- a private room where you're the last member: it ends when you leave, as the
  server removes it then.

A thread's door in the sidebar leaves it without asking, since Join brings it
back from the same list. Leaving is how a thread is put away. It stops
counting unread and alerting, and moves down to Other Threads. This holds on
every device, since it's a membership. Its card stays in the room.

A thread is a room of its own, so leaving its parent keeps it. A server that
keeps you in a room answers `denied`, and its message shows as the error.

#### Other Rooms

**Other Rooms** in the sidebar lists, via `room_list` with `filter:
"not_joined"`, the most active visible rooms you haven't joined. Each shows
its member count and **Join**. It starts open, so a newcomer sees what else
there is without looking for it. It folds as the other sections do, and
unfolding it lists afresh.

Picking one joins it and opens it once its `room_update` arrives. A guest who
can only read opens it without joining instead, and its row shows no Join.

## Messages

### System messages and notices

Senders whose `user_id` starts with `~` (system identities, Appendix A.1)
render as quiet centered system lines. No `@` ID is special. Three system
identities state a scope: `~private`, `~room` and `~server`. Their messages
render as the design system's notice card instead: left-aligned, and titled
by the sender as the server names it, `Name (~user_id)`. The Apron example
servers, for instance, send "System message to you (~private)". A sender
whose name is just its ID is titled by the ID alone.

`~server`, `~room` and `~private` are sender scopes, not rooms (Appendix A.1).
A room ID starting with `@` or `~` is an ordinary room.

A `~private` message reaches only the connection it was sent on. Two kinds of
message are transient notices: every `~private` message, whatever it carries,
and every `message` without a `message_id` (such as a command's reply). A
transient notice shows as a dashed card for the session. It is never stored
and is gone on reload.

- A code block in a notice wraps and has a **Copy** button, such as for the
  token `/invite-bot` gives on the demo worker.
- A server-wide `~server` notice names a room like any message. One for a room
  you haven't joined also shows as a notice where you are.

### Welcome notices

A notice sent before authentication, such as a server's welcome (PROTOCOL.md
Appendix B), shows in the first room once one is listed. The next
connection's welcome replaces it. Signing in with a passkey or a stored
session drops it, since it speaks to whoever connected.

### Joins and leaves

Joins and leaves show in a room's timeline as the quietest system line, such
as "Ada joined", with the time on hover. A line sits at its membership
records' `log_id` among the messages.

Records with nothing else between them make one line. A message, a card, a
notice or a date divider counts as something between. The line is netted out
per user:

- Someone who joins and leaves again (or leaves and comes back) within the run
  shows on neither side.
- A run that nets to nothing shows no line at all, and doesn't break a
  sender's group.
- Both sides share a line: "Ada and Bob joined · Carol left".
- Past three names, a side counts the rest: "Ada, Bob, and 4 others joined",
  with everyone in the tooltip.
- A record joining more than 20 users at once is a baseline, not an event, and
  gets no line.

Names render like any other user, with the `@user_id` when someone else shows
under the same name. The lines never count as unread or mention you. A message
after one starts a new sender group.

### Writing: mentions, rooms, formatting

Mentions follow the `@user_id` convention ([PROTOCOL.md Appendix A.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a3-prefixes-in-text)).
Typing `@` in the composer opens the mention picker. It lists the room's
members, from the room's listing, kept current by the membership records of
joins and leaves. On a server without `room_list` it lists the room's recent
senders instead. Either way, those who spoke most recently come first, and
the list filters to people whose name or ID starts with what you typed. A
thread you read without joining lists its members with `room_list` and its
`room_id`.

- Arrows move, Tab or Enter picks, and Escape dismisses.
- A picked person becomes a chip showing their name.
- A typed `@name` (case-insensitive, spaces allowed) or `@user_id` (exact)
  collapses into the same chip once finished, when exactly one person in the
  room goes by it. One ending the draft collapses on send.
- A typed `@name` stays text where what follows it would carry on the
  `@user_id` it sends (`@Ada.x`). Mentions inside code spans stay text.

Chips are always sent as `@user_id`, so the field reads by name while the wire
stays ID-based. Each chip's `user_id` goes in `body.mentions`
([PROTOCOL.md §3.5](https://github.com/shazow/apron/blob/main/PROTOCOL.md#35-messages)). A chip deleted before sending mentions no
one, and an edit resubmits the message's mentions.

Typing `#` in the composer opens room autocomplete over known rooms and
threads, searchable by title or ID. A bare `#` lists them to browse; Enter
there still sends, and Tab picks. Choosing one inserts a chip showing `#title`
that is sent as `#room_id`. A typed `#room_id` naming a known room collapses
into the same chip once finished. A room chip mentions no one.

Backspace right after either kind of chip turns it back into the text it
showed (`@Ada Lovelace`, `#Deploy checklist`) to edit.

### How text renders

A `markdown` body renders as CommonMark
([PROTOCOL.md §3.5](https://github.com/shazow/apron/blob/main/PROTOCOL.md#35-messages)) with three extensions beyond it:

- GitHub tables,
- strikethrough,
- a typed line break kept as a break.

Raw HTML shows as text.

What users write shows without the bidi embeddings and overrides U+202A to
U+202E, and isolated in its own direction ([PROTOCOL.md §3.5.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#352-rendering)).
That covers message text, names, roles, bios, room and thread titles and
descriptions, embed titles and previews, notifications, and the server's title
and description. Only what shows drops them. The client keeps and sends what
was written, so an edited message or room goes back with every character its
author typed. IDs, tokens and URLs are never changed. Times and days, as the
browser's locale writes them, keep their own direction too, so under a
right-to-left layout an English time still reads "3:42 PM".

A rendered body (plain or CommonMark, never inside code) shows IDs as follows
([PROTOCOL.md Appendix A.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a3-prefixes-in-text)):

- a known user's `@user_id` as a chip with their current name;
- a known room's `#room_id` as a link showing its title, which opens the room
  (or joins it);
- unknown IDs as written.

`@` names only users. The ID after `@` or `#` is the longest run of letters,
digits and `_.+@:-` that starts and ends with a letter, a digit or `_`. So
`@ada@example.com` and `@carol:b.example` are whole IDs, and a trailing `.` or
`:` is punctuation. An `@` or `#` right after a letter or digit is text
(`mail@ada.example`).

A reply's quote above its message, and the "Replying to" line above the
composer, show the replied message's first line with its mentions drawn the
same way.

A fenced code block that names a known language (` ```ts `, ` ```py `,
` ```diff `, …) is syntax-highlighted once that language's highlighter loads.
Each highlighter is fetched the first time a block needs it. Other blocks stay
plain, as does a block over 20,000 characters.

### Mentions of you

Only `body.mentions` decides who is mentioned. A message that lists you:

- tints its row with a rust rule;
- pulses once as it arrives, or when an edit adds you (never on replayed
  history);
- turns the unread bubble of the room or thread you aren't reading orange with
  an `@`. A thread's shows on its own row, listed under its room while it has
  news, not on the room as well;
- when it lands above the fold, turns the jump bar rust with
  **Jump to mention**.

Text that merely contains your `@user_id` does none of that.

### Profile cards

Clicking any of these opens a user's profile card:

- their mention chip in a message,
- a sender's name or avatar,
- a member in the member list.

The card is a popover beside what opened it (a bottom sheet on narrow
screens). It shows:

- their avatar and name, with "(you)" on your own;
- their `@user_id`, always shown here, with a copy button beside it;
- role badges;
- a warning when another known user shows under the same name;
- their bio where the server keeps one: plain text with its line breaks, never
  markup, its `http(s)` links opening in a new tab;
- whether they're in the open room ("Member of …", "Not in …", or "Not among
  the recently active members of …" when the listing is partial).

Its actions:

- **Message**, the primary action, opens a private conversation with them (see
  [Rooms and threads](#rooms-and-threads)). It shows for anyone but you and
  the system identities, while you're signed in to an account (not a guest)
  on a server with the `rooms` capability.
- **Mention** puts their chip in the composer.
- **Add to room** appears where the member list would let you add them.

Escape, a press outside, or tabbing out closes it. Mentions inside a reply's
quote only read, since the quote is the button that jumps to its message.

### Commands

With the `command` capability, composer text that starts with one `/` is a
command ([PROTOCOL.md §4.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#41-command)). The composer shows a **Command** tag,
sets the line in monospace, and **Run** replaces **Send**. `//` posts a
message starting with one `/`. Without the capability, `/` text is an
ordinary message.

The client handles these itself:

- `/nick` sends a `me` request.
- With the `rooms` capability: `/join`, `/leave` and `/topic` send
  `room_join`, `room_leave`, and `room_set` with the room's new
  `description`.
- With the `rooms` capability: `/kick @user` and `/invite @user` send
  `room_leave` and `room_join` with that `user_id`.

`/kick` with a reason goes to the server, which alone can carry one. `/kick`
and `/invite` also go to the server once it has answered them `unsupported`;
the one that got that answer is sent on as a command.

Anything else goes out as a `command` request and is never posted. It carries
the params a message would have: `room_id`, the text as typed, `mentions`,
`reply_to`, and attached files as `upload` embeds. `/help` goes to the server,
which lists what it offers.

The server's replies arrive as notices. A failed command shows its error as a
local "System message to you" notice and gives the draft back.

### Replies

A reply's quote is one line above the sender's name: the quoted sender's
avatar and name, then the start of their message. A line from the reply's
avatar bends into it. A reply always starts a new sender group, so it always
has that avatar and name.

A markdown message is quoted as plain text, as are a link card's lines and a
message's notification. `**0 errors**` reads "0 errors", code keeps what's in
it, and a link shows its text.

The quote may point into another room. Clicking it opens that room or thread,
loading the thread's history if needed, and highlights the message.

### Message actions on touch screens

On touch screens a message's actions wait for a long press of 500ms, or the
system's own long press. A finger may drift up to 10px through the press;
further is a scroll. A tap shows nothing. Messages take no text selection, so
a stray press doesn't select words or pop the toolbar.

The press opens a larger toolbar with **Reply** and **React** up front. Its ⋯
opens the rest as a menu of rows, as each applies:

- Remove reply reference, on a deleted message
- Start thread
- Edit
- Select
- **Copy text**
- Copy link
- Remove reply reference, on your own reply
- Delete

Without Reply or React, those rows are up front instead. A tap on the
message, Escape, or focus leaving puts the toolbar away. A press on a
reaction chip, a link or media is theirs, not the message's. No long press
opens the toolbar while selecting messages or editing one.

### Reactions

With the `reactions` capability, a message's **React** action opens the full
emoji picker right away. Its frequently used row starts from emoji-mart's own
defaults. A pick toggles your reaction with that emoji.

The pick goes on the message it was opened from, whatever arrives meanwhile.
New messages can scroll that message away or, on a phone, under the sheet, so
the picker names it above itself ("React to Ada" and its first line). While
the picker is open that message keeps its hover highlight, and no other
message takes one.

Reactions show as chips under the message: emoji and count, highlighted when
one is yours, with a tooltip naming who reacted. Clicking a chip toggles your
reaction. Tombstones show no reactions.

Right-clicking a chip (or the context menu key on it), or long-pressing it on
touch, lists everyone who reacted with that emoji. You come first, each with
their avatar, name and `@user_id` where it differs. The list is a popover
beside the chip (a bottom sheet on narrow screens) that follows reactions as
they change.

- It closes with Escape, a press outside, tabbing out, or once nobody is left
  on it.
- It opens even where you can't react.
- A long press on a chip doesn't toggle it or enter select mode.

Entries that differ only in U+FE0F, such as ❤ and ❤️, are one chip, shown in
the fully-qualified form. The picker sends that form, and a toggle takes away
whichever form your set has ([PROTOCOL.md §4.7](https://github.com/shazow/apron/blob/main/PROTOCOL.md#47-reactions)).

An entry that isn't an emoji sequence is a key, such as `:partyparrot:`. Its
chip shows the custom emoji's image where the server's catalog has it
([EXT.md §9](../EXT.md#9-extemoji)), with its `alt` in the tooltip. Otherwise
it shows a dashed placeholder with the key in the tooltip. Clicking either
toggles your reaction with that key.

### Emoji

Typing `:shortcode` in the composer opens an emoji autocomplete. Arrows move,
Tab or Enter inserts the highlighted native emoji in place of the shortcode,
and Escape dismisses it. Suggestions search emoji shortcodes, names, aliases
and keywords. With `ext:emoji` the server's custom emoji come first, searched
by key, `alt` and tags; they insert their key.

A key in a message, a description, a welcome or the server's description
shows as its image, at the height of the line, once the catalog has arrived.
The catalog is fetched the first time a key shows or a picker opens. Keys in
code stay text.

The composer's emoji button is always there, since emoji are text. It opens
the same full picker and inserts the emoji at the caret, over any selection,
leaving mention chips and command mode as they were.

The picker is [emoji-mart](https://github.com/missive/emoji-mart), drawn by
`EmojiPopover` outside the app shell so nothing clips it. It is a popover
beside its button on wide screens and a bottom sheet on narrow ones, in the
app's theme and tokens. Escape or a press outside closes it. With `ext:emoji`
it lists the server's custom emoji too, without hidden ones, each under its
category after the standard emoji (those without one under "This server"). A
pick reacts with or inserts its key.

Both stay out of the main bundle:

- The emoji data loads with a dynamic `import()` when shortcode autocomplete
  is first used.
- emoji-mart itself loads dynamically the first time the full picker opens.
- The picker gets its data, English strings and native glyphs passed in, so it
  never fetches from a CDN.

### Editing

With the `edit` capability, **Edit** on your own message opens it in place, in
a box like the composer. The box holds its text, with its embeds above it as
tiles like a draft's files:

- an upload as its picture, audio with a player, or a file card;
- a link preview, stream or other embed as a card named by its title or
  address;
- a file card says what kind of file it is from its name, such as "PDF file".

The message's toolbar hides while it is edited. Each tile's (x) leaves that
embed out, and an upload's name can be changed as on a draft. An upload still
being written has no (x).

Nothing is sent until **Save changes**, or Enter (on a phone or tablet Enter
starts a new line). Saving sends the new text and the embed changes in one
save:

- The embeds left out are dropped.
- A renamed upload gets its new `title`. Its `og.title` changes too when that
  showed the old name, for a server that keeps embeds as given. A server that
  hosts the file keeps its own `og`, and the timeline shows the `title`.

**Cancel** or Escape drops it all, and Save with nothing changed just closes.
Save is off once neither text nor an embed is left (delete the message
instead).

### Removing embeds

Outside the editor, each embed on your own messages shows an **(x)** on its
corner while hovered (always on touch screens). It saves the message without
that embed ([PROTOCOL.md §4.8.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#482-embed-identity)). The embed is identified by
`embed_id`, or by value on servers that store embeds as given.

- Removing an upload or stream asks first ("Remove this attachment? Its file
  will be deleted."), since the server deletes its content.
- A message's last embed has no (x) when there is no text (delete the message
  instead).
- An upload still being written has no (x).

### Selecting and moving messages

With the `edit` capability, several messages move at a time. To enter select
mode, shift-click a message, press `x` on it, or pick **Select** from its More
menu. Shift-click another to fill the range, or use **Select between** to fill
the gap between the outermost picks. Escape leaves select mode.

The selection bar replaces the composer. It shows the count and offers:

- **Move to thread** (or, in a thread, back to the room);
- **New thread**, with the `rooms` capability;
- **Cancel**.

A move is a save of the message with the destination's `room_id`, one request
per message. Anyone's messages can be picked, and the server decides whose you
may move: your own, and anyone's where the server grants `move_any`
([EXT.md §7](../EXT.md#7-extpermissions)).

A move is all or nothing as far as permission goes. When the selection holds
a message that isn't yours, that one is sent first, alone. If the server
refuses it, nothing else is sent, the selection stays, and the error says no
messages were moved. Otherwise the rest go together. Messages refused after
the first (say, over a posting limit) stay selected, and the bar says how many
couldn't be moved.

**New thread** opens the Start thread dialog, as **Move to a new thread**,
saying how many messages move. The title starts as the earliest selected
message's first line, and the Description is empty. Escape there closes the
dialog and keeps the selection. The thread is created first, and the moves
follow once the server has named it. If the moves fail once the thread exists,
the dialog closes and the error says so, as for any move.

When the selection holds someone else's message and you lack `move_any`,
**New thread** opens no dialog and says "You can only move your own messages,
so none were moved". So a refused move never leaves an empty thread.

A thread delivers to its members only. So once messages move into one (new or
existing, but not back to the room), each of their authors who isn't in it yet
is added to it (`room_join` with their `user_id`, §4.2.2). This happens only
where you may add people: in a private room's thread, or where the server
grants you `add_members` (or lacks `ext:permissions`). The server decides each
(it adds no guests). The moves stand either way, and the toast says how many
authors weren't added and why.

## Embeds and links

### Embed kinds

Embeds render by kind, in the design system's components
([PROTOCOL.md §4.8](https://github.com/shazow/apron/blob/main/PROTOCOL.md#48-embeds-and-avatars)):

- `upload`: a file someone attached (see [Uploads](#uploads)).
- `stream`: live text (see [Streams](#streams)).
- `iframe` and `html`: a live view or server-relayed markup (see
  [Iframe and HTML embeds](#iframe-and-html-embeds)).
- Any other kind renders from its `og` as a link card, else as the fallback
  card (see [Other kinds](#other-kinds)).

### Uploads

Uploads need capability `embed:upload`. Files are attached to the draft rather
than sent. There are four ways to attach one:

- Pick it with the paperclip.
- Drop it anywhere on the conversation, which shows a "Drop files to attach"
  outline while files are dragged over it.
- Paste it.
- Record a voice clip with the microphone.

A paste attaches files whether or not the field has focus. Pasted text wins
over a picture of it, since office apps copy both. The exception is text that
only names the copied files, as file managers add. Folders are left out of a
drop. A file dropped outside the conversation is refused rather than opened in
the tab.

### Staged files

Attached files show above the composer in the design system's `Attachments`:
an image as a thumbnail, audio with a player, anything else as a file card.
Each is labeled with its name and the size it will be sent at. While an image
is still being shrunk the size line reads "Preparing…". Then it shows the new
size and name (a re-encoded photo becomes `.webp`). Each file has an **(x)** to
take it off. Files are kept per room or thread, like the draft's text.

A long name loses its middle rather than its end, so its extension stays in
view.

### Renaming a staged file

Clicking a file's name turns it into a field. Hovered or focused, its size
line reads **Rename**; on touch a pencil follows the size. The field holds the
whole name, extension included, all selected.

- Enter or clicking away keeps the new name.
- Escape keeps the old one.
- An empty name changes nothing.

The file is sent under that name, as the embed's `title`.

### Shrinking images

Images start shrinking as soon as they are attached. By the client's own
limits, an image is scaled so its longest side is at most 2048 px and
re-encoded as WebP (JPEG where the browser can't encode WebP) to fit under
5 MB. Photos are always re-encoded, so their metadata (EXIF, GPS location
included) never reaches the server. Animated images can't be re-encoded
without losing their animation, so they go unchanged. An image that can't be
made small enough comes off the draft again with the reason.

### Server type limits

The server may state the types it takes and their limits
([EXT.md §6](../EXT.md#6-extmedia)). Then:

- Images shrink to those limits.
- The file picker offers only those types.
- The microphone shows only when one of them is an audio type the browser
  records.
- A file of another type comes off again with the reason.
- A file over its type's limit that can't be shrunk (audio, video, an animated
  image) comes off again with the limit.

Without stated limits, nothing is refused here, and the server decides.

### Sending

Send (with or without text) posts the message with one `upload` embed per
attached file. It then writes each file to the `write_url` in the result. A
failed send gives the draft back with its files.

### Pending and failed uploads

The message shows a pending card until the server publishes the finished
file. On the sender's side it shows progress ("Uploading · 42%"). The finished
file shows from its `og` as an image, a video or audio player, or else a file
card.

A write the server refuses (a file larger than it takes, say) shows its sender
"Upload failed" with the reason. The server then drops it from the message
(§4.8.3). An upload still pending ten minutes after its message was sent shows
everyone "Upload failed" instead of uploading. That happens when its sender
left mid-write, or the server never dropped the failed write.

A failed card recedes: dimmed, with a crossed-out file, and no longer dashed.

### Image viewer

A plain click (or Enter) on an image opens it full screen in the image viewer.
The viewer shows:

- the image's name, who sent it and when;
- **Open original**, which opens the file in a new tab;
- **Close**;
- arrow buttons, also ← and →, paging through every image in the open room or
  thread, oldest first.

Escape, **Close**, or a click beside the image closes it, with focus back on
the image last shown. A Cmd, Ctrl, Shift, Alt or middle click keeps the link's
own behavior: the file in a new tab or window.

### Streams

Streams need capability `embed:stream`. While the embed has a `url`, the
client reads it with a streaming `GET` and shows the text growing under a Live
badge. A stream loads only from the chat server's origin. If the read fails or
drops, it is retried every two seconds. When a snapshot carries `text` instead,
the client shows the kept text as Finished.

Each format renders differently:

- `terminal`: monospace with ANSI colors and emphasis. Carriage returns
  overwrite the line (progress bars). Other escape sequences are dropped. Only
  the last 64 KiB is rendered.
- `markdown`: rendered as Markdown.
- Anything else: plain text.

### Iframe and HTML embeds

An `iframe` embed stays a paused placeholder until **Load live view**. Then it
loads sandboxed: `allow-scripts`, never same-origin, and no referrer. Its
height is clamped to 480px (300px when it gives none).

An `html` embed is sanitized with DOMPurify before insertion. Its links open
in a new tab.

### Other kinds

Any other kind renders from its `og` as a link card. Without an `og`, it shows
as the fallback card with its kind name and its `url` or `text`.

### Link previews

Any link in a message is checked against a map of sites by host (`SITES` in
`link-sites.ts`). Up to three links on those sites each get a `link` embed.
Its `og` is built by the sender from the site's public API, which allows
cross-origin reads. Images are not included. The server may keep, replace, or
drop this `og`.

| Site | Links | What the preview shows | Source |
| --- | --- | --- | --- |
| GitHub | Pull requests, issues, commits | Title, state, author, and an excerpt | REST API |
| GitHub | Repositories | Name, description, language and stars | REST API |
| YouTube | Videos | Title and channel | oEmbed |
| X (also `twitter.com`) | Posts | Author, date, and text | oEmbed |
| Bluesky | Posts and profiles | Author, and text or bio | Public AppView |
| Wikipedia, any language | Articles | Title and opening sentences | REST page summary |

### When previews are fetched

A link is looked up as soon as it is pasted, or once typing pauses for a
moment (800 ms). Each link is fetched once. The same page linked two ways
(`youtu.be` and `youtube.com/watch`) is one preview. A rate-limited answer
pauses fetching from that site until the limit resets.

### Fallback preview cards

Some messages are sent before the details arrive, or link to something the
API won't describe (a private repository, a deleted post). These get a card
built from the URL alone where it says enough, else none. Examples: "Pull
request #60", "Post by @jack", an article's title.

### Previews in the composer

The preview cards show above the composer as you write. Each has an **(x)**
that sends the message without it. A failed send restores the draft with those
previews still removed. Otherwise the draft forgets them once it is sent or
cleared.

### Apron links as chips

An Apron link in a message's text, written as its URL, reads as a mention. It
can be in either form of
[PROTOCOL.md Appendix A.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a4-links):
`https://link.apron.chat/#…` or `apron:?…`. No other form counts:
`web+apron:?…` is neither linked nor read as one. A link without `server` is
the sending server's.

The chip says in words what the link is, from what this client knows:

- a message: "Message in #general";
- a room: its name;
- a thread: its name "in #general";
- a known user: `@name`.

Each but a user's leads with its kind's icon, the same icons as the
[link cards](#link-cards). A room not known here reads as its `room_id`.

A link written with its own text keeps that text. A link with a token, or to a
user on another server, stays a URL.

### Links to another server

A link to another server is no place here, so it is no mention. It is an
outlined chip in the ink of the text. It shows a globe and the server's host
first, then "Message" or "Room", and an arrow after, since opening it switches
servers (the connect screen asks first). Nothing is looked up for it, and it
has no card. Another endpoint on the same host is another server.

### What counts as a place

Only a link read strictly as a place is drawn as one, as a chip or a card. It
must have:

- one of the shapes Appendix A.4 lists: `room`; `room` and `message`; `room`
  and `user`;
- every key one of those or `server`, each given once;
- every part `key=value`, with a value that decodes and is of its type: IDs
  without whitespace, control or bidi characters, and a `message_id` in
  `log_id` form;
- at most one `server`, and one this client can reach.

A link with a key it doesn't know, or an empty or malformed part, stays a
plain link. That way nothing that isn't what it seems looks official.

Each chip and card is still the link, in its `https` form with the server.
Copying it gives a link that opens the same place anywhere. A click opens it
here, and a modified click opens link.apron.chat in a new tab.

### Opening an Apron link

A plain click on any Apron link opens it here, read as Appendix A.4 says:

- Its keys are `application/x-www-form-urlencoded` pairs.
- Each key's first value counts. A repeat is ignored, so a key appended to a
  link can't replace one before it (PROTOCOL.md §5.4).
- Keys it doesn't know are ignored.

Only the first `server` counts. If this client can't reach it (`wss:`, or
`ws:` only to this device), the link isn't opened here at all. That is safer
than opening a later `server` that may have been appended to it. The click is
left to the browser. So is a link with a message but no room, or a token but
no server.

### Link cards

A link to a message, room or thread that this client knows more of than where
it is also shows as a card under the text. There are up to three per message,
in the shape of a link preview. A card is the link, as a chip is.

The card's first line is where it is, as a path: the server's host, the room a
message or thread is in, and a tag that says which it is (Message, Room or
Thread, with a room's member count). Under it is what this client already
knows:

- a loaded message: its sender, time and first three lines, or "Message
  deleted";
- a joined or listed room: its name, a lock if private, and two lines of its
  description.

Nothing is fetched to draw a card. A link with nothing more to show than its
path has none, and its chip says as much. That covers a message that isn't
loaded, a room known only by name or not at all, and any link to another
server.

The cards follow what the text links:

- A link inside code (inline, indented or fenced) has no card.
- A link to the message itself has no card.
- A place written twice, with its server and without, has one card.

Another client may send its own preview of the link with the message: a
`link` embed, or any embed, whose `url` is a link to the same place. It may be
written with or without its server, and with its keys in any order. That
preview doesn't show under a card for that place, so the link isn't previewed
twice. Where there's no card, the preview shows.

## Reading and unread

### Read cursor

With the `activity` capability, reading the latest message of a room advances
your read cursor (`read_message_id`). The server syncs it across your
connections.

Each room's cursor goes to the server at most every 10 seconds. The first goes
at once. Of those that come sooner, the latest is sent at the end of the
interval. It goes at once instead in two cases:

- when the page is hidden, since it may be closing;
- once signed in again, if the connection drops first. It is not sent if
  another account signs in, since it was the previous account's.

A server whose settings say `read_cursors: false` keeps no cursors (see
[Server settings, permissions and
limits](#server-settings-permissions-and-limits)). The cursor still moves
here, but isn't sent.

### Read position on this device

Whatever the server offers, this device keeps how far you have read each room
and thread (a thread's own) for the next visit. This is your read position.
It lives in `localStorage`, per account; guests without a kept session on a
server share one. Nothing of it is sent.

The read position is the furthest of:

- the latest message you had in view here;
- your read cursor, as the server reports it;
- your own newest message, since one sent from another device says you had
  read the room up to it.

It only moves forward.

### The New divider

Opening a room or thread places a **New** divider above the first message
after your read position as it was when you arrived. It stays put while you
read.

The pane opens at the divider rather than at the latest message. The divider
sits just below the top, with what is new under it and the jump button
counting it. Something that moved the pane first takes precedence: a jump to a
message, your own scroll, or sending. A thread that opens on its newest
replies first loads its older ones back to the divider.

Only once you reach the latest message does your read position move past what
was new. The same goes for your read cursor and for clearing the pane's unread
count.

### Unread counts

The unread counts go by the read position too. These are each row's bubble,
its `@` for mentions, and the tab title. So a reload, or coming back the next
day, keeps what you hadn't read.

A joined room counts the messages from others after your read position among
those loaded. That is its newest page, or what came since it was last kept
here. Mentions of you among them turn its bubble orange, but they never pulse
or notify.

Counting what came before the page opened takes a server that keeps your read
cursors: capability `activity`, without `read_cursors: false`. Those cursors
carry what you read on your other devices. Elsewhere, only what arrives while
the page is open counts, as it does for a room with no read position. That way
nothing you read on another device counts again here.

- A thread counts once it is opened, as its replies load only then.
- A room someone else added you to counts from your join.

## Notifications and preferences

**Preferences** (the gear beside your profile) has two sections:
Notifications and Appearance. On a server with capability `status`, the
Notifications section starts with your status, covered in [People and
presence](#people-and-presence). Then come **Pause notifications**, **Notify
me about** and the **Notifications** switch, in that order.

### In-page alerts

A mention that lands while the tab is hidden or unfocused flashes the tab
title ("@ You were mentioned") and plays a soft chime. While notifications are
on, a notification replaces the chime. The chime still plays if one couldn't
be shown.

### What notifies you

**Notify me about** is one choice for desktop notifications and push alike,
with one line per option:

- **Mentions**: messages whose `body.mentions` list you, or an edit that adds
  you.
- **Replies to my messages**: replies to one of your messages that is loaded
  here. With the replied-to message not loaded, there is no notification.
- **All messages in private rooms**: a private room or its threads.
- **All messages in joined rooms**: a joined room or its threads.

Messages of your own never notify. At least one option stays checked; the
switch below turns notifications off.

Until you choose, mentions, replies and all messages in private rooms are
checked. So a conversation started from a profile card alerts from its first
message, and push sends `private` in its `wake` (§4.9.4) for it to push.

The choice is kept per account on each server. A server's guests share one,
since their `user_id`s change with each connection. A change applies in other
tabs too.

### Pausing

A signed-in account (not a guest) on a server with capability `status` gets
**Pause notifications**. It is a private mute nobody else sees: "Silence
desktop and push notifications on all your devices for a while. Only you see
it."

**Pause…** opens a menu, each item showing when it would end:

- For 1 hour
- For 8 hours
- Until tomorrow (the next 9:00; "Until this morning" before 9:00)
- Until I resume

The menu opens from the keyboard with the arrow keys too. Its items are out of
the tab order, so Tab closes it with focus back on the button, and moves on
from there.

Choosing one sends a `status` request `{mute}` with the seconds until then, or
`true`. **Resume** sends `{mute: false}`. Neither changes anything here by
itself. The server sends each change to your mutes back to all your
connections, this one included, as a `status` notification (`{mute}` with
seconds left, `true` or `false`). That comes before the request's `{}` result,
and the client takes it as its own setting. So the row shows the pause the
server kept, which may be a shorter one or none. Focus moves to **Resume** (or
back to **Pause…**) once it arrives. A pause set in another tab or on another
device shows here too.

If the server answers with an error instead, such as `retry_after`, nothing
changed. The row keeps what it showed and adds a callout with the server's
message until the next ask: "Notifications weren't paused", or "Notifications
are still paused" for a refused **Resume**. A refused mute is not sent again on
its own.

Every notification a sign-in causes comes after its result
([PROTOCOL.md §3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#32-authentication)).
So at each sign-in the client drops the mutes it kept. After the result, the
server sends every mute in effect, which the client applies as it arrives; any
it doesn't send is off. Some things are not a sign-in, and the mutes stand
through them:

- adding a passkey or an email address to the signed-in connection, a guest's
  included;
- a repeat `auth` as the user the connection is already signed in as.

A lost connection keeps the pause until the next sign-in, so it doesn't
flicker off while reconnecting. The client works out when the pause ends as it
arrives, and resumes on its own then.

While paused:

- the row reads "Paused until 14:30" (or "until tomorrow 9:00", "until you
  resume");
- the profile bar's gear carries a small bell-off badge;
- nothing notifies here: no desktop notifications, chime or title flash;
- mentions that arrive meanwhile don't alert once it ends;
- the server sends no pushes with messages.

A status of `dnd` (do not disturb) silences the page the same way.

### Room mutes

A `status` with a `room_id` mutes that room and its threads, mentions
included: they don't notify, chime or flash the title. It applies whether or
not the room is joined, and `false` (or `0`) ends it. A timed mute ends here
on its own when its time is up.

A signed-in account on a server with capability `status` can mute the open
room or thread from its header's actions menu (⋯). **Mute room** (or **Mute
thread**) offers For 1 hour, For 2 hours, For 8 hours and Until I unmute, each
showing when it would end. While it is muted:

- a bell-off button left of the ⋯ menu says so, and unmutes it;
- the menu offers **Unmute room** (or **Unmute thread**) in place of Mute;
- in a thread muted only by its room's mute, Unmute names the room and
  unmutes it;
- its row in the rooms list shows a bell-off "Muted" icon, and its unread
  count stays quiet, never orange.

A refused mute or unmute shows "Unable to mute" or "Unable to unmute". The
banner of a private room someone added you to offers Mute and Unmute too. The
client follows mutes set elsewhere.

### Turning notifications on

One **Notifications** switch turns notifications on for this device. Chat
apps have one per device rather than one per way of delivering them.

Turning it on asks the browser's permission, from that tap. It then turns on
both of these, where they work:

- the page's own notifications, which alert while Apron is open but hidden or
  unfocused;
- push for the signed-in account, which alerts while Apron is closed.

Turning it off turns both off. It is on if either is, so a choice made with
the separate Desktop and Push switches of earlier versions carries over.
Permission revoked in the browser's site settings reads as off.

The note under the switch says how far it reaches:

- "On · alerts on this device, even when Apron is closed";
- or "On · alerts while Apron is open." followed by why not when it's closed:
  this server doesn't push; sign in; add Apron to the Home Screen; this
  browser can't; this server pushes none of the checked choices; or not yet.

Two buttons may appear under it:

- **Alert when it's closed, too** turns push on where it could work here but
  isn't on for this account (another account turned notifications on, or a
  sign-in since).
- **Alert for this server instead** moves this browser's one subscription
  here from another server that holds it.

**Send a test notification** shows a sample through the same browser path as
the page's own.

### The first-time prompt

Until notifications are turned on or off on this device, the first mention
you'd hear offers them once. A mention in a room you muted doesn't count, nor
one while paused or on do not disturb. The offer is a small prompt (the design
system's `Nudge`): "Get notified when you're mentioned?" It says who mentioned
you and where, and how far notifications would reach: even when Apron is
closed where push works here, else while it's open.

- **Turn on** does what the switch does, from the same tap.
- **Not now**, or Escape within the prompt, turns them off.

Either answer, or using the switch, is the choice. So the prompt isn't offered
again on this device, nor once the browser blocks notifications.

In an installed app (a Home Screen or desktop app window) where push works for
the signed-in account, the same prompt is offered as soon as you're signed in,
without the mention. A phone that's rarely open may not see a mention arrive
for days, and each device asks for its own permission.

With the rooms list showing, the prompt sits above the profile bar, pointing
at the Preferences gear where the switch lives, and says so. On phones, or
with the list collapsed, it sits above the composer. It doesn't take focus
from what you're typing; a screen reader reads it as it appears.

### Web push

Push needs a server that offers web push (`server.push.webpush` with its
VAPID `key`, §4.9). It is for a signed-in account (not a guest), also while it
reconnects. It is per account on each server and off until turned on.
Turning it on or off in one tab applies in the others.

Turning push on (with the Notifications switch, or its button) subscribes
this browser with the server's key, replacing a subscription made with
another key. After each `auth` as that account, the client sends
`push_register` `{kind: "webpush", url, push_id, keys: {p256dh, auth}, wake}`
from the subscription. Turning it off sends `push_unregister`. A registration
the server refuses shows its message in the setting.

#### One subscription per browser

This browser has one subscription for all accounts. It goes once no account
here has push on, which is also checked on load, for one turned off while
offline. Accounts on servers with the same key share it. When another server,
with another key, holds it, the note names that server's host, and **Alert for
this server instead** takes it over. Tabs don't take it back on their own.

The `push_id`s of the accounts push is on for are kept in IndexedDB for the
service worker, which drops a push for any other account.

#### Ordering and retries

- Subscribing and unsubscribing run one at a time, across tabs too under the
  `apron-push` Web Lock where the browser has one.
- A step that finishes after push was turned off, or after the tab moved to
  another server or account, registers nothing.
- Waiting for the service worker gives up after 10 seconds.
- Requests for the same endpoint go one at a time, each after the last one's
  reply. So turning push off and straight back on can't apply in the wrong
  order.

A replaced registration is unregistered. If that can't happen at once, it
happens after the next `auth` as the account it belonged to. It is never
unregistered as another account, since that would remove that account's
registration of the same endpoint.

While push is off for the account signed in, this browser's endpoint is
unregistered after each `auth`, in case an earlier unregister was missed.
Nothing is kept off before the page knows the account, so a page load doesn't
unregister and then register again.

#### Signing out

Signing out unregisters. The connection is replaced before the answer can
come, so the unregister is kept for that account. It is sent again after that
account's next `auth` (not another account's) until the server answers it.
Once signing out has worked, push is off for that account here, even when the
server can't be told. A sign-out that fails (with requests still pending, say)
leaves push on.

#### What push wakes for

Push's `wake` is the checked scopes that `server.push.wake` lists. When the
server lists none, no `wake` goes and the server's defaults apply.

- While push is on, a checked scope the server doesn't push is marked "Only
  while open" beside its title.
- When none of the checked scopes is pushed, push still registers with an
  empty `wake`, which wakes for nothing, and the setting says so.
- A change to the choice registers again at once, with the same `url`.

### Installing the app

On iPhone and iPad Safari outside a Home Screen app, push isn't offered.
Under the Notifications switch, a callout gives the steps to add Apron to the
Home Screen and turn notifications on there.

Where the browser offers to install Apron (Chromium's `beforeinstallprompt`),
the client holds that offer back. It shows **Install app** in a callout under
the Notifications switch only, never elsewhere, and not once Apron runs
installed.

The web manifest (`static/manifest.webmanifest`) names Apron, its icons,
`start_url` and `display: standalone`.

### How pushed notifications show

#### The payload

`push_id` names the account. It is 12 random bytes in base64url (16
characters), made once per account on each server and kept in
`apron.pushIds`, so it reveals neither.

The service worker reads each push payload's `push_id`, `unread` and
`message`. It shows the `message` with its sender and room as the title.

A payload without `message` is a badge push. It only sets the badge and never
shows a notification. This client doesn't ask for those on web push, where a
push that shows nothing may get the browser's own notice.

#### The badge

`unread` becomes the app badge where the browser has one, cleared at 0. While
Apron is in view, the badge is the page's own unread count. A dropped push
leaves the badge alone. So does the service worker while a page of the app is
in view, a tab it doesn't control yet included (as with clicks).

#### One notification per room

Each room keeps one notification, which the next message replaces: its newest
mention, else its newest message. Notifications show through the service
worker, or from the page where there is none yet.

A message notification, the page's or a pushed one, is tagged with the
`push_id` and the `message_id`. A room's notifications are ordered by
`message_id`:

- A message older than the room's newest notified one doesn't notify.
- A new one closes only older ones.
- The same message again replaces its notification quietly (same tag,
  `renotify: false`, silent) while it is showing. That covers a push's
  notification replaced by the page's own, and an edit that newly mentions
  you; the pushed one's title is kept.
- Once dismissed, it doesn't notify again. The newest message each room
  notified about is remembered in IndexedDB.

#### Closing what you've read

Reading a room here closes that room's notifications on this device up to
what you read, pushed or the page's own, as chat apps clear what you've seen.
Reading means its latest message is in view, as moves your read cursor, in a
window that is focused, not only visible. A window behind another, which
notifies of what arrives, leaves its notifications until you come back to it.

Reading a room on another device closes its pushed notifications here too,
up to where you read it, once this page learns of it. While the page is open,
that is at once, from the read cursor the server relays. Otherwise it is when
the page next lists your rooms and gets your read cursors again (where the
server keeps them). On Android, where the app icon's badge only shows that
notifications are waiting, this is what clears it.

Until the page runs, they stay. Web push can't close them without showing
something, which browsers require of every push.

#### Every push shows something

Browsers expect each push to show a notification, and WebKit revokes
subscriptions whose pushes don't. So every push but a badge push shows one.
A push with nothing new, one for an account push isn't on for here, or one
that can't be read shows, in order of preference:

1. what is already showing, again as it is and silently;
2. else the message, quietly (never one older than the room's newest);
3. else "Open Apron to catch up".

If the service worker can't read from IndexedDB the accounts push is on for
(as opposed to their never having been saved), a push for an account shows
only "Open Apron to catch up". It has no preview and sets no badge, since it
may be any account's.

#### Clicks

A click on a pushed notification, or on the page's when its tab has gone,
asks the open tabs for their `push_id`. The tab signed in to that account
opens the room. With no such tab, a new one opens at it, on that account's
server if push is on for it here. A pushed room that the listed rooms don't
include, or that isn't open after 30 seconds, is dropped. A click on the
page's own notification opens that room or thread.

Browsers without push say so. iPhone and iPad Safari say to add Apron to the
Home Screen first.

### Appearance

**Appearance** sets:

- **Theme**: System, Light or Dark. System follows the operating system's
  light or dark preference.
- **Fonts**: an installed font for the interface, for messages (Chat font) and
  for code (Monospace font). Suggestions come from installed fonts where the
  browser allows listing them. The font choice is marked experimental, to be
  replaced by a choice of themes.

All of these preferences stay on this device; settings aren't synced.

## Server settings, permissions and limits

### Read-only users

A server may let someone only read, such as its guests. It says so in their
`you` with `write: false` ([EXT.md §7](../EXT.md#7-extpermissions)).

The composer gives way to a bar saying so:

- Signed in as a guest, the bar has a **Sign in** button, which opens the
  sign-in panel on Passkey (or on Email, where that is how the server signs
  in). Where passkeys can't be used in this browser, the bar says why instead,
  with no button.
- Signed in to an account, the bar only says so.

These are hidden:

- replying, reacting, editing, moving and deleting messages;
- starting threads, and editing rooms and threads;
- adding or removing members;
- Join and Leave.

A room picked under Other Rooms (which shows no Join) opens to read through
its history without joining it. Other Threads offers no Join, since picking
one already reads it.

Other servers' denials show as errors as usual.

### Server settings

The client understands `ext:settings` ([EXT.md §3](../EXT.md#3-extsettings)).
A server that advertises it in `capabilities` describes how it runs in its
`server` frame's `ext.settings`, `{read_cursors?, private_rooms?}`. Without
the capability, the client reads none of them.

- `read_cursors: false` says the server keeps no read cursors, so the client
  doesn't send `read_message_id` (see [Reading and
  unread](#reading-and-unread)).
- `private_rooms` is the most private rooms one user may be in. Starting a
  private room shows how many you're in of it ("2 of 5"), and at the limit
  offers your private rooms to leave instead.

A guest who only reads (`write: false`, see [Read-only
users](#read-only-users)) sees it in the connect screen's Guest hint too.

### Extension data

Other extension data (`ext`,
[PROTOCOL.md §4.12](https://github.com/shazow/apron/blob/main/PROTOCOL.md#412-ext))
on users, messages and rooms is kept as the server sends it. The client writes
`ext` (with `me`, a message, or `room_set`) only to a server with the
capability `ext`, which keeps it. The app itself writes only a bio
(`ext.bio`, with `me`), which also goes to a server with `ext:bio` alone.

### Rate limits

A refusal with `retry_after` holds back further requests of its method when
that is `history` or `message`. For any other method, it fails only itself.

A server that advertises `ext:limits` ([EXT.md §4](../EXT.md#4-extlimits)) may
say more in the refusal's `data.ext.limits`:

- **`write`**: Send counts down under "Sending is paused". Reactions, joins,
  leaves and room edits are refused without being sent. A reaction, join or
  leave says so in a toast, with the server's words and the wait.
- **`upload`**: a notice above the composer says "Uploads are paused". Send
  counts down only while files are attached. A message or command that adds a
  file is refused without being sent. Text, and an edit that keeps its files,
  still go.
- **`read`**, a category the client doesn't know, or none: holds back by
  method, as without the extension.
