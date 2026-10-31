import { canEdit, canManageRooms, canReact, capabilitiesOf, type ChatClient, type ClientSnapshot, type RoomSnapshot } from '$lib/protocol/client';
import type { ConnectionStatus } from '$lib/protocol/client-types';
import type { Identity, ServerParams } from '$lib/protocol/types';
import { connectionStateOf, isSessionReady, reconnectErrorOf } from './connection';

/** The last authenticated view, held while a reconnect rebuilds it, and kept on the device for the next visit (`session-cache.ts`). */
export type HeldSession = { rooms: RoomSnapshot[]; activeRoom?: string; you?: Identity; server?: ServerParams; threadDirectory?: ClientSnapshot['threadDirectory'] };

/** How long a reconnect may run quietly before the UI escalates and offers a manual retry. */
const RECONNECT_STALL_MS = 10_000;
/**
 * How long the way back from a dropped connection shows nothing at all: no "Reconnecting…" or "Checking for new
 * messages…" pill, no loading marks on the rooms. A reconnect that's done by then (most are) goes unseen.
 */
export const RECONNECT_QUIET_MS = 1_500;

/** A live room with nothing to show yet: recovering, or not loaded on this connection. Not once loading failed. */
const showsNothingYet = (live: RoomSnapshot): boolean => live.timeline.order.length === 0 && !live.recoveryError && (!live.loaded || live.recovering);

export const blankSnapshot = (): ClientSnapshot => ({
	status: 'idle', authenticated: false, capabilities: capabilitiesOf(undefined), rooms: [], pending: [], typing: [], users: {}, recordedUsers: {}, userAliases: {}, uploads: {}, threadDirectory: {}, showReconnectDivider: false
});

/** The same values in the same order, item by item: the same list, though the client made it afresh. */
const sameItems = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean => a === b || Boolean(a && b && a.length === b.length && a.every((item, index) => item === b[index]));

/**
 * The parts of the client's snapshot that the session's own views read, each as state of its own. Each snapshot is a
 * new object, and setting state marks everything that reads it, and everything below that however deep, to be
 * checked again, even where nothing comes out different: holding the snapshot whole, every message marked the rooms
 * pane, the open room, the server's capabilities and each message's controls with them. A part set to what it
 * already was (the same object, or a fresh copy of equal value: the capabilities, the sign-in methods, a list of the
 * same rooms) marks nothing.
 */
class SnapshotParts {
	status = $state.raw<ConnectionStatus>('idle');
	authenticated = $state.raw(false);
	you = $state.raw<ClientSnapshot['you']>();
	error = $state.raw<string | undefined>();
	server = $state.raw<ClientSnapshot['server']>();
	capabilities = $state.raw<ClientSnapshot['capabilities']>(capabilitiesOf(undefined));
	rooms = $state.raw<RoomSnapshot[]>([]);
	/** Whether any room is listed: what the views that only ask that read, rather than the rooms, which change with each message. */
	anyRooms = $state.raw(false);
	activeRoom = $state.raw<string | undefined>();
	roomsListed = $state.raw<boolean | undefined>();
	readOnly = $state.raw<boolean | undefined>();
	passkeySession = $state.raw<boolean | undefined>();
	signedInWith = $state.raw<ClientSnapshot['signedInWith']>();
	signInMethods = $state.raw<ClientSnapshot['signInMethods']>();
	signInNeeded = $state.raw<ClientSnapshot['signInNeeded']>();
	held = $state.raw<boolean | undefined>();
	disconnectedAt = $state.raw<number | undefined>();
	retryingSince = $state.raw<number | undefined>();
	take(next: ClientSnapshot): void {
		this.status = next.status;
		this.authenticated = next.authenticated;
		this.you = next.you;
		this.error = next.error;
		this.server = next.server;
		const capabilities = this.capabilities;
		if ((Object.keys(next.capabilities) as (keyof typeof capabilities)[]).some((key) => next.capabilities[key] !== capabilities[key])) this.capabilities = next.capabilities;
		if (!sameItems(this.rooms, next.rooms)) this.rooms = next.rooms;
		this.anyRooms = next.rooms.length > 0;
		this.activeRoom = next.activeRoom;
		this.roomsListed = next.roomsListed;
		this.readOnly = next.readOnly;
		this.passkeySession = next.passkeySession;
		this.signedInWith = next.signedInWith;
		if (!sameItems(this.signInMethods, next.signInMethods)) this.signInMethods = next.signInMethods;
		this.signInNeeded = next.signInNeeded;
		this.held = next.held;
		this.disconnectedAt = next.disconnectedAt;
		this.retryingSince = next.retryingSince;
	}
}

