/** The public shapes of `ChatClient`: its snapshot, handles, and request options. */
import type { RoomRename, TimelineState } from './reducer';
import type {
	JsonObject,
	Capability,
	Identity,
	MessageBody,
	Embed,
	RoomRecord,
	ServerParams
} from './types';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';
export type MessageFormat = 'plain' | 'markdown';

/**
 * A transient notice (PROTOCOL.md §3.5, Appendix A.1): a `message` without
 * `message_id`, such as a `~private` command reply, or a local one such as a
 * command's error. It shows in its room for the session and is never stored
 * as a snapshot, so it never takes part in replay.
 */
export interface Notice {
	/** Unique within the session. */
	key: string;
	room_id: string;
	from: Identity;
	body?: MessageBody;
	/**
	 * Where it sits in the room's timeline: after every message whose
	 * `message_id` is at most this position, the newest the room had when the
	 * notice arrived.
	 */
	after: string;
	/** When it arrived, in epoch milliseconds (notices carry no `log_id`). */
	at: number;
	/**
	 * It arrived before this connection authenticated, such as a server's
	 * welcome. Servers send those again on each connection, so a new one
	 * replaces the last rather than stacking (PROTOCOL.md Appendix B).
	 */
	welcome?: boolean;
}

/**
 * One visible room: a room the user has joined on this connection (capability
 * `rooms`), else one a message arrived in, or a room opened without joining
 * it (`viewRoom`, `joined: false`). Threads are rooms with `parentRoomId`
 * (PROTOCOL.md §3.4, §4.3).
 */
export interface RoomSnapshot {
	id: string;
	/** Display title: the record's `title`, falling back to the `room_id`. */
	title: string;
	/**
	 * The user has joined it (or, without capability `rooms`, it is a room messages
	 * arrive in): it delivers live. A room opened with `viewRoom` is not joined
	 * and changes only when it loads.
	 */
	joined: boolean;
	/** The stored room record (client fields plus `log_id`), without delivery fields. */
	record?: RoomRecord;
	/** Set for threads; fixed at creation. */
	parentRoomId?: string;
	/**
	 * The server keeps the room private (§4.3.4): only its members see it.
	 * Fixed at creation; absent means an ordinary room.
	 */
	private?: boolean;
	/** Your notifications from this room and its threads are paused until then (§4.5 `mute` with its `room_id`): epoch milliseconds, or `true`. Absent when not. */
	mutedUntil?: number | true;
	/** What the room is about (§3.4), CommonMark by convention; absent when empty. */
	description?: string;
	/**
	 * The least `log_id` of this room's records seen: where a thread's card
	 * stays put in its parent's feed while edits give the record new `log_id`s.
	 */
	firstRecordLogId?: string;
	/** Opaque extension data from the room record. */
	ext?: JsonObject;
	/** Title changes seen in the room's log, ascending (absent when none). */
	renames?: RoomRename[];
	/** Greatest `log_id` known in the room's log. */
	latestLogId?: string;
	/** Advertised lower bound of retrievable history, `null` when none. */
	historyLogId?: string | null;
	/**
	 * Messages homed in this room with their aggregated reactions. While an
	 * automatic history recovery runs the published timeline is held (empty
	 * for a rebuild) and replaced when the recovery completes or fails.
	 */
	timeline: TimelineState;
	/** An automatic history recovery is running. */
	recovering: boolean;
	/** The last recovery or `loadRoom` failed; `loadRoom` retries. */
	recoveryError?: string;
	/**
	 * History for this room has been loaded on this connection: always true
	 * without capability `history`; for top-level rooms after the first recovery; for
	 * threads after `loadRoom` completed.
	 */
	loaded: boolean;
	/** A `loadRoom` request is in flight. */
	loading: boolean;
	/**
	 * A thread loaded newest-first has older records to fetch with
	 * `loadOlder`; its message count is a lower bound until they are.
	 */
	olderAvailable?: boolean;
	/** A `loadOlder` request is in flight. */
	loadingOlder?: boolean;
	/** Your read cursor in this room (§4.6), as the server last reported or you advanced it. */
	readMessageId?: string;
	/**
	 * The room's members (§4.3.2): started from a complete `members` listing
	 * (`room_list` with `members`, or `room_update` `joined`) and kept current by
	 * the memberships received live and in history. Each is the listed or
	 * recorded user object; render it through the kept one. Undefined until
	 * anything is known.
	 */
	members?: Identity[];
	/**
	 * How many users have joined, when the server listed only the most
	 * recently active in `members` (§4.3.1), as of that listing.
	 */
	memberCount?: number;
	/** Transient notices shown in this room this session, in arrival order. */
	notices: readonly Notice[];
}

