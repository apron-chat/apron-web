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

Some features have no capability:

- apron-web renders `stream` embeds that it receives. It never creates them.
- `server.push` enables Web Push, for accounts that are not guests.
- `server.auth` enables passkeys, and email and external sign-in.
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
- apron-web ignores unknown keys
  ([§1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#1-transport--framing)),
  such as keys of an error's `data` other than `retry_after` and, with
  `ext:limits`, `ext`.
- After `retry_after` on a `history` or `message` request, apron-web holds
  back requests of that method until the delay ends. It holds back no other
  method, unless `ext:limits` gives a category ([§4](#4-extlimits)).

### 2.1 Known departures

These predate this document. Each one is to move behind an extension, or go:

- After a failed WebSocket handshake, apron-web sends an HTTP `GET` to the
  server URL with `?apron_connection_status=1`. It shows the `error` of a JSON
  reply with status 403, 429, or 503, and waits for its `Retry-After`.
- apron-web asks for a display name with a pasted token only when the token
  starts with `apron_join_`.
- apron-web offers to move the messages of other users only to users with role
  `admin` or `mod`. For role `admin`, it adds the authors of moved messages
  also while `add_members` is `false`.
- apron-web shrinks images to fit 5 MB, and avatars to fit 256 KB, before it
  uploads them. It refuses an animated image over 5 MB.
- apron-web reads the HTTP status of a failed upload write as a cause, such as
  404 for an expired upload.

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
  thread only while `add_members` is `true`.

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

| category | requests it covers                                                                    | what clients hold back                          |
|----------|---------------------------------------------------------------------------------------|-------------------------------------------------|
| `read`   | `history`, `room_list`                                                                | requests of the refused method                  |
| `write`  | `message`, `command`, `reactions`, `room_join`, `room_leave`, `room_set`, `me`        | every request that `write` covers               |
| `upload` | `message` and `command` requests that carry `upload` embeds ([§4.8.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#484-embedupload)) | every request that `upload` covers |

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
  `write` covers.
- The server MUST send `upload` only for a limit that counts every request
  that `upload` covers.
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
  Send counts down. A held reaction, join, or leave shows the server's
  `message` and the time left.
- After `upload`, a notice above the composer says that uploads are paused.
  Send counts down only while files are attached, and text still sends.
- After `read`, without a category, or with a category that apron-web does not
  use for the request, apron-web holds back by method
  ([§2](#2-the-boundary)).