/**
 * The page's view of the protocol client. The client rebuilds its rooms and
 * identity from each new connection, so while a reconnect is in flight (and
 * until the fresh rooms have arrived) this keeps showing the last authenticated
 * view instead of collapsing to an empty shell, and re-selects the room the
 * viewer was in once the reconnected server lists it again.
 */
export class SessionView {
	// Snapshots are immutable values from the client: raw state avoids proxying them and keeps identity comparisons honest.
	// Each is new, so whatever reads it is checked again with every one: the views here read its parts (`live`) instead.
	snapshot = $state.raw<ClientSnapshot>(blankSnapshot());
	private live = new SnapshotParts();
	/** True once a dropped connection has stayed down for RECONNECT_STALL_MS while someone could see it. */
	stalled = $state(false);
	/**
	 * The first RECONNECT_QUIET_MS of a reconnect's way back, from when it began trying where someone could see it
	 * (`retryingSince`): reconnecting, then catching up, show nothing yet.
	 */
	reconnectQuiet = $state(false);
	private held = $state.raw<HeldSession | undefined>();
	/** The held view came from this device (`prime`), not from this page's own session: it isn't worth keeping again. */
	private primed = $state(false);
	/** The open room whose threads aren't listed yet on this connection: its held copy stays up until they are. */
	private awaitingThreads = $state<string | undefined>();
	private pendingActiveRoom: string | undefined;
	private stallTimer: ReturnType<typeof setTimeout> | undefined;
	private quietTimer: ReturnType<typeof setTimeout> | undefined;
	private quietSince: number | undefined;
	/** Try Again was pressed: the attempt it starts shows at once, with no quiet moment first. */
	private retryAsked = false;
	/** The last ready snapshot of this session: what a quiet reconnect keeps showing of how you're signed in. */
	private lastReady = $state.raw<ClientSnapshot | undefined>();