/**
 * A visible room as `room_list` returns it (§4.3.1): its record, its head,
 * and its members. Listing a room does not join it.
 */
export interface RoomListing {
	id: string;
	title: string;
	record: RoomRecord;
	/** As in `RoomSnapshot`. */
	firstRecordLogId?: string;
	parentRoomId?: string;
	latestLogId?: string;
	historyLogId?: string | null;
	/** The room's members when the listing asked for them (`members: true`), else empty. */
	members: Identity[];
	/** The total when the server truncated `members` (§4.3.1). */
	memberCount?: number;
	/** The user has joined it: it is in the joined set on this connection. */
	joined: boolean;
}

/** The room a client posts to without naming one: the server's default room (§3.5), before its `room_id` is known. */
export const DEFAULT_ROOM_ID = '';

/** A file this client is writing to an embed's `write_url` (§4.8.3). */
export interface UploadState {
	name: string;
	/** An image's dimensions as sent, shown while pending; the server fills in `og` once written. */
	width?: number;
	height?: number;
	/** Fraction written, 0–1, once the write started. */
	progress?: number;
	/** Why the write failed; the server then publishes the message without the embed. */
	failed?: string;
}

/** A file for an upload embed, with an image's dimensions when known. */
export interface UploadFile {
	file: File;
	width?: number;
	height?: number;
}

export interface PendingOperation {
	id: string;
	method: string;
	room?: string;
	messageId?: string;
	createdAt: number;
}

/** A typing indicator shown for another user (§4.6). */
export interface TypingSnapshot {
	room: string;
	from: Identity;
}

export type Capabilities = Record<Capability, boolean>;

export interface ClientSnapshot {
	status: ConnectionStatus;
	/** True once the server has accepted this connection's auth request. */
	authenticated: boolean;
	authBusy?: boolean;
	/** Signed in to a registered account (a passkey, an email, or a kept token), not as a guest. */
	passkeySession?: boolean;
	/**
	 * How this browser signed in to that account: `token` means a kept token
	 * is its only way back in here, worth adding a passkey or email to (§3.2).
	 */
	signedInWith?: 'webauthn' | 'email' | 'token';
	/** How this browser can get back into the account: how it signed in, then what it added (§4.10, §4.11). */
	signInMethods?: Array<'webauthn' | 'email' | 'token'>;
	/**
	 * A registered session is kept for this server (a token to resume with),
	 * whether or not this connection has resumed it yet.
	 */
	keptSession?: boolean;
	/** The sign-in guard is held by a passkey ceremony (true) or an email step (false). */
	passkeyBusy?: boolean;
	/**
	 * An email sign-in proposal waiting for its code (§4.11): the address,
	 * and the server whose connection proposed it and alone takes the code.
	 * Gone once used, replaced, or closed (by the server, or on expiry).
	 */
	emailCode?: { email: string; url: string };
	/**
	 * Signed in as a guest on a server whose guests only read (the demo
	 * worker's `ext.demo.guest_posting: false`): posting, reacting, and room
	 * changes are denied until the user signs in.
	 */
	readOnly?: boolean;
	/**
	 * Your notifications are paused (§4.5 `mute` without `room_id`, from the
	 * server's `status`) until then, in epoch milliseconds, or `true` until
	 * resumed. Absent when not.
	 */
	mutedUntil?: number | true;
	/** The server refused this device's `push_register` (§4.9): its message, until one succeeds. */
	pushError?: string;
	/** This connection's rooms are listed: joined ones (capability `rooms`), else the default room. */
	roomsListed?: boolean;
	error?: string;
	server?: ServerParams;
	/** Which optional features the current `server` frame advertises (§4). */
	capabilities: Capabilities;
	you?: Identity;
	/**
	 * Visible rooms in the order they were listed, joined, or opened (a
	 * `room_list` lists the most recently active first).
	 */
	rooms: RoomSnapshot[];
	activeRoom?: string;
	pending: PendingOperation[];
	typing: TypingSnapshot[];
	/**
	 * One kept user object per `user_id` (§3.3), merged field by field from
	 * every current object: `you`, `new` in `user`, and room `members` and
	 * `users`. Recorded objects (`from`, a membership's `user`) never merge
	 * into it. Render a user with `userIn`, which follows renames and falls
	 * back field by field to the recorded object the frame carries.
	 */
	users: Record<string, Identity>;
	/**
	 * The latest recorded object seen per `user_id` (a message's or
	 * reaction's `from`, a membership's `user`), by `log_id`. Never merged into
	 * `users`: a fallback where no frame carries one, such as a mention in
	 * text, and what tells apart users who share a display name.
	 */
	recordedUsers: Record<string, Identity>;
	/** Retired `user_id`s mapped to the identity that replaced them (a `user` notification with `old`). */
	userAliases: Record<string, string>;
	/** Files being written to upload embeds, by `embed_id`. */
	uploads: Record<string, UploadState>;
	/**
	 * The server refused a file that isn't an image as the wrong type (415):
	 * it takes images only, so voice clips have nowhere to go.
	 */
	imageOnlyUploads?: boolean;
	/**
	 * The server answered adding or removing another member (`room_join` or
	 * `room_leave` with `user_id`) `unsupported` (§4.3.2): don't offer it.
	 */
	memberChangesUnsupported?: boolean;
	/** Top-level rooms from the latest `room_list`, joined or not; undefined until listed. */
	directory?: RoomListing[];
	/** Threads per parent room from the latest `room_list` with `parent_room_id`. */
	threadDirectory: Record<string, RoomListing[]>;
	showReconnectDivider: boolean;
	/** Server supplied retry delay for the most recent temporary limit. */
	retryAfterMs?: number;
	/** The server denied the connection (§1.1): no reconnect until the user acts (`retryNow`). */
	held?: boolean;
	/**
	 * Held because the session comes back only by signing in again, and the
	 * way to: a passkey, an emailed code, or a new token, from the sign-in
	 * screen. Nothing prompts on its own meanwhile.
	 */
	signInNeeded?: 'webauthn' | 'email' | 'token';
	/**
	 * When the transport dropped (or failed to open) while the client kept
	 * running; cleared once a connection authenticates again. The protocol
	 * state is rebuilt from the new connection, so a UI that wants to stay put
	 * holds its own copy of the last authenticated snapshot meanwhile.
	 */
	disconnectedAt?: number;
}

