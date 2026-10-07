import { canEdit, canManageRooms, canReact, capabilitiesOf, type ChatClient, type ClientSnapshot, type RoomSnapshot } from '$lib/protocol/client';
import type { Identity, ServerParams } from '$lib/protocol/types';
import { connectionStateOf, isSessionReady, reconnectErrorOf } from './connection';

/** The last authenticated view, held while a reconnect rebuilds it, and kept on the device for the next visit (`session-cache.ts`). */
export type HeldSession = { rooms: RoomSnapshot[]; activeRoom?: string; you?: Identity; server?: ServerParams; threadDirectory?: ClientSnapshot['threadDirectory'] };

/** How long a reconnect may run quietly before the UI escalates and offers a manual retry. */
const RECONNECT_STALL_MS = 10_000;

export const blankSnapshot = (): ClientSnapshot => ({
	status: 'idle', authenticated: false, capabilities: capabilitiesOf(undefined), rooms: [], pending: [], typing: [], users: {}, recordedUsers: {}, userAliases: {}, uploads: {}, threadDirectory: {}, showReconnectDivider: false
});

/**
 * The page's view of the protocol client. The client rebuilds its rooms and
 * identity from each new connection, so while a reconnect is in flight (and
 * until the fresh rooms have arrived) this keeps showing the last authenticated
 * view instead of collapsing to an empty shell, and re-selects the room the
 * viewer was in once the reconnected server lists it again.
 */
export class SessionView {
	// Snapshots are immutable values from the client: raw state avoids proxying them and keeps identity comparisons honest.
	snapshot = $state.raw<ClientSnapshot>(blankSnapshot());
	/** True once a dropped connection has stayed down for RECONNECT_STALL_MS. */
	stalled = $state(false);
	private held = $state.raw<HeldSession | undefined>();
	/** The held view came from this device (`prime`), not from this page's own session: it isn't worth keeping again. */
	private primed = $state(false);
	/** The open room whose threads aren't listed yet on this connection: its held copy stays up until they are. */
	private awaitingThreads = $state<string | undefined>();
	private pendingActiveRoom: string | undefined;
	private stallTimer: ReturnType<typeof setTimeout> | undefined;

	readonly ready = $derived(isSessionReady(this.snapshot));
	readonly connection = $derived(connectionStateOf(this.snapshot));
	readonly reconnectError = $derived(reconnectErrorOf(this.snapshot));
	/** A reconnect that has stalled past the quiet window, or one the server refused. */
	readonly reconnectNeedsAttention = $derived(this.connection === 'reconnecting' && (this.stalled || Boolean(this.reconnectError)));
	/**
	 * The session is still coming up: its rooms aren't listed yet, and nothing has gone wrong (offline, a refused
	 * sign-in, a stalled reconnect). The page shows placeholders then, not "Not signed in" or "No rooms yet".
	 */
	readonly starting = $derived(!this.snapshot.roomsListed && this.snapshot.status !== 'offline' && !this.snapshot.signInNeeded && !this.reconnectNeedsAttention && !this.reconnectError);
	private readonly holding = $derived(Boolean(this.held) && (!this.ready || this.snapshot.rooms.length === 0) && this.snapshot.status !== 'offline');
	readonly rooms = $derived(this.snapshot.rooms.length ? this.snapshot.rooms : this.holding ? this.held!.rooms : []);
	readonly activeRoomId = $derived(this.snapshot.rooms.length ? this.snapshot.activeRoom : this.holding ? this.held!.activeRoom : undefined);
	readonly you = $derived(this.snapshot.you ?? (this.holding ? this.held!.you : undefined));
	readonly server = $derived(this.snapshot.server ?? (this.holding ? this.held!.server : undefined));
	/** The whole view is the held one: the rooms aren't listed again yet. */
	readonly showingHeld = $derived(this.holding && this.snapshot.rooms.length === 0);
	/**
	 * A freshly listed room starts empty while history recovers; its held copy
	 * stays on screen until the recovered timeline replaces it.
	 */
	private readonly standIn = $derived.by(() => {
		const live = this.rooms.find((room) => room.id === this.activeRoomId);
		const held = this.held;
		const copy = held?.rooms.find((room) => room.id === live?.id);
		if (!live || !copy || live === copy) return undefined;
		return (live.recovering && live.timeline.order.length === 0) || this.awaitingThreads === live.id ? copy : undefined;
	});
	readonly activeRoom = $derived(this.standIn ?? this.rooms.find((room) => room.id === this.activeRoomId));
	/** The open room on screen is a copy held from before, while the live one catches up: a reconnect, or a reload. */
	readonly activeRoomHeld = $derived(Boolean(this.standIn) || (this.showingHeld && this.activeRoomId !== undefined));
	/**
	 * Where the open room's thread cards come from: the held view while its copy is on screen, so its messages
	 * and their cards change over together, else the live rooms and the room's thread listing.
	 */
	threadSource(roomId: string | undefined): { rooms: RoomSnapshot[]; directory: ClientSnapshot['threadDirectory'][string] | undefined } {
		if (roomId !== undefined && this.activeRoomHeld && this.held) return { rooms: this.held.rooms, directory: this.held.threadDirectory?.[roomId] };
		return { rooms: this.rooms, directory: roomId !== undefined ? this.snapshot.threadDirectory[roomId] : undefined };
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
		this.held = { rooms: next.rooms, activeRoom: next.activeRoom, you: next.you, server: next.server, threadDirectory: next.threadDirectory };
		this.primed = false;
	}

	/** Edit, move, and delete (capability `edit`). */
	readonly canEdit = $derived(canEdit(this.server));
	/** Create and update rooms and threads (capability `rooms`). */
	readonly canManageRooms = $derived(canManageRooms(this.server));
	/** A guest on a server whose guests only read: no composer, reactions, or new threads until sign-in. */
	readonly readOnly = $derived(Boolean(this.snapshot.readOnly));
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
		// A view held for someone else (kept on this device for the account that was signed in) isn't this one's.
		if (this.held?.you && next.you && this.held.you.user_id !== next.you.user_id) this.forget();
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
		this.trackStall(next);
	}

	/** Selects a room, remembering it for the reconnect if the server is currently away. */
	chooseRoom(client: ChatClient, roomId: string): void {
		client.selectRoom(roomId);
		if (this.holding && this.held) this.held = { ...this.held, activeRoom: roomId };
		this.pendingActiveRoom = this.holding ? roomId : undefined;
	}

	/** Drops the held view: the next connection is a different session (a new server, or a sign-out). */
	forget(): void {
		this.held = undefined;
		this.primed = false;
		this.pendingActiveRoom = undefined;
	}

	retryNow(client: ChatClient): void {
		this.stalled = false;
		client.retryNow();
	}

	dispose(): void {
		if (this.stallTimer) clearTimeout(this.stallTimer);
	}

	private trackStall(next: ClientSnapshot): void {
		if (this.stallTimer) clearTimeout(this.stallTimer);
		this.stallTimer = undefined;
		const since = next.disconnectedAt;
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
