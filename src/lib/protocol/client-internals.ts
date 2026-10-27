/** `ChatClient` internals: per-room state, tuning constants, and pure helpers. */
import { roomName, titled, UNTITLED } from '../naming';
import { punctuated, retryAfterLabel } from '../words';
import { compareLogIds, createTimeline, type TimelineState } from './reducer';
import {
	isJsonObject,
	isLogId,
	cloneJson,
	type JsonValue,
	type JsonObject,
	type Identity,
	type MessageRecord,
	type RoomRecord,
	type ReactionSet,
	type RpcError
} from './types';
import { DEFAULT_ROOM_ID, type LimitScope, type Notice, type OperationHandle } from './client-types';

/**
 * How a room is in the client's rooms: `joined` (visible and live; without capability
 * `rooms`, any room messages arrive in), `viewed` (opened without joining,
 * loaded through history only), or `pending` (kept from the last connection
 * and resuming its recovery while the new connection's `room_list` decides
 * whether it is still joined; not visible).
 */
export type RoomKind = 'joined' | 'viewed' | 'pending';

export interface RoomState {
	id: string;
	kind: RoomKind;
	/** Known head: greatest `latest_log_id` or live record `log_id` for this room. */
	latestLogId?: string;
	historyLogId?: string | null;
	/** Effective lower bound F, monotonic; undefined until a bound is seen. */
	floor?: string;
	/** Checkpoint C of automatic recovery. */
	checkpoint?: string;
	recovery?: RecoveryState;
	recoveryGeneration: number;
	recoveryError?: string;
	/** The recovery was refused for the history wait (`retry_after`): it starts again once that is over. */
	limited?: boolean;
	/** Settled when the running (or next) automatic recovery completes or fails. */
	waiters: Array<{ resolve: () => void; reject: (error: Error) => void }>;
	/** Thread checkpoint T of `loadRoom`. */
	loadCheckpoint?: string;
	/**
	 * Kept from an earlier connection: a thread's records after T are not
	 * loaded yet, so it reports unloaded until the next `loadRoom` catches up.
	 */
	resumed?: boolean;
	/**
	 * A thread loaded newest-first: the `first_log_id` of its oldest loaded
	 * page, below which `loadOlder` pages backward while `hasOlder`.
	 */
	olderBefore?: string;
	hasOlder?: boolean;
	loadingOlder?: boolean;
	loadGeneration: number;
	loading: boolean;
	/** The published timeline; rebuilt from the store when dirty and not recovering. */
	timeline: TimelineState;
	dirty: boolean;
	/** The connection on which a room without a record last recovered from a message's position. */
	recoveredOn?: number;
}

export function newRoomState(id: string, kind: RoomKind = 'joined'): RoomState {
	return { id, kind, recoveryGeneration: 0, waiters: [], loadGeneration: 0, loading: false, timeline: createTimeline(id), dirty: true };
}

/** `embedded` marks a `reply_to` snapshot, which installs regardless of its room's bound. */
export type LiveRecord = { kind: 'message'; record: MessageRecord; embedded?: boolean } | { kind: 'reaction'; record: ReactionSet };

/**
 * How a kept session signed in (see `ChatClient.signedInWith`), or what was
 * added to it. `link` is an email or an external sign-in, by a link of no
 * proposal this browser made, on a server that offers both: either scheme
 * approves it (§4.11.3), so which one it was isn't known.
 */
export type SignInMethod = 'webauthn' | 'email' | 'external' | 'link' | 'token';

export interface PendingSave {
	requestId: string;
	/** The submitted client fields (params without `message_id`/`room_id` key for rooms). */
	state: JsonObject;
	/** The stored record's `log_id` when the save was submitted. */
	baseLog?: string;
	/** The result arrived but no matching record yet: the next newer record settles it. */
	confirmed: boolean;
}

