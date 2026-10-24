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
  such as keys of an error's `data` other than `retry_after`.
- After `retry_after` on a `history` or `message` request, apron-web holds
  back requests of that method until the delay ends. It holds back no other
  method.

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

## 4. Proposed extensions

apron-web does not implement these.

### 4.1 `ext:limits`

`retry_after` does not say which limit a request hit. A client that knows it
can hold back every request that the limit covers, and name the limit to the
user.

- The server lists `ext:limits` in `capabilities`.
- A `retry_after` error then MAY carry `data.ext.limits`, a string that names
  the limit, such as `"post"` or `"upload"`.
- apron-web would show the named limit only while `ext:limits` is advertised.
  Without it, apron-web holds back requests by method.
