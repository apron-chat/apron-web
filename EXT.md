# apron-web Extensions

| Protocol Version | 9          |
|------------------|------------|
| Last Updated     | 2026-10-29 |

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

Some features have no capability:

- apron-web renders `terminal` and `append` embeds (live text) that it receives. It never creates them; a
  server's `/embed-terminal` and `/embed-append` commands do, for a client that types them.
- `server.push` enables Web Push, for accounts that are not guests.
- `server.auth` enables passkeys, and email and external sign-in.
- `server.title`, `description` and `avatar`
  ([§3.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#31-server-frame))
  show the server on the connect screen and under Recent, always with its
  address, and its title and avatar in the sidebar, over its host.
- After a failed WebSocket handshake, apron-web asks the server why over HTTP
  ([§5](#5-connection-status)).
- apron-web writes no `ext` of its own, except `ext.bio` ([§8](#8-extbio)).

## 2. The boundary

- apron-web uses a feature outside PROTOCOL.md only through an extension that
  EXTENSIONS.md or this document defines. Its name starts with `ext:`
  ([§4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#4-capabilities)).
- apron-web uses an extension only while the latest `server` frame lists that
  name in `capabilities`. An extension that only keeps data in a user's `ext`,
  such as `ext:bio`, also works with capability `ext`, which keeps any key
  ([§4.12](https://github.com/shazow/apron/blob/main/PROTOCOL.md#412-ext)).
- apron-web reads the data of an extension only from `ext.<name>`, without the
  `ext:` prefix, on the object that the extension defines
  ([§4.12](https://github.com/shazow/apron/blob/main/PROTOCOL.md#412-ext)).
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

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/EXTENSIONS.md#extsettings):
`server.ext.settings`, `{read_cursors?, private_rooms?}`.

### 3.1 apron-web

- With `read_cursors: false`, apron-web keeps read cursors in the browser
  only, and sends no `read_message_id`. It still sends `typing`.
- It ignores a `private_rooms` that is not a non-negative integer.
- It counts the private rooms that the user joined, without the threads of
  private rooms. When it starts a private room, it shows "N of M", and at the
  limit it offers the user's private rooms to leave, the quietest first, in
  place of starting another. The server's refusal over the limit shows as
  the error.

---

## 4. `ext:limits`

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/EXTENSIONS.md#extlimits):
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

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/EXTENSIONS.md#extmedia):
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

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/EXTENSIONS.md#extpermissions):
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
  or thread changes, or member changes. Other Rooms lists rooms without Join:
  picking one reads it through its history. For a guest, the note offers to
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

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/EXTENSIONS.md#extbio):
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

Defined in [EXTENSIONS.md](https://github.com/shazow/apron/blob/main/EXTENSIONS.md#extemoji):
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