	readonly ready = $derived(isSessionReady(this.live));
	readonly connection = $derived(connectionStateOf(this.live));
	readonly reconnectError = $derived(reconnectErrorOf(this.live));
	/** A reconnect that has stalled past the quiet window, or one the server refused. */
	readonly reconnectNeedsAttention = $derived(this.connection === 'reconnecting' && (this.stalled || Boolean(this.reconnectError)));
	/**
	 * The session is still coming up: its rooms aren't listed yet, and nothing has gone wrong (offline, a refused
	 * sign-in, a stalled reconnect). The page shows placeholders then, not "Not signed in" or "No rooms yet".
	 */
	readonly starting = $derived(!this.live.roomsListed && this.live.status !== 'offline' && !this.live.signInNeeded && !this.reconnectNeedsAttention && !this.reconnectError);
	// `held` is read last: hold() replaces it with each snapshot, and a ready session with its rooms listed, which
	// doesn't depend on it then, isn't marked to be checked again (with everything that reads the rooms) each time.
	private readonly holding = $derived((!this.ready || !this.live.anyRooms) && this.live.status !== 'offline' && Boolean(this.held));
	readonly rooms = $derived(this.live.anyRooms ? this.live.rooms : this.holding ? this.held!.rooms : []);
	readonly activeRoomId = $derived(this.live.anyRooms ? this.live.activeRoom : this.holding ? this.held!.activeRoom : undefined);
	readonly you = $derived(this.live.you ?? (this.holding ? this.held!.you : undefined));
	readonly server = $derived(this.live.server ?? (this.holding ? this.held!.server : undefined));
	/** The whole view is the held one: the rooms aren't listed again yet. */
	readonly showingHeld = $derived(this.holding && !this.live.anyRooms);
	/**
	 * Disconnected while the page is hidden: the client waits for it to be shown before connecting again, and nobody
	 * is watching, so nothing says a reconnect is under way.
	 */
	readonly waitingToReconnect = $derived(this.live.disconnectedAt !== undefined && this.live.retryingSince === undefined);
	/** A reconnect from a ready session that needs nobody yet: the page keeps everything as it was meanwhile. */
	readonly reconnectingQuietly = $derived(this.connection === 'reconnecting' && !this.reconnectNeedsAttention && !this.live.held && this.lastReady !== undefined);
	/**
	 * Ready, or reconnecting quietly: controls that come and go with the session (a room's +, the member list's
	 * sections, the composer's field) stay as they were, rather than blinking out and back with a short drop.
	 * Anything they ask for waits for the connection, as requests do (`ready` says whether it is there now).
	 */
	readonly steady = $derived(this.ready || this.reconnectingQuietly);
	/** The server's capabilities, kept from before through a reconnect until the new connection says otherwise. */
	readonly capabilities = $derived(this.live.server || !this.holding ? this.live.capabilities : capabilitiesOf(this.server));
	/** Signed in to an account (passkey, email, token), kept through a quiet reconnect. */
	readonly passkeySession = $derived(this.live.passkeySession || (this.reconnectingQuietly && Boolean(this.lastReady?.passkeySession)));
	/** How this account signs in, as `ClientSnapshot.signInMethods`, kept through a quiet reconnect. */
	readonly signInMethods = $derived(this.live.signInMethods ?? (this.reconnectingQuietly ? this.lastReady?.signInMethods : undefined));
	/** How this session signed in, as `ClientSnapshot.signedInWith`, kept through a quiet reconnect. */
	readonly signedInWith = $derived(this.live.signedInWith ?? (this.reconnectingQuietly ? this.lastReady?.signedInWith : undefined));
	/**
	 * A freshly listed room starts empty while history recovers; its held copy
	 * stays on screen until the recovered timeline replaces it.
	 */
	private readonly standIn = $derived.by(() => {
		const live = this.rooms.find((room) => room.id === this.activeRoomId);
		// Only a room with nothing to show yet, or waiting for its threads, has a stand-in: the held view isn't read
		// otherwise, so replacing it (each snapshot) doesn't mark the open room, and all that reads it, to check again.
		if (!live || (!showsNothingYet(live) && this.awaitingThreads !== live.id)) return undefined;
		const copy = this.held?.rooms.find((room) => room.id === live.id);
		if (!copy || live === copy) return undefined;
		return this.heldCopy(live) ?? (this.awaitingThreads === live.id ? copy : undefined);
	});

	/**
	 * The copy held from before of a live room with nothing to show yet: one
	 * recovering, or a thread (or a room open without joining) not loaded on
	 * this connection. The pane shows it in the live room's place until the
	 * history arrives, as it does the open room's. Not once loading failed.
	 */
	heldCopy(live: RoomSnapshot | undefined): RoomSnapshot | undefined {
		if (!live || !showsNothingYet(live)) return undefined;
		const copy = this.held?.rooms.find((room) => room.id === live.id);
		return copy && copy !== live ? copy : undefined;
	}
	readonly activeRoom = $derived(this.standIn ?? this.rooms.find((room) => room.id === this.activeRoomId));
	/** The open room on screen is a copy held from before, while the live one catches up: a reconnect, or a reload. */
	readonly activeRoomHeld = $derived(Boolean(this.standIn) || (this.showingHeld && this.activeRoomId !== undefined));
	/**
	 * Where the open room's thread cards come from: the held view while its copy is on screen, so its messages
	 * and their cards change over together, else the live rooms and the room's thread listing.
	 */
	threadSource(roomId: string | undefined): { rooms: RoomSnapshot[]; directory: ClientSnapshot['threadDirectory'][string] | undefined } {
		if (roomId !== undefined && this.activeRoomHeld && this.held) return { rooms: this.held.rooms, directory: this.held.threadDirectory?.[roomId] };
		return { rooms: this.rooms.map((room) => this.currentCopy(room) ?? room), directory: roomId !== undefined ? this.snapshot.threadDirectory[roomId] : undefined };
	}

