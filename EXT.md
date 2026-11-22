# apron-web Extensions

| Protocol Version | 10         |
|------------------|------------|
| Last Updated     | 2026-11-21 |

apron-web is a web client for the
[Apron Chat Protocol](https://github.com/shazow/apron/blob/main/PROTOCOL.md).
It works with any server that implements the
[core](https://github.com/shazow/apron/blob/main/PROTOCOL.md#3-core). This
document lists the extensions that apron-web also understands, and what it
does with each one. [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/EXTENSIONS.md) defines them on the wire: what a
server sends, and what any client does with it. This document keeps only
what apron-web does beyond that, and defines the one convention that
EXTENSIONS.md doesn't have yet: [connection status](#5-connection-status).

---

## 1. Capabilities

apron-web uses a capability
([§4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#4-capabilities))
only while the latest `server` frame advertises it. Without it, apron-web uses
the fallback of that capability:

| capability     | apron-web with it                                                                               | without it                         |
|----------------|-------------------------------------------------------------------------------------------------|------------------------------------|
| `command`      | sends composer text that starts with `/` as `command`, and sends `/nick`, `/join`, `/leave`, `/topic`, `/kick`, and `/invite` as their requests | posts every text as a message      |
| `rooms`        | lists, joins, leaves, creates, and edits rooms and threads                                      | shows the rooms that messages name |
| `history`      | recovers each room, and loads older pages on demand                                             | shows what arrives live            |
| `edit`         | edits, moves, and deletes messages                                                              | no edit, move, or delete controls  |
| `status`       | sets a status, reports idle connections, and sets mutes                                         | no presence                        |
| `activity`     | sends and shows typing and read cursors                                                         | no typing or read indicators       |
| `reactions`    | sets and shows reactions                                                                        | no reaction controls               |
| `embed:upload` | attaches files, and sets an avatar with `/avatar` when `command` is also advertised             | no attachments                     |
| `ext:settings` | follows the server's settings ([§3](#3-extsettings))                                            | keeps read cursors on the server; states no limit of private rooms |
| `ext:limits`   | holds back the requests that a refused request's category of limit covers ([§4](#4-extlimits)) | holds back by method ([§2](#2-the-boundary)) |
| `ext:media`    | loads embed media from the server's media origins, and fits files to its limits ([§6](#6-extmedia)) | loads embed media from the server's origin; refuses no file |
| `ext:permissions` | offers writing, adding members, and moving others' messages as `you` allows ([§7](#7-extpermissions)) | writes; offers adding members in any room, as PROTOCOL.md allows; moves your own messages only |
| `ext:bio`      | shows bios on profile cards, and edits your own ([§8](#8-extbio)); also with `ext`              | no bios                            |
| `ext:emoji`    | shows the server's custom emoji in reactions and text, and offers them to pick ([§9](#9-extemoji)) | shows keys as text, and in reactions as a placeholder |
| `ext:archive`  | says whose archive it reads, and when it was written ([§10](#10-extarchive))                    | says only that you read            |
| `ext:editors`  | asks whether those a message with a checklist mentions may edit its text, lets you edit a message that shares its text with you, and shows who edited it ([§11](#11-exteditors)) | edits only your own messages |
| `ext:command_list` | offers the server's commands, with its own, as a command is typed ([§13](#13-extcommand_list)); with `command` | offers no commands as they are typed |

Some features have no capability:

- apron-web renders `terminal` and `append` embeds (live text) that it receives. It creates `append` embeds
  for one thing, its own `/live` command (with `embed:append`), which types the next message live from the
  composer and finishes it on Send. It never creates `terminal` embeds; a server's `/embed-terminal` and
  `/embed-append` commands do, for a client that types them.
- `server.push` enables Web Push, for accounts that are not guests.
- `server.auth` enables passkeys, and email and external sign-in.
- `server.title`, `description` and `avatar`
  ([§3.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#31-server-frame))
  show the server on the connect screen and under Recent, always with its
  address, and its title and avatar in the sidebar, over its host.
- After a failed WebSocket handshake, apron-web asks the server why over HTTP
  ([§5](#5-connection-status)).
- apron-web renders the Markdown extensions in [§12](#12-markdown), among
  them spoilers (`||text||`).
- apron-web writes no `ext` of its own, except `ext.bio` ([§8](#8-extbio)) and
  `ext.editors` ([§11](#11-exteditors)).
- apron-web sends one request outside PROTOCOL.md, `ext:command_list`
  ([§13](#13-extcommand_list)), and only to a server that lists it.

## 2. The boundary

- apron-web uses a feature outside PROTOCOL.md only through an extension that
  EXTENSIONS.md or this document defines. Its name starts with `ext:`
  ([§4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#4-capabilities)).
- apron-web uses an extension only while the latest `server` frame lists that
  name in `capabilities`. An extension that only keeps data in a user's `ext`,
  such as `ext:bio`, also works with capability `ext`, which keeps any key
  ([§4.13](https://github.com/shazow/apron/blob/main/PROTOCOL.md#413-ext)).
- apron-web reads the data of an extension only from `ext.<name>`, without the
  `ext:` prefix, on the object that the extension defines
  ([§4.13](https://github.com/shazow/apron/blob/main/PROTOCOL.md#413-ext)).
- apron-web ignores a field of an extension whose value has the wrong type,
  and uses its default.
- Without the extension, apron-web behaves as PROTOCOL.md specifies.
- apron-web identifies errors by `code` only. It shows `message` as text, and
  never parses it
  ([§1.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#11-envelope-and-replies)).
- apron-web reads the HTTP status of a refused upload write
  ([§4.8.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#483-writes))
  by its standard meaning only: 413 as a file too large, and 415 as a type that
  the server does not take. Any other status is a refusal.
- apron-web ignores unknown keys
  ([§1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#1-transport--framing)),
  such as keys of an error's `data` other than `retry_after` and, with
  `ext:limits`, `ext`.
- After `retry_after` on a `history` or `message` request, apron-web holds
  back requests of that method until the delay ends. It holds back no other
  method, unless `ext:limits` gives a category ([§4](#4-extlimits)).

---

## 3. `ext:settings`

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/extensions/ext_settings.md):
`server.ext.settings`, `{read_cursors?, read_receipts?, private_rooms?}`.

### 3.1 apron-web

- With `read_cursors: false`, apron-web keeps read cursors in the browser
  only, and sends no `read_message_id`. It still sends `typing`.
- With `read_receipts: "private"`, apron-web shows in a private room how far
  each other member has read. Preferences offers Read Receipts, on by default:
  turned off, the device neither sends the user's read cursor in private rooms
  nor shows the others'. Without it, apron-web shows no receipts.
- It ignores a `private_rooms` that is not a non-negative integer.
- It counts the private rooms that the user joined, without the threads of
  private rooms. When it starts a private room, it shows "N of M", and at the
  limit it offers the user's private rooms to leave, the quietest first, in
  place of starting another. The server's refusal over the limit shows as
  the error.

---

## 4. `ext:limits`

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/extensions/ext_limits.md):
a category of limit, `data.ext.limits`, on `retry_after` errors.

### 4.1 apron-web

- During a `write` or `upload` wait, apron-web refuses each request that the
  wait holds back without sending it. The error carries the server's `message`
  and the time left.
- After `write`, a notice above the composer says that sending is paused, and
  Send counts down. Meanwhile the composer sends no commands either. A held
  reaction, join, or leave shows the server's `message` and the time left.
- After `upload`, a notice above the composer says that uploads are paused.
  Send counts down only while files are attached. Text, and edits that keep
  their files, still go.
- After `read`, without a category, or with a category that apron-web does not
  use for the request, apron-web holds back by method
  ([§2](#2-the-boundary)).

---

## 5. Connection status

A browser hides why a WebSocket handshake failed. A server that refuses
connections, such as one at capacity, can say why over plain HTTP, and when to
try again.

This happens before any `server` frame, so no capability gates it. After a
handshake that fails, the client asks:

```http
GET /ws?apron_connection_status=1 HTTP/1.1
Host: chat.example
Origin: https://web.example
```

A server that refuses connections answers:

```http
HTTP/1.1 503 Service Unavailable
Apron-Connection-Status: 1
Content-Type: application/json
Retry-After: 3600
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: Apron-Connection-Status, Retry-After

{"error": "Daily capacity reached"}
```

- The request is a `GET` of the WebSocket URL over HTTP (`https:` for `wss:`,
  `http:` for `ws:`), with the query parameter `apron_connection_status=1` and
  no credentials.
- The reply has status 403, 429, or 503, the header
  `Apron-Connection-Status: 1`, and a JSON body `{"error": string}`. `error`
  says why, for people.
- The reply MAY carry `Retry-After`, in seconds or as an HTTP date.
- The server MUST allow the client's origin, and list
  `Apron-Connection-Status` and `Retry-After` in
  `Access-Control-Expose-Headers`, so that a browser lets the client read them.
- Clients MUST ignore a reply without `Apron-Connection-Status: 1`, such as a
  page from a host or a proxy in front of the server.
- A server that accepts connections, or that does not implement this, answers
  the request as any other. Clients then reconnect as before.

### 5.1 apron-web

- apron-web asks after each handshake that fails, and waits at most 4 seconds
  for the reply before it reconnects.
- It shows `error`, cut to 300 characters, as the connection error.
- Until `Retry-After` passes, up to a day, it holds back reconnects, manual
  retries included.

---

## 6. `ext:media`

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/extensions/ext_media.md):
`server.ext.media`, the server's media origins and its file limits.

### 6.1 apron-web

- apron-web loads `og` media from `origins`, besides the server's own origin.
  Live text loads from the server's own origin only
  ([§4.8.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#483-writes)).
- apron-web re-encodes every photo, which drops its metadata, as WebP, or as
  JPEG where the browser cannot encode WebP. It scales an image to the smaller
  of 2048 pixels and `max_side`, and steps the quality down to fit
  `max_bytes`. It crops an avatar to a square of 512 pixels, or 256 when 512
  does not fit, no larger than `max_side`.
- apron-web sends an animated image (GIF, APNG, or animated WebP) without
  re-encoding it, but drops its EXIF, XMP and text metadata from the file.
- apron-web fits the file of a `/emoji add` command to `emoji`, and other
  attachments to `upload`. Without `emoji`, it fits that file to `upload`.
- Without a category, or for a type without `max_bytes`, apron-web aims for
  its own preference: 5 MB for attachments, and 256 KB for avatars.
- Without a category, apron-web refuses no file for its type or size. The
  server's 413 or 415 decides.
- With a category, apron-web re-encodes only as a type that the category
  takes, within the limits of that type. A file that it does not re-encode
  (an animated image, audio, video, or another file) it refuses before the
  upload when its type matches no pattern, or when the file is over its
  `max_bytes`. The error names the limit, such as "this server takes audio up
  to 10 MB".
- With `upload`, the file picker offers the patterns of `upload`, unless one
  of them is `*/*`.
- With `upload`, apron-web offers voice clips only when it takes `audio/webm`,
  `audio/ogg`, or `audio/mp4`, in that order, and the browser records that
  type. It records the clip as that type, and stops it at 95% of `max_bytes`.

---

## 7. `ext:permissions`

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/extensions/ext_permissions.md):
`you.ext.permissions`, an object `{write?, add_members?, move_any?}`.

### 7.1 apron-web

- apron-web reads permissions only from `you`, and only while the server
  advertises `ext:permissions`. A key that is absent or not a boolean takes
  its default: `write` on, the others off. So does every key when
  `permissions` isn't an object, such as an older server's list of names.
- Without the extension, apron-web offers what PROTOCOL.md allows: it
  writes, offers adding members in any room (§4.2.2), and offers to move
  only your own messages. The server decides: a `denied` add shows its
  reason where it was asked, and an `unsupported` one stops the offer.
- With `write: false`, apron-web only reads: it replaces the composer with a
  note, and offers no reactions, edits, moves, deletions, joins, leaves, room
  or thread changes, or member changes. A room picked under Other Rooms reads
  through its history, as it does for anyone, but its header offers no Join. For a guest, the note offers to
  sign in; reading an archive (`ext:archive`), it says whose archive it is
  instead ([ARCHIVE.md §4](ARCHIVE.md#4-serving)).
- With `add_members`, the member list's + and a profile card's Add to room
  are offered in any room. With `add_members: false` or absent, they are
  offered only in a private room that the user is a member of.
- When apron-web moves messages into a thread, it adds their authors where it
  offers adding members: with `add_members`, without the extension, or when
  the thread is in a private room.
- apron-web offers to move the messages of other users only with `move_any`.
  Without it, it offers to move only your own messages.
- apron-web shows roles as badges only. They grant nothing.

---

## 8. `ext:bio`

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/extensions/ext_bio.md):
`ext.bio` on user objects, set with `me`.

### 8.1 apron-web

- The profile card shows the bio under the name, after the warning about a
  shared name. It keeps the line breaks, and isolates the bio's direction from
  the text around it.
- It links bare `http:` and `https:` URLs, as in a plain message. Each link
  opens in a new tab, without a referrer. Mentions and Apron links stay text.
- The profile editor has a Bio field while you are signed in. It counts
  characters, and Save waits while the bio is over 250.
- Save sends a changed bio first, then the handle. When the server refuses the
  bio, the editor says why and stays open, and the handle is not sent.

---

## 9. `ext:emoji`

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/extensions/ext_emoji.md):
`server.ext.emoji.catalog_url`, a catalog of custom emoji keyed by `:name:`.

### 9.1 apron-web

- apron-web fetches the catalog the first time it needs it: when the emoji
  picker or the composer's `:shortcode` list opens, or when it shows a key in
  a reaction or in text. It fetches without credentials or a referrer, and
  keeps each catalog for as long as the page, by its `catalog_url`. A fetch
  that fails isn't tried again until the server sends another `catalog_url`.
- Until the catalog arrives, apron-web shows keys as without the extension,
  and then shows them again with their images.
- It shows a key in `body.text`, and in a room's or thread's description,
  the welcome, and the server's description, as its image, at the height of
  the line. Keys in code stay text.
- A reaction chip with a key shows its image, with its `alt` (or the key) in
  the tooltip. A key that the catalog doesn't have, or any key without the
  extension, shows as a dashed placeholder with the key in the tooltip.
  Tapping either toggles the user's reaction with that key.
- The full emoji picker lists the catalog's emoji, without `hidden` ones,
  each in its `category`, after the standard emoji. Its search finds them by
  key, `alt` and tags. Picking one reacts with its key, or inserts the key at
  the composer's caret.
- The composer's `:shortcode` list offers matching custom emoji first.
- Where the user prefers reduced motion, apron-web shows `static_url` in
  place of `url`.

---

## 10. `ext:archive`

An apron-web extension: a server that serves an archive, read-only, says so,
and whose archive it is.
[ARCHIVE.md §4.1](ARCHIVE.md#41-extarchive) defines it.

### 10.1 apron-web

- apron-web says in place of the composer which server the archive is from,
  and when it was written.

---

## 11. `ext:editors`

A message's sender shares the editing of its text with the users that it
mentions.
[EXTENSIONS.md](https://github.com/shazow/apron/blob/main/extensions/ext_editors.md)
defines it.

### 11.1 apron-web

- When you send a message that mentions someone and holds a task list, apron-web
  asks first whether they may edit it. "Let them edit" sends
  `ext.editors {"body.text": "mentioned"}`; "Only I can edit" sends none.
- apron-web asks only for a message, not a command, and after the ask to add
  who it mentions to the room.
- On someone else's message that shares its text with you, apron-web offers
  Edit for the text only, and enables its task list checkboxes. It offers no
  delete, reply removal, or embed changes.
- apron-web shows `edited_by` under the text as "edited by" and the user's
  name.

---

## 12. Markdown

A `markdown` body is CommonMark, and clients MAY render common extensions
([§3.5.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#352-rendering)).
These are the ones apron-web renders, and writes from its composer, so that
other clients can render the same set. A client without one of them still
shows its syntax as text, so the message stays readable.

| Syntax                         | apron-web renders                                 | As defined by                                                                                      |
|--------------------------------|---------------------------------------------------|----------------------------------------------------------------------------------------------------|
| a line break                   | a line break, not a space                         | §3.5.2 (soft breaks as hard breaks)                                                                |
| `\| a \| b \|` and `\|---\|---\|` | a table, each column aligned as its `:` say     | [GFM tables](https://github.github.com/gfm/#tables-extension-)                                     |
| `~~text~~` (two tildes)        | struck-through text                               | [GFM strikethrough](https://github.github.com/gfm/#strikethrough-extension-)                       |
| `- [ ] task`, `- [x] done`     | a checklist ([§12.2](#122-task-lists))            | [GFM task list items](https://github.github.com/gfm/#task-list-items-extension-)                   |
| `\|\|text\|\|`                 | a spoiler ([§12.1](#121-spoilers))                | this section                                                                                       |
| `http(s)://…`, `apron:?…`      | a link, without `<` `>` around it                 | a bare URL runs to the next space, `<`, `>` or `"`, without `.,:;!?'*_~` or an unopened `)` at its end |
| ```` ```lang ````              | code, highlighted as `lang` where apron-web knows it | the fence's info string (CommonMark)                                                               |

Mentions (`@user_id`, `#room_id`,
[Appendix A.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#a3-prefixes-in-text))
and custom emoji keys ([§9](#9-extemoji)) aren't Markdown: apron-web shows
them in messages and descriptions, outside code and links.

apron-web renders no other extension: no raw HTML (it shows as text), no
footnotes, definition lists, `==highlight==`, math, or typographic quotes.

### 12.1 Spoilers

- `||text||` hides `text` until the reader shows it. Its `||` pair as
  markdown-it's `~~` do, with `|` for `~`: a run of bars opens or closes by
  CommonMark's flanking rules, splits into pairs (an odd run leaves one `|` as
  text), and pairs with the nearest run that can close it. Spoilers nest with
  emphasis and with each other, and `a || b`, with space on both sides, is no
  spoiler. A spoiler is inline, so
  it ends with its paragraph. In a table cell its bars are escaped
  (`\|\|text\|\|`), as any `|` in a cell is.
- Where a client shows text without rendering it (a notification, a reply's
  quote, a card), it SHOULD show a spoiler as a placeholder of the same
  length whatever it hides. apron-web shows `▒▒▒▒▒`.
- A spoiler hides text from view, not from other clients: one without this
  extension shows `||text||` as written.

### 12.2 Task lists

- A list item whose text starts with `[ ]`, `[x]` or `[X]` and a space shows
  a checkbox in its place. One with nothing after its marker stays text.
- Where the viewer may edit the message (`edit`, and [§11](#11-exteditors)),
  checking a box edits the message's text: it rewrites that one marker.

---

## 13. `ext:command_list`

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/extensions/ext_command_list.md):
the `ext:command_list` request, which returns the commands that the user can
use, as `/help` lists them.

### 13.1 apron-web

- apron-web sends `ext:command_list` only while the server advertises it and
  `command`. Without both, it offers no commands as they are typed. It still
  sends a command that isn't listed, as without the extension.
- It asks when the user first starts a command on the page (a `/` at the start
  of the composer, or the command reference), and again after a day;
  whenever the user sends `/help`; and on connecting, signed in to an
  account, only while it keeps no list for it, at most once a day. A guest's list is asked for as its first command
  starts. A refused or lost request is asked again, as a command starts, a
  minute later.
- It keeps a list for the `user_id` it was listed for, by server and
  `user_id`. An account's is kept on the device too, for the ten accounts asked
  latest and in at most 150,000 characters, so the next visit offers it at
  once, while the first command started there asks for it anew. A guest's,
  whose `user_id` lasts one connection, is kept for that connection only.
- A `/` at the start of the composer lists the commands: the first word of
  each name once. Once that word and a space are typed, it lists every command
  they start, the command they name and each of its forms, and the next word
  typed narrows them. Each row shows `/name`, `hint` as written, the words of
  its forms, `description`, and its Required label. Picking one puts in
  `/name ` and nothing else. The last row, Browse all commands, opens the
  command reference, and leaves the draft as it is; Enter takes it only once
  the arrow keys went to it, so Enter on a command that no row names sends
  it.
- Once the words typed name a command (the longest name all of whose words
  start the draft, exactly), and its arguments are being typed, the card shows
  that command's entry alone, as the reference does, and keeps it shown as they
  are typed. It only informs: Tab and the arrows stay the field's, and Enter
  sends. It goes when the draft is no command, names none, or is sent, and
  Escape puts it, or the list, away while the same name is typed.
- `/help` alone, once the server's list is known (kept, or listed), opens the
  command reference rather than going to the server, and asks for the list
  anew; if that ask fails, the reference says it may be out of date. Before a
  list is known, any other `/help`, such as `/help kick`, and `/help` without
  the extension go to the server.
- The command reference is a document of every command, read only, as the
  keyboard shortcuts are: a heading per `group`, widest first: Everyone
  (`all`), Guests (`guest`), Members (`member`), Room owners (`room`), Roles
  (`role`) and Admins (`admin`), each in the server's order; then the server's
  commands without a `group` that it knows (Other, or Server when none has
  one); then its own (Built into the client). Empty groups have no heading.
  Each command is its `/name` and `hint` as code, then `description`, then, where it has
  `requires`, a label naming each field: "Required: reply" for `reply_to`,
  "mention" for `body.mentions`, "attachment" for `body.embeds`, several
  together ("Required: reply, attachment"). Fields only in `uses` get none.
  Each form, such as `/emoji add`, is an entry of its own, in the server's
  order. Pressing a command's code closes it and puts `/name ` in the
  composer, in place of the command text there, as picking one from the `/`
  list does.
- It adds its own commands, which it handles itself (`/nick`, and with `rooms`,
  `/join`, `/leave`, `/topic`, and while the server takes member changes,
  `/kick` and `/invite`; `/live` with `embed:append`), by their names exactly.
  Where the server lists a command whose words all lead the draft (`kick`, or a
  form such as `topic clear`), the server's takes its place: apron-web sends
  the draft to the server as a `command`, the list and the card show the
  server's, and the reference lists apron-web's own crossed out, "Replaced by
  the server's /kick". Once the server stops listing it, apron-web's own works
  again.
- A command that uses `room_id` shows "In this room", apart from its Required
  label, which never names `room_id`: apron-web sends every command with the
  `room_id` of the room it's typed in. Where there is none to name (a server
  without `rooms`, whose one room goes unnamed), it doesn't offer a command that
  requires `room_id`, and the reference says "Open a room to use it" in place of
  its button.
- It offers a command that requires `reply_to` only while the user replies.
  Every other command it offers whatever its `requires`, since mentions and
  files can come after the name. While the user replies, commands that use
  `reply_to` come first, and while files are attached, those that use
  `body.embeds`.
- Names are case-sensitive, the server's and apron-web's own alike (as
  without the extension): the words typed before the caret match a name's
  exactly, and the word at the caret suggests the names it starts, exactly too
  (`/Ki` suggests no `/kick`, and says no command matches).
- It ignores an entry without a `name`, with a name listed before, or one that
  starts with `/`, and a field of `uses` or `requires`, or a `group`, that it
  doesn't know. A field of the wrong type takes its default, and a field in
  `requires` counts in `uses` too. It keeps at most 500 commands, names of up
  to 100 characters, and descriptions and hints cut to 500, without bidi
  controls, and with control characters as spaces.
