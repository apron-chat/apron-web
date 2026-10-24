# apron-web Extensions

| Protocol Version | 9          |
|------------------|------------|
| Last Updated     | 2026-10-24 |

apron-web is a web client for the
[Apron Chat Protocol](https://github.com/shazow/apron/blob/main/PROTOCOL.md).
It works with any server that implements the
[core](https://github.com/shazow/apron/blob/main/PROTOCOL.md#3-core). This
document lists the extensions that apron-web also understands, and what a
server implements to use each one.

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
| `ext:settings` | follows the server's settings ([§3](#3-extsettings))                                            | every setting is `true`            |
| `ext:limits`   | holds back the requests that a refused request's category of limit covers ([§4](#4-extlimits)) | holds back by method ([§2](#2-the-boundary)) |
| `ext:media`    | loads embed media from the server's media origins, and fits files to its limits ([§6](#6-extmedia)) | loads embed media from the server's origin; refuses no file |
| `ext:permissions` | moves other users' messages, and adds their authors, as `you` allows ([§7](#7-extpermissions)) | moves your own messages only       |

Some features have no capability:

- apron-web renders `stream` embeds that it receives. It never creates them.
- `server.push` enables Web Push, for accounts that are not guests.
- `server.auth` enables passkeys, and email and external sign-in.
- After a failed WebSocket handshake, apron-web asks the server why over HTTP
  ([§5](#5-connection-status)).
- apron-web writes no `ext` of its own.

## 2. The boundary

- apron-web uses a feature outside PROTOCOL.md only through an extension that
  this document defines. Its name starts with `ext:`
  ([§4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#4-capabilities)).
- apron-web uses an extension only while the latest `server` frame lists that
  name in `capabilities`.
- apron-web reads the data of an extension only from `ext.<name>`, without the
  `ext:` prefix, on the object that the extension defines
  ([§4.12](https://github.com/shazow/apron/blob/main/PROTOCOL.md#412-ext)).
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

### 2.1 Known departures

These predate this document. Each one is to move behind an extension, or go:

- apron-web asks for a display name with a pasted token only when the token
  starts with `apron_join_`.

---

## 3. `ext:settings`

A server can let users do less than its capabilities allow, such as a server
whose guests only read. A client that knows this shows the controls that work.

Adds server settings to the `server` frame
([§3.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#31-server-frame)):

```ts
class Server {
  // "ext:settings" capability
  ext?: {
    settings?: {
      guest_posting?: boolean = true;  // guests may post
      read_cursors?: boolean = true;   // the server keeps or relays read cursors
      add_members?: boolean = true;    // users may add other users to rooms
    };
  };
}
```

```json
{
  "method": "server", "params": {
    "apron": 9, "capabilities": ["rooms", "activity", "ext:settings"], "auth": ["guest", "webauthn"],
    "ext": {"settings": {"guest_posting": false, "read_cursors": false}}
  }
}
```

- The server lists `ext:settings` in `capabilities`.
- Every key is optional. A key that is absent, or not `false`, means `true`.
- Each `server` frame replaces the settings.
- The settings describe server policy. The server still enforces it.

### 3.1 `guest_posting`

- `false` means that guests only read.
- apron-web treats a session as a guest's when it starts with scheme `guest`
  ([§3.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#32-authentication)),
  until the user signs in or adds another scheme.
- While a guest only reads, apron-web replaces the composer with a prompt to
  sign in. It offers no reactions, joins, leaves, room or thread changes, or
  member changes.

### 3.2 `read_cursors`

- `false` means that the server neither keeps nor relays `read_message_id`
  ([§4.6](https://github.com/shazow/apron/blob/main/PROTOCOL.md#46-activity)).
- apron-web then keeps read cursors in the browser only, and sends no
  `read_message_id`. It still sends `typing`.

### 3.3 `add_members`

- `false` means that users may not add other users with `room_join` and
  `user_id`
  ([§4.2.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#422-membership)).
- When apron-web moves messages into a thread, it adds their authors to that
  thread only while `add_members` is `true`, or while `ext:permissions` grants
  `add_members` ([§7](#7-extpermissions)).

---

## 4. `ext:limits`

`retry_after` says that a request waits, but not which limit it hit, or what
else that limit counts. A client that knows can hold back every request that
the limit counts, rather than send each one to be refused, and show the user
what waits.

Adds a category of limit to `retry_after` errors
([§1.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#11-envelope-and-replies)):

```ts
class Server {
  capabilities: string[];  // lists "ext:limits"
}

class RetryAfterError {  // code -32002
  message: string;         // which limit the request hit
  data: {
    retry_after: number;
    // "ext:limits" capability
    ext?: {
      limits?: "read" | "write" | "upload";
    };
  };
}
```

Each category covers a set of requests. Until the delay ends, clients hold
back these requests:

| category | requests it covers                                                     | what clients hold back             |
|----------|------------------------------------------------------------------------|------------------------------------|
| `read`   | `history`, `room_list`                                                 | requests of the refused method     |
| `write`  | `message`, `reactions`, `room_join`, `room_leave`, `room_set`          | every request that `write` covers  |
| `upload` | `message` and `command` requests that add an upload: an `upload` embed without an `embed_id` ([§4.8.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#482-embed-identity)) | every request that `upload` covers |

A command can do anything, so `write` does not cover `command`. A save that
keeps an upload sends it back with its `embed_id`, so `upload` does not cover
the save.

The server advertises the extension:

```json
{
  "method": "server", "params": {
    "apron": 9, "capabilities": ["rooms", "history", "reactions", "embed:upload", "ext:limits"], "auth": ["guest", "webauthn"]
  }
}
```

A refused page of history, from a limit on reading:

```jsonc
// ->
{"method": "history", "id": "c9", "params": {"room_id": "general", "before": "1724806800000"}}
// <-
{"id": "c9", "error": {"code": -32002, "message": "History request limit reached", "data": {"retry_after": 20, "ext": {"limits": "read"}}}}
```

A refused post, from a limit that counts every request that `write` covers:

```jsonc
// ->
{"method": "message", "id": "c42", "params": {"room_id": "general", "body": {"text": "hello", "format": "plain"}}}
// <-
{"id": "c42", "error": {"code": -32002, "message": "Posting limit reached", "data": {"retry_after": 40, "ext": {"limits": "write"}}}}
```

A refused upload, from a limit on files. Messages without files still go:

```jsonc
// ->
{
  "method": "message", "id": "c43", "params": {
    "room_id": "general",
    "body": {"text": "Before the fix:", "embeds": [{"kind": "upload", "title": "before.png"}]}
  }
}
// <-
{"id": "c43", "error": {"code": -32002, "message": "Daily upload limit reached", "data": {"retry_after": 19800, "ext": {"limits": "upload"}}}}
```

A refusal from a limit that fits no category:

```jsonc
// ->
{"method": "auth", "id": "c1", "params": {"scheme": "guest", "name": "Ada"}}
// <-
{"id": "c1", "error": {"code": -32002, "message": "Sign-in attempts limited for this network", "data": {"retry_after": 600}}}
```

- The server lists `ext:limits` in `capabilities`.
- A `retry_after` error that replies to a request MAY carry `data.ext.limits`.
- The server MUST send a category only on a request that the category covers.
- The server MUST send `write` only for a limit that counts every request that
  `write` covers and that changes something.
- The server MUST send `upload` only for a limit that counts every request
  that adds an upload.
- A limit MAY leave out a request that changes nothing, such as a
  deduplicated retry
  ([§1.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#12-retries-and-deduplication))
  or a `room_join` of a room that the user has already joined.
- The server SHOULD send no category for a limit that fits none, or when it is
  not sure that a limit fits one.
- The category describes server policy. The server still refuses each request
  over a limit.
- `message` SHOULD say which limit the request hit. It SHOULD NOT state
  amounts, rates, thresholds, or the delay. `retry_after` carries the delay.
- Clients MUST ignore `data.ext.limits` unless the latest `server` frame lists
  `ext:limits`.
- Until the delay ends, clients SHOULD hold back the requests that the table
  lists for the category. They MUST NOT hold back other requests for it.
- Without a category, with a category that clients do not know, or with one
  that does not cover the refused request, clients handle the error as without
  `ext:limits`.

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

A server can serve its files from another origin, such as a storage bucket,
and take only some types and sizes of file. A client that knows can load those
files, and fit a file to the server, or refuse it, before it uploads the file.

Adds media to the `server` frame
([§3.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#31-server-frame)):

```ts
class Server {
  // "ext:media" capability
  ext?: {
    media?: {
      origins?: string[];
      upload?: {[pattern: string]: Limits};
      avatar?: {[pattern: string]: Limits};
    };
  };
}

class Limits {
  max_bytes?: number;
  max_side?: number;
}
```

| field       | meaning                                                                                   |
|-------------|-------------------------------------------------------------------------------------------|
| `origins`   | origins besides the server's own that serve its media                                     |
| `upload`    | the types of file that the server takes as attachments ([§4.8.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#484-embedupload)), with their limits |
| `avatar`    | the types of image that the server takes with `/avatar` ([§4.8.6](https://github.com/shazow/apron/blob/main/PROTOCOL.md#486-avatars)), with their limits |
| `max_bytes` | the largest file, in bytes                                                                |
| `max_side`  | the longest side, in pixels, of an image as the server keeps it; clients need not send larger |

```json
{
  "method": "server", "params": {
    "apron": 9, "capabilities": ["command", "embed:upload", "ext:media"], "auth": ["guest", "webauthn"],
    "ext": {"media": {
      "origins": ["https://media.chat.example"],
      "upload": {
        "image/*": {"max_bytes": 5242880, "max_side": 2048},
        "image/gif": {"max_bytes": 5242880},
        "audio/*": {"max_bytes": 10485760}
      },
      "avatar": {"image/*": {"max_bytes": 262144, "max_side": 512}}
    }}
  }
}
```

- The server lists `ext:media` in `capabilities`.
- Every field is optional. Clients ignore unknown keys, and each field of the
  wrong type or range on its own, such as a limit that is not a positive
  integer, or a category or limits that are not an object.
- Each `server` frame replaces the media.
- `origins` lists exact origins, `scheme://host[:port]` without a path or a
  query. Each is `https:`, or `http:` on `localhost`, `127.0.0.1`, or `[::1]`.
  Clients ignore other entries.
- Clients MAY load `og` media
  ([§4.8.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#481-opengraph-metadata-og))
  from `origins` as well as from the server's own origin, only for content
  from a connection to that server.
- `upload` and `avatar` are categories. Each maps MIME patterns to limits. A
  pattern is an exact `type/subtype`, a group `type/*`, or `*/*`, in any
  case.
- A file takes the limits of its most specific pattern: its exact type, then
  its group, then `*/*`. The order of keys does not matter.
- The server does not take a file whose type matches no pattern of the
  category. `{}` takes the type without a stated limit. Clients ignore unknown
  limits.
- Without a category, nothing is known about it. Clients then behave as
  without `ext:media`.
- A file's type is the type that the client declares for it: the
  `Content-Type` of its write
  ([§4.8.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#483-writes)),
  or `application/octet-stream` without one. A client that re-encodes a file
  declares the new type.
- The media describe server policy. The server still decides by content, and
  MAY refuse a write with 413 or 415.

### 6.1 apron-web

- apron-web loads `og` media from `origins`, besides the server's own origin.
  Streams load from the server's own origin only
  ([§4.8.5](https://github.com/shazow/apron/blob/main/PROTOCOL.md#485-embedstream)).
- apron-web re-encodes every photo, which drops its metadata, as WebP, or as
  JPEG where the browser cannot encode WebP. It scales an image to the smaller
  of 2048 pixels and `max_side`, and steps the quality down to fit
  `max_bytes`. It crops an avatar to a square of 512 pixels, or 256 when 512
  does not fit, no larger than `max_side`.
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

Roles are for display only
([§3.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#33-identity)),
so a client cannot tell from them what a user may do. A server can tell each
user what it lets them do beyond their own messages, so that the client offers
those controls.

Adds permissions to the user object of the signed-in user, `you`
([§3.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#33-identity)):

```ts
class Identity {
  // "ext:permissions" capability, in `you` only
  ext?: {
    permissions?: string[];
  };
}
```

| permission    | the user may                                                                            |
|---------------|-----------------------------------------------------------------------------------------|
| `move_any`    | move the messages of other users to another room: into a thread, or back out of one     |
| `add_members` | add other users to rooms, with `room_join` and `user_id` ([§4.2.2](https://github.com/shazow/apron/blob/main/PROTOCOL.md#422-membership)), also while `ext:settings` says `add_members: false` |

```jsonc
// <-
{"id": "c1", "result": {"you": {"user_id": "ada", "name": "Ada", "roles": ["admin"], "ext": {"permissions": ["move_any", "add_members"]}}}}
```

- The server lists `ext:permissions` in `capabilities`.
- The server sends `permissions` in `you`: in an `auth` or `me` result, and in
  a `user` notification. A change of permissions is a `user` notification
  with `you`
  ([§3.3.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#333-changes)).
- Clients read `permissions` only from `you`, never from the object of
  another user.
- Clients ignore unknown permissions, and entries that are not strings.
- Without `move_any`, clients offer to move only the user's own messages.
  Without `add_members`, `ext:settings` decides ([§3.3](#33-add_members)).
- The server owns `ext.permissions`. A `me` request MUST NOT change it.
- The permissions describe server policy. The server still checks each
  request.

### 7.1 apron-web

- apron-web offers to move the messages of other users only with `move_any`.
  Without it, it offers to move only your own messages.
- When apron-web moves messages into a thread, it adds their authors with
  `add_members`, or while `ext:settings` allows it.
- apron-web shows roles as badges only. They grant nothing.