	/**
	 * A thread not loaded on this connection, with the messages its held copy
	 * had, while nothing has happened in it since (the same head): its card
	 * keeps its faces and newest reply instead of losing them once the live
	 * rooms take over, and is still true. Anything newer, and it shows as the
	 * live one does until it is opened.
	 */
	private currentCopy(live: RoomSnapshot): RoomSnapshot | undefined {
		if (live.parentRoomId === undefined || live.loaded || live.latestLogId === undefined) return undefined;
		const copy = this.heldCopy(live);
		return copy && copy.latestLogId === live.latestLogId ? { ...live, timeline: copy.timeline } : undefined;
	}

	/** The open room's threads aren't listed yet on this connection (or are, with undefined). */
	awaitThreads(roomId: string | undefined): void {
		if (this.awaitingThreads === roomId) return;
		this.awaitingThreads = roomId;
		if (roomId === undefined) this.hold(this.snapshot);
	}

	/**
	 * Holds `next` as the view to show through the next reconnect (and to keep on the device): a ready session
	 * whose rooms all have something to show. Not while the open room waits for its threads: its held copy is
	 * still on screen, and replacing it would show the room's messages without their cards.
	 */
	private hold(next: ClientSnapshot): void {
		if (!isSessionReady(next) || next.disconnectedAt !== undefined || next.rooms.length === 0 || this.awaitingThreads !== undefined) return;
		if (next.rooms.some((room) => room.recovering && room.timeline.order.length === 0)) return;
		// Threads (and rooms open without joining) load only when opened: until one is, its held copy stays, to
		// stand in when it opens, and to keep on the device, rather than an empty room in its place.
		const rooms = next.rooms.map((room) => {
			const copy = this.heldCopy(room);
			return copy?.timeline.order.length ? copy : room;
		});
		this.held = { rooms, activeRoom: next.activeRoom, you: next.you, server: next.server, threadDirectory: next.threadDirectory };
		this.primed = false;
	}

	/** Edit, move, and delete (capability `edit`). */
	readonly canEdit = $derived(canEdit(this.server));
	/** Create and update rooms and threads (capability `rooms`). */
	readonly canManageRooms = $derived(canManageRooms(this.server));
	/** You only read (`ext:permissions` with `write: false`): no composer, reactions, joins, or new threads. */
	readonly readOnly = $derived(Boolean(this.live.readOnly) || (this.reconnectingQuietly && Boolean(this.lastReady?.readOnly)));
	/** Reaction chips and the React action (capability `reactions`). */
	readonly canReact = $derived(canReact(this.server));

	/**
	 * The held view to keep on this device for the next visit: one this page's session made, not one it was
	 * primed with.
	 */
	readonly keepable = $derived(this.primed ? undefined : this.held);

	/**
	 * Shows a view kept on this device (`session-cache.ts`) while the session comes up, as a reconnect shows the
	 * one it held: the rooms and messages from before, then each live room in its place once it has recovered.
	 * Its open room opens again when the server lists it. Too late once the session is ready.
	 */
	prime(view: HeldSession): void {
		if (isSessionReady(this.snapshot) || this.held) return;
		this.held = view;
		this.primed = true;
		this.pendingActiveRoom = view.activeRoom;
	}