interface RecoveryState {
	/**
	 * Fixed H for the whole recovery. A recovery sent right behind `auth`,
	 * before any room record is known, starts without it and takes it from its
	 * first page's `latest_log_id` (§4.3.5 recovery, step 2).
	 */
	head?: string;
	/** Next position to request; undefined means from the start of the log. */
	nextAfter?: string;
	/**
	 * Without a checkpoint: only the newest page up to H, older pages
	 * loading on demand (§4.3.5 step 3), instead of paging forward.
	 */
	newest?: boolean;
	/** A rebuild whose first page isn't in yet: the room still has what it is to replace (`clearForRebuild`). */
	rebuild?: boolean;
	/**
	 * Live records for the room received during the recovery. They are applied
	 * to the store on arrival; the buffer bounds memory and lets a rebuild
	 * restore the ones at or above the new bound.
	 */
	buffer: LiveRecord[];
	bufferBytes: number;
	requestId?: string;
	generation: number;
}

export interface PendingRequest<T extends JsonObject = JsonObject> {
	id: string;
	method: string;
	params: JsonObject;
	visible: boolean;
	allowBeforeAuth: boolean;
	createdAt: number;
	sentConnection?: number;
	timer: ReturnType<typeof setTimeout>;
	resolve: (result: T) => void;
	reject: (error: Error) => void;
}

export interface TypingState {
	room: string;
	from: Identity;
	timer: ReturnType<typeof setTimeout>;
}

export type ValidHistoryResponse = JsonObject & {
	more: boolean;
	latest_log_id: string;
	history_log_id: string | null;
};