/**
 * The params of `push_register` (§4.9): `kind` is a key of `server.push`,
 * `url` identifies the registration, `push_id` names it in payloads, and the
 * rest is specific to the kind, such as a web push subscription's `keys`.
 */
export interface PushRegistration extends JsonObject {
	kind: string;
	url: string;
}

export interface OperationHandle<T extends JsonObject = JsonObject> {
	id: string;
	promise: Promise<T>;
}

export interface MessageResult extends JsonObject {
	message_id: string;
}

export interface RoomResult extends JsonObject {
	room_id: string;
}

export interface SendOptions {
	/** The message replied to; it may be in any room. */
	replyTo?: string;
	embeds?: Embed[];
	/** The `user_id`s the message mentions (§3.5), sent as `body.mentions`. */
	mentions?: string[];
	ext?: JsonObject;
}

/**
 * Changes to a saved message. Absent keys keep the latest snapshot's value;
 * `null` removes `reply_to`. Saves resubmit every client field (§4.4) except
 * `ext`, which the server merges (§3.5).
 */
export interface MessagePatch {
	room_id?: string;
	body?: MessageBody;
	reply_to?: string | null;
	/**
	 * `ext` keys to change: each replaces its value, a key with an empty value
	 * (`""`, `[]`, `{}`) is removed, and keys left out stay (§3.5).
	 */
	ext?: JsonObject;
	deleted?: true;
}

export interface CreateRoomOptions {
	/** Creates a thread under this room. */
	parentRoomId?: string;
	/** Visible only to its members (§4.3.4); fixed at creation. */
	private?: boolean;
	title?: string;
	/** What the room is about, CommonMark by convention (§3.4). */
	description?: string;
	ext?: JsonObject;
}

/**
 * Changes to a room's client fields. Absent keys keep the latest record's
 * value; `null` clears `title` or `description`. `parent_room_id` and
 * `private` are fixed at creation.
 */
export interface RoomPatch {
	title?: string | null;
	description?: string | null;
	/**
	 * `ext` keys to change: each replaces its value, a key with an empty value
	 * (`""`, `[]`, `{}`) is removed, and keys left out stay (§3.5).
	 */
	ext?: JsonObject;
}

export type WebSocketFactory = (url: string) => WebSocket;

export interface ChatClientOptions {
	serverUrl: string;
	displayName?: string;
	webSocketFactory?: WebSocketFactory;
	onChange?: (snapshot: ClientSnapshot) => void;
	/** The clock that times disconnections (epoch milliseconds); `Date.now` by default. */
	now?: () => number;
}