	/** Takes the client's next snapshot and keeps the held view in step with it. */
	apply(next: ClientSnapshot, client: ChatClient): void {
		const wasReady = isSessionReady(this.snapshot) && this.snapshot.rooms.length > 0;
		this.snapshot = next;
		this.live.take(next);
		// A view held for someone else (kept on this device for the account that was signed in) isn't this one's.
		if (this.held?.you && next.you && this.held.you.user_id !== next.you.user_id) this.forget();
		// Kept only through a drop (`disconnectedAt`): a restart, a sign-out or a sign-in elsewhere starts over.
		if (isSessionReady(next)) this.lastReady = next;
		else if (next.disconnectedAt === undefined || next.status === 'offline' || next.held || (this.lastReady?.you && next.you && this.lastReady.you.user_id !== next.you.user_id)) this.lastReady = undefined;
		if (next.status === 'offline' || (wasReady && isSessionReady(next) && next.rooms.length === 0)) {
			// Offline, or a ready session that left its last room: nothing is being rebuilt.
			this.held = undefined;
		} else {
			this.hold(next);
		}
		if (next.disconnectedAt !== undefined && this.held) this.pendingActiveRoom = this.held.activeRoom;
		const target = this.pendingActiveRoom;
		if (target && isSessionReady(next) && next.rooms.some((room) => room.id === target)) {
			this.pendingActiveRoom = undefined;
			if (next.activeRoom !== target) client.selectRoom(target);
		}
		// Until then, the room on screen catches up first: its history goes before the other rooms'.
		client.awaitRoom(this.pendingActiveRoom);
		this.trackStall(next);
		this.trackQuiet(next);
	}

	/** Selects a room, remembering it for the reconnect if the server is currently away. */
	chooseRoom(client: ChatClient, roomId: string): void {
		client.selectRoom(roomId);
		if (this.holding && this.held) this.held = { ...this.held, activeRoom: roomId };
		this.pendingActiveRoom = this.holding ? roomId : undefined;
		client.awaitRoom(this.pendingActiveRoom);
	}

	/** Drops the held view: the next connection is a different session (a new server, or a sign-out). */
	forget(): void {
		this.held = undefined;
		this.lastReady = undefined;
		this.primed = false;
		this.pendingActiveRoom = undefined;
	}

	retryNow(client: ChatClient): void {
		this.stalled = false;
		this.retryAsked = true;
		client.retryNow();
		// The client answers at once; one that started nothing (a `retry_after` still running) leaves no flag behind.
		this.retryAsked = false;
	}

	dispose(): void {
		if (this.stallTimer) clearTimeout(this.stallTimer);
		if (this.quietTimer) clearTimeout(this.quietTimer);
	}

	/** A new run of reconnecting where someone can see it starts RECONNECT_QUIET_MS of quiet; it runs out on its own. */
	private trackQuiet(next: ClientSnapshot): void {
		const since = next.retryingSince;
		// A run that ended (back, or waiting hidden) is done with: the next starts its own quiet, even at the same time.
		if (since === undefined) {
			this.quietSince = undefined;
			return;
		}
		if (since === this.quietSince) return;
		this.quietSince = since;
		if (this.quietTimer) clearTimeout(this.quietTimer);
		const remaining = this.retryAsked ? 0 : RECONNECT_QUIET_MS - (Date.now() - since);
		this.reconnectQuiet = remaining > 0;
		this.quietTimer = remaining > 0 ? setTimeout(() => {
			this.quietTimer = undefined;
			this.reconnectQuiet = false;
		}, remaining) : undefined;
	}

	private trackStall(next: ClientSnapshot): void {
		if (this.stallTimer) clearTimeout(this.stallTimer);
		this.stallTimer = undefined;
		// Counted from when the reconnect began trying where someone could see it: not the time a hidden tab waited.
		const since = next.retryingSince;
		if (since === undefined || isSessionReady(next)) {
			this.stalled = false;
			return;
		}
		const remaining = RECONNECT_STALL_MS - (Date.now() - since);
		if (remaining <= 0) {
			this.stalled = true;
			return;
		}
		this.stallTimer = setTimeout(() => (this.stalled = true), remaining);
	}
}