/** A valid `mute` (§4.5): `true` until changed, `false` for none, or seconds (`0` is `false`). */
export function isMuteValue(value: unknown): value is number | boolean {
	return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

/** A push registration's key (§4.9): it belongs to its user and `url`. */
export function pushKey(url: string, user: string): string {
	return JSON.stringify([user, url]);
}

/** When a `mute` (§4.5) ends: epoch milliseconds for seconds, `true` until resumed, undefined for `false` or `0`. */
export function muteEnd(mute: number | boolean | undefined, now = Date.now()): number | true | undefined {
	if (mute === true) return true;
	return typeof mute === 'number' && mute > 0 ? now + mute * 1000 : undefined;
}

/** The first wait before an `idle` request that failed goes again; it doubles with each failure, to IDLE_RETRY_MAX_MS. */
export const IDLE_RETRY_MS = 5_000;
export const IDLE_RETRY_MAX_MS = 5 * 60_000;
/** The longest `setTimeout` delay browsers keep. */
export const MAX_TIMER_MS = 2 ** 31 - 1;
export const REQUEST_TIMEOUT_MS = 20_000;

/** A request with no answer after REQUEST_TIMEOUT_MS: the server may yet answer it, or be working on it still. */
export class RequestTimeout extends Error {
	constructor(method: string) {
		super(`${method} request timed out`);
		this.name = 'RequestTimeout';
	}
}
/** This implementation and its version, sent as `agent` with `auth` (§3.2), for the server's debugging. */
export const AGENT = 'apron-web/0.4';
/** The `unsupported` error code (§1.1): a method or an optional parameter the server does not implement. */
export const UNSUPPORTED = -32601;
const HISTORY_PAGE_SIZE = 200;
/** A thread, or a room with no checkpoint, opens on its newest page this size; older pages load as the reader scrolls back. */
export const THREAD_PAGE_SIZE = 50;
const MAX_RECONNECT_DELAY_MS = 60_000;
/** How long a typing indicator this client sends should persist without a refresh, in the `activity` frame's `typing` seconds. */
export const TYPING_TIMEOUT_S = 15;
/** The longest a received typing indicator is shown without a refresh. */
export const MAX_TYPING_S = 300;
/** How often the indicator is refreshed while typing continues: well inside the timeout, and far from one frame per keystroke. */
export const TYPING_REFRESH_MS = 12_000;
/** The liveness ping (§1), sent as these exact bytes so a server can answer without parsing. */
export const PING_FRAME = '{"method":"ping"}';
/** Pings a socket may leave unanswered for a whole interval before it is presumed dead. */
export const MAX_UNANSWERED_PINGS = 1;
/**
 * How long a ping sent when the page is shown again, or the network comes back,
 * may go unanswered before its socket is presumed dead: one whose peer vanished
 * while the tab was away (a laptop asleep, timers frozen) can look open for a
 * whole ping interval otherwise.
 */
export const PROBE_MS = 5_000;
/**
 * How long a probe waits instead while a probe replaced a socket within
 * `PROBE_PATIENT_FOR_MS`: a slow network (a laptop's Wi-Fi coming back) can
 * outlast `PROBE_MS` on a socket that was alive, and replacing healthy sockets
 * one after another would cost more than it saves.
 */
export const PROBE_PATIENT_MS = 30_000;
/** How long after a probe last replaced a socket the next waits `PROBE_PATIENT_MS`; then `PROBE_MS` again. */
export const PROBE_PATIENT_FOR_MS = 180_000;
/** How long the page must have been hidden for its return to probe the socket: a glance at another tab doesn't. */
export const PROBE_AFTER_HIDDEN_MS = 10_000;
/**
 * The first reconnect after a connection that stayed up goes within this long,
 * jittered so that clients dropped together (a server restart) don't all come
 * back at once; repeated failures back off from there.
 */
export const FIRST_RECONNECT_MS = 250;
/**
 * How long a connection must stay authenticated before the reconnect backoff
 * starts over. Resetting on auth alone let a server that closes right after
 * auth be reconnected to every half second, each time paying for a new session.
 */
export const STABLE_CONNECTION_MS = 30_000;
/** How long a `room_list` result is reused for the same parent unless the caller asks for fresher. */
export const ROOM_LIST_REUSE_MS = 10_000;
const MAX_HISTORY_BUFFER_ENTRIES = 1_000;
const MAX_HISTORY_BUFFER_BYTES = 1_048_576;
export const RETRY_AFTER_MAX_MS = 24 * 60 * 60 * 1000;
/** How long a passkey ceremony waits for in-flight requests (history, a rename) before giving up. */
export const PASSKEY_IDLE_WAIT_MS = 5_000;
export const PASSKEY_IDLE_POLL_MS = 50;
/** The lowest possible log_id: the `after` bound when no lower bound is known. */
export const FIRST_LOG_ID = '1';

export function makeRequestId(method: string): string {
	const random = globalThis.crypto?.randomUUID?.();
	return `${method}_${random ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

export function rejectedHandle<T extends JsonObject>(method: string, error: Error, id = makeRequestId(method)): OperationHandle<T> {
	const promise = Promise.reject(error);
	// Callers that only look at the handle id must not trigger an unhandled rejection.
	promise.catch(() => undefined);
	return { id, promise };
}

export function typingKey(room: string, userId: string): string {
	return JSON.stringify([room, userId]);
}

export function increment(id: string): string {
	return (BigInt(id) + 1n).toString();
}

export function decrement(id: string): string {
	return (BigInt(id) - 1n).toString();
}

export function maxDefined(a: string | undefined, b: string | undefined): string | undefined {
	if (a === undefined) return b;
	if (b === undefined) return a;
	return compareLogIds(a, b) >= 0 ? a : b;
}

/**
 * A message's client fields (§4.4), as a save would submit them. Not `ext`:
 * a save merges it (§4.12), so what the server keeps stays without sending it
 * back, and another client's change to it is never undone.
 */
export function messageClientFields(record: MessageRecord): JsonObject {
	const fields: JsonObject = { room_id: record.room_id };
	if (record.body !== undefined) fields.body = record.body;
	if (record.reply_to) fields.reply_to = { message_id: record.reply_to.message_id };
	if (record.deleted === true) fields.deleted = true;
	return fields;
}

/**
 * A room's client fields as an update would submit them (§4.2.4): all but
 * `parent_room_id` and `private`, which are fixed at creation, and `ext`,
 * which `room_set` merges (§4.12).
 */
export function roomClientFields(record: RoomRecord): JsonObject {
	const fields: JsonObject = {};
	if (record.title !== undefined) fields.title = record.title;
	if (record.description !== undefined) fields.description = record.description;
	return fields;
}

/** JSON with object keys sorted, for order-insensitive comparison (prototype-like keys included). */
export function canonicalJson(value: JsonValue): string {
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
	if (isJsonObject(value)) {
		return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

/** Shared by rooms without notices, so their snapshots compare equal. */
export const NO_NOTICES: readonly Notice[] = Object.freeze([]);

/** What a thread without a title is called: the design system's `UNTITLED`, from the one naming rule. */
export const UNTITLED_THREAD = UNTITLED;

/** A thread (a room with a `parent_room_id`, §3.4) whose record has no title: `roomTitle` calls it "Untitled". */
export function untitledThread(record: RoomRecord | undefined): boolean {
	return typeof record?.parent_room_id === 'string' && !titled(record.title);
}

/**
 * A top-level private room (§4.2.4) whose record has no title, such as one started to talk to someone: it is named
 * after its other members (`peopleTitle`), not its `room_id`, which is opaque (§2.4).
 */
export function untitledPrivate(record: RoomRecord | undefined): boolean {
	return record?.private === true && typeof record.parent_room_id !== 'string' && !titled(record.title);
}

/**
 * A room's or thread's display title by the one naming rule (`roomName`, which the design system applies to names it
 * is given): its record's `title`, else its `room_id` (§3.4), or for a thread "Untitled", whose `room_id` the design
 * system shows on hover (`untitled` on the snapshot says so). A title of only spaces counts as none. The default room,
 * before a server names it, is the "Default room".
 */
export function roomTitle(roomId: string, record: RoomRecord | undefined): string {
	const thread = typeof record?.parent_room_id === 'string';
	if (roomId === DEFAULT_ROOM_ID && !thread && !titled(record?.title)) return 'Default room';
	return roomName(record?.title, roomId, { thread });
}

/** An empty value (§3.3): `""`, `[]`, or `{}`, which clears what it replaces. */
function isEmptyValue(value: unknown): boolean {
	if (value === '') return true;
	if (Array.isArray(value)) return value.length === 0;
	return isJsonObject(value) && Object.keys(value).length === 0;
}

/**
 * A write's `ext` merged one level deep into what is stored (§4.12), as a
 * server does: each key that `incoming` carries replaces the kept value, an
 * empty value (`""`, `[]`, `{}`) removes that key, and keys it leaves out
 * stay. `"ext": {}` changes nothing. The value under a key is replaced whole;
 * `null` is an ordinary value. Returns `kept` itself when nothing changes.
 * (A client's kept user object keeps a cleared key as its empty value
 * instead: see `mergeIdentity`.)
 */
export function mergeExt(kept: JsonObject | undefined, incoming: JsonObject): JsonObject | undefined {
	let next: JsonObject | undefined;
	for (const key of Object.keys(incoming)) {
		const value = incoming[key];
		if (value === undefined) continue;
		const base = next ?? kept;
		if (isEmptyValue(value)) {
			if (!base || !Object.hasOwn(base, key)) continue;
			next ??= Object.assign(Object.create(null), kept) as JsonObject;
			delete next[key];
		} else if (!base || !Object.hasOwn(base, key) || canonicalJson(base[key]) !== canonicalJson(value)) {
			next ??= Object.assign(Object.create(null), kept) as JsonObject;
			next[key] = cloneJson(value);
		}
	}
	if (next && !Object.keys(next).length) return undefined;
	return next ?? kept;
}

/**
 * A partial current user object (a `user` notification's `you` or `new`, a
 * room's `members`) merged into the kept one (§3.3): each field it carries
 * replaces the kept value, and fields it leaves out stay. `null` is an
 * ordinary value. An empty value (`""`, `[]`, `{}`) means the field was
 * cleared, and is kept as such rather than dropped, so rendering never falls
 * back to a stale recorded object for it (see `userIn`). `ext` merges the
 * same way one level down (§4.12): each key it carries replaces the kept
 * value, a cleared one kept as its empty value, and keys it leaves out stay,
 * so `"ext": {}` changes nothing. Returns `current` itself when nothing
 * changes.
 */
export function mergeIdentity(current: Identity | undefined, incoming: Identity): Identity {
	const next: JsonObject = Object.create(null);
	if (current) Object.assign(next, current);
	next.user_id = incoming.user_id;
	let changed = !current;
	for (const key of Object.keys(incoming)) {
		if (key === 'user_id') continue;
		const value = incoming[key];
		if (value === undefined) continue;
		if (key === 'ext' && isJsonObject(value)) {
			const kept = isJsonObject(next.ext) ? next.ext : undefined;
			let ext: JsonObject | undefined;
			for (const extKey of Object.keys(value)) {
				const extValue = value[extKey];
				if (extValue === undefined) continue;
				const base = ext ?? kept;
				if (base && Object.hasOwn(base, extKey) && canonicalJson(base[extKey]) === canonicalJson(extValue)) continue;
				ext ??= Object.assign(Object.create(null), kept) as JsonObject;
				ext[extKey] = cloneJson(extValue);
			}
			if (ext) {
				next.ext = ext;
				changed = true;
			}
			continue;
		}
		if (!Object.hasOwn(next, key) || canonicalJson(next[key]) !== canonicalJson(value)) {
			next[key] = cloneJson(value);
			changed = true;
		}
	}
	return changed ? next as Identity : current!;
}

/**
 * A complete user object (`you` in an `auth` or `me` result, a listing's
 * `users`, §3.3) in place of the kept one: fields it leaves out are gone.
 * Returns `current` itself when the two are equal.
 */
export function replaceIdentity(current: Identity | undefined, incoming: Identity): Identity {
	if (current && canonicalJson(current) === canonicalJson(incoming)) return current;
	const next: JsonObject = Object.create(null);
	for (const key of Object.keys(incoming)) if (incoming[key] !== undefined) next[key] = cloneJson(incoming[key]);
	return next as Identity;
}

export function sameEmojiSet(left: readonly string[], right: readonly string[]): boolean {
	const a = new Set(left), b = new Set(right);
	return a.size === b.size && [...a].every((emoji) => b.has(emoji));
}

export function isEmbedded(live: LiveRecord): boolean {
	return live.kind === 'message' && live.embedded === true;
}

/** A forward page; without `before` (a recovery that has no head yet) it runs to the end of the log (§4.3.2). */
export function historyParams(roomId: string, after: string | undefined, before: string | undefined): JsonObject {
	return { room_id: roomId, after: after ?? FIRST_LOG_ID, ...(before !== undefined ? { before } : {}), limit: HISTORY_PAGE_SIZE };
}

/** Record arrays that a history page may omit when empty (§4.3.2). */
const HISTORY_ARRAYS = ['rooms', 'messages', 'reactions', 'memberships'];

export function validHistoryMetadata(result: JsonObject): result is ValidHistoryResponse {
	if (HISTORY_ARRAYS.some((key) => result[key] !== undefined && !Array.isArray(result[key]))) return false;
	if (typeof result.more !== 'boolean' || !isLogId(result.latest_log_id)) return false;
	if (result.history_log_id !== null && !isLogId(result.history_log_id)) return false;
	return result.history_log_id === null || compareLogIds(result.history_log_id, result.latest_log_id) <= 0;
}

export function recordBytes(record: unknown): number {
	try {
		return new TextEncoder().encode(JSON.stringify(record)).byteLength;
	} catch {
		return MAX_HISTORY_BUFFER_BYTES + 1;
	}
}

/** Pure admission check used to keep live/recovery memory bounded. */
export function recoveryBufferFits(
	entryCount: number,
	bufferBytes: number,
	record: unknown,
	maxEntries = MAX_HISTORY_BUFFER_ENTRIES,
	maxBytes = MAX_HISTORY_BUFFER_BYTES
): boolean {
	return entryCount < maxEntries && bufferBytes + recordBytes(record) <= maxBytes;
}

/** `retry_after` errors carry `data.retry_after`, a delay in seconds (§1.1). */
export function retryAfterMilliseconds(error: RpcError): number | undefined {
	if (error.code !== -32002 || !isJsonObject(error.data) || typeof error.data.retry_after !== 'number') return undefined;
	if (!Number.isFinite(error.data.retry_after) || error.data.retry_after < 0) return undefined;
	return Math.min(RETRY_AFTER_MAX_MS, Math.ceil(error.data.retry_after * 1000));
}

export function userFacingRpcError(error: RpcError): string {
	const retryAfter = retryAfterMilliseconds(error);
	if (retryAfter !== undefined) {
		return `${punctuated(error.message || 'Temporarily limited')} Try again in ${retryAfterLabel(retryAfter)}.`;
	}
	return error.message || `Request failed (${error.code})`;
}

/**
 * The requests an `ext:limits` `write` wait holds back: posting, reacting,
 * joining, leaving, and room changes. Not `command`, which may do anything,
 * nor `me`.
 */
const WRITES = new Set(['message', 'reactions', 'room_join', 'room_leave', 'room_set']);

/**
 * A `message` or `command` that adds an upload: an `upload` embed without an
 * `embed_id` is new (§4.8.2), a file to write once it is accepted (§4.8.3).
 * A save that keeps an upload sends it back with its `embed_id`.
 */
function addsUpload(method: string, params: JsonObject): boolean {
	const body = params.body;
	return (method === 'message' || method === 'command') && isJsonObject(body) && Array.isArray(body.embeds)
		&& body.embeds.some((embed) => isJsonObject(embed) && embed.kind === 'upload' && embed.embed_id === undefined);
}

/**
 * The category of limit a refusal gives in `data.ext.limits` (extension
 * `ext:limits`), if any. Read only while the server advertises the extension.
 */
export function limitCategory(error: RpcError): unknown {
	const ext = isJsonObject(error.data) ? error.data.ext : undefined;
	return isJsonObject(ext) ? ext.limits : undefined;
}

/**
 * What a request refused with `retry_after` (§1.1) holds back. With
 * `ext:limits`, a `write` category on a request it covers (`WRITES`) holds
 * back all of those, and an `upload` category on one that adds an upload
 * holds back those that do. Otherwise, as the protocol says only that
 * this request should wait: further requests of its method, when that is
 * `history` or `message`; any other method's refusal only fails its request.
 */
export function limitScope(method: string, params: JsonObject, category?: unknown): LimitScope | undefined {
	if (category === 'write' && WRITES.has(method)) return 'write';
	if (category === 'upload' && addsUpload(method, params)) return 'upload';
	return method === 'history' || method === 'message' ? method : undefined;
}

/** Whether a wait on `scope` refuses a request before it is sent. History is queued instead. */
export function limitHolds(scope: LimitScope, method: string, params: JsonObject): boolean {
	if (scope === 'write') return WRITES.has(method);
	if (scope === 'upload') return addsUpload(method, params);
	return scope === 'message' && method === 'message';
}

/** Whether the page is hidden or the browser reports no network; false outside a browser. */
export function absent(): boolean {
	return pageHidden() || globalThis.navigator?.onLine === false;
}

/** The page is hidden: nobody sees it, whatever the network. */
export function pageHidden(): boolean {
	return globalThis.document?.visibilityState === 'hidden';
}

export function reconnectDelay(attempt: number, random = 0.5, retryAfterMs?: number): number {
	const boundedAttempt = Math.max(1, Math.floor(attempt));
	if (boundedAttempt === 1) return Math.max(retryAfterMs ?? 0, Math.round(FIRST_RECONNECT_MS * Math.min(1, Math.max(0, random))));
	const base = Math.min(MAX_RECONNECT_DELAY_MS, 500 * 2 ** Math.min(7, boundedAttempt - 1));
	const jitter = 0.8 + Math.min(1, Math.max(0, random)) * 0.4;
	return Math.max(retryAfterMs ?? 0, Math.round(base * jitter));
}
