# Apron Archives

| Archive Version  | 1          |
|------------------|------------|
| Protocol Version | 9          |
| Last Updated     | 2026-10-30 |

An archive is a chat saved as one file: what a client or a server had of one
Apron server, as JSON Lines. Each line holds the results of requests that a
client can make, `room_list` and `history`, in the shape of the wire. A reader
decodes it as it decodes a server's frames. A tiny server can serve it back,
read-only ([§4](#4-serving)), so any client reads an archive as it reads a
server.

Archives need nothing new from the
[protocol](https://github.com/shazow/apron/blob/main/PROTOCOL.md). This
document fixes how the parts fit in a file, and the few rules for what a file
cannot say by itself: where its records start, what to do with rooms and
records that it holds only in part, and its media.

```jsonl
{"apron_archive":1,"server":"wss://chat.example/","exported_at":"2026-10-27T12:00:00.000Z","you":{"user_id":"ada","name":"Ada"},"media":["https://chat.example"]}
{"joined":[{"room_id":"general","log_id":"1724800000000","title":"General","latest_log_id":"1724803500000","history_log_id":"1724803200042","members":[{"user_id":"ada"},{"user_id":"bob"}]}],"not_joined":[],"users":[{"user_id":"ada","name":"Ada"},{"user_id":"bob","name":"Bob"}]}
{"messages":[{"message_id":"1724803200042","log_id":"1724803200042","room_id":"general","from":{"user_id":"bob","name":"Bob"},"body":{"text":"Hi!"}}]}
{"reactions":[{"log_id":"1724803312011","message_id":"1724803200042","room_id":"general","reactions":[{"from":{"user_id":"ada","name":"Ada"},"emojis":["👍"]}]}]}
```

---

## 1. File

- An archive is UTF-8 [JSON Lines](https://jsonlines.org/): one JSON object
  per line. Readers accept `\r\n`, and skip blank lines.
- The file extension is `.jsonl`, and the media type `application/jsonl`.
- The first line is the header ([§2](#2-header)). Each later line is a part
  ([§3](#3-parts)).
- Readers skip a line that is not a JSON object, and ignore unknown keys.
- An archive is untrusted. Readers decode each record as they decode one from
  a server ([§5.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#54-untrusted-content)),
  and skip a record that is not valid.

## 2. Header

```ts
class Header {
  apron_archive: 1;      // this version
  server?: string;       // the server's WebSocket URL
  exported_at?: string;  // when the archive was written, ISO 8601
  you?: User;            // who it was written as; absent: signed out
  media?: string[];      // origins that its media loads from (§5)
}
```

- A reader refuses a file whose first line has no `apron_archive`, or has a
  version that the reader does not know.
- A later version changes the number only for a change that a reader of this
  version would misread.
- `you` and `users` ([§3.2](#32-users)) leave out `status` and `seen`
  ([§4.5](https://github.com/shazow/apron/blob/main/PROTOCOL.md#45-status)).
  They describe a moment, not the chat.

## 3. Parts

Each line after the header is an object that holds any of these arrays:

| key           | holds                                      | as in                                                                          |
|---------------|--------------------------------------------|--------------------------------------------------------------------------------|
| `joined`      | rooms that `you` had joined                | `room_list` with `members: true` ([§4.2.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#421-listing)) |
| `not_joined`  | the other rooms that the archive lists     | `room_list`                                                                    |
| `users`       | user objects                               | `room_list`                                                                    |
| `rooms`       | room records                               | `history` ([§4.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#43-history)) |
| `messages`    | message snapshots                          | `history`                                                                      |
| `reactions`   | reaction records                           | `history`                                                                      |
| `memberships` | membership records                         | `history`                                                                      |

- A writer MAY write a whole result on one line, as the server sent it, or
  one record per line. Readers ignore the other keys of a result, such as
  `more` and `first_log_id`.
- Readers apply records by replay
  ([§2.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#23-records-and-replay)).
  The order of records across lines does not matter.
- Writers MAY compact records
  ([§4.3.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#434-compaction)).
- The order of listings and users matters: a later listing of a room replaces
  an earlier one, and a later object of a user replaces an earlier one.

### 3.1 Rooms

- An archive lists each room that it holds the log of, in `joined` or
  `not_joined`, as `room_list` does with capability `history`: with `log_id`,
  `latest_log_id`, `history_log_id`, and `members`. It SHOULD list the parent
  of each thread that it lists.
- `history_log_id` is where the archive's stretch of the room's log starts.
  The archive holds every record of the room from `history_log_id` to
  `latest_log_id` that the server held, compacted or not.
  - `null`: the archive holds none of the room's log, only its listing.
  - Absent: the stretch starts at the oldest record of the room in the
    archive.
- A record of a room that the archive does not list, or below the
  `history_log_id` of its room, is a reference. Readers use a message
  snapshot that is a reference only as the target of a `reply_to`
  ([§3.5.4](https://github.com/shazow/apron/blob/main/PROTOCOL.md#354-references)),
  and do not show it in its room. Writers SHOULD leave out references that no
  message in a stretch replies to.
- A listed room without `log_id`, such as from a server without capability
  `history`, is older than every record of the room.

A client that writes an archive from what it holds has the stretches of what
it paged: from the oldest page that it loaded of each room, to the room's
latest. Live deliveries before that, or a `reply_to` target that it received
alone, are references.

### 3.2 Users

- `users` holds the user objects that the writer knew, as they were when it
  wrote the archive.
- A user in a record, such as a message's `from`, is as the record logged it.

## 4. Serving

A reader can serve an archive over the protocol, read-only, to a client that
knows nothing of archives. The server in the page that apron-web opens an
archive with does this.

- Its `server` frame offers only `auth: ["guest"]`, and advertises
  `history`, `rooms`, `reactions`, `ext:permissions`, and `ext:settings` with
  `read_cursors: false` (EXT.md §3), since nothing can be saved there.
- `auth` signs in with `write: false` in `you.ext.permissions`
  ([EXTENSIONS.md](https://github.com/shazow/apron/blob/main/EXTENSIONS.md#extpermissions)).
  Without a scheme besides `guest`, nothing lifts it: a client knows that no
  one can write here ([EXT.md §7.1](EXT.md#71-apron-web)).
- It advertises `ext:media` with the archive's `media` only when the reader
  allows it ([§5](#5-media)), and `ext:archive` ([§4.1](#41-extarchive)).
- `auth` with scheme `guest` signs in as the header's `you`, or as a guest of
  its choice without one, allowed only to read. Any other scheme is
  `unsupported`.
- `room_list` lists the archive's rooms, as `you` had joined them.
- `history` with `room_id` pages the room's stretch: its effective lower bound
  ([§4.3.3](https://github.com/shazow/apron/blob/main/PROTOCOL.md#433-availability-and-retention))
  is the room's `history_log_id`. Each message carries the snapshot that it
  replies to, a reference or not. A reaction record is served in the room that
  its message is in, as compaction leaves it: a message moved since the
  reaction takes it along.
- `history` without `room_id` pages the joined rooms' stretches as one log,
  from the greatest of their `history_log_id`s. Below it, one room's stretch
  might start while another's has not, and one log cannot say so.
- It refuses the requests that change something with `denied`, and replies
  `unsupported` to the rest.
- A listed room without `log_id` gets one below the room's records that no
  record in the archive holds.

### 4.1 `ext:archive`

Adds the archive's header to the `server` frame
([§3.1](https://github.com/shazow/apron/blob/main/PROTOCOL.md#31-server-frame)),
so that a client can say what it is reading:

```ts
class Server {
  // "ext:archive" capability
  ext?: {
    archive?: {
      server?: string;       // the header's `server`
      exported_at?: string;  // the header's `exported_at`
    };
  };
}
```

- The server lists `ext:archive` in `capabilities`.
- apron-web then says in place of the composer whose archive it is, and when
  it was written.

## 5. Media

- An archive holds no files. Avatars, embeds, and attachments stay at the
  URLs in their records.
- `media` lists the origins that the archive's media loads from: the server's
  own, and its `ext:media` origins (EXT.md §6).
- Loading from those origins tells their servers that someone reads the
  archive. A reader asks before it loads media from them.
