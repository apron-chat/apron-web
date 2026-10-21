import type { RoomSnapshot } from '$lib/protocol/client';
import { compareLogIds, type TimelineState } from '$lib/protocol/reducer';
import type { Identity } from '$lib/protocol/types';
import { isOwn } from './messages';
import { advanceReadPositions, loadReadPositions, readPositionKey } from './storage';

/**
 * How far you have read each room and thread (threads are rooms of their
 * own), kept on this device under `apron.readPositions` so the next visit
 * knows too: where the New divider goes, and so where the pane opens. A
 * position is the furthest of what you read here (the latest message in
 * view), your read cursor as the server reported it (§4.6), and your own
 * newest message: one sent from another device says you had read the room
 * up to it. It only moves forward. Kept per account (`notifyAccount`), a
 * server's guests sharing one; nothing here is sent to the server.
 */
export class ReadPositions {
	/** By `readPositionKey`; loaded from storage on first use. */
	private kept: Map<string, string> | undefined;
	/** The account, timeline and cursor each room was last observed with: an unchanged room isn't looked over again. */
	private readonly observed = new Map<string, { account: string; timeline: TimelineState; cursor?: string }>();

	/** `account` is whose positions these are, as the page knows it now (`notifyAccount`). */
	constructor(private readonly account: () => string) {}

	/**
	 * Where you have read `room` through, or undefined when nothing is known.
	 * `fresh` reads what is kept again first, for what another tab read since.
	 */
	through(room: RoomSnapshot, me: Identity | undefined, fresh = false): string | undefined {
		if (fresh) this.kept = undefined;
		const read = furthest(this.positions().get(readPositionKey(this.account(), room.id)), room.readMessageId);
		return furthest(read, newestOwn(room.timeline, me, read));
	}

	/** You read `roomId` through `messageId` here. */
	read(roomId: string, messageId: string): void {
		this.advance({ [readPositionKey(this.account(), roomId)]: messageId });
	}

	/** Runs over every room after each snapshot: keeps each room's server cursor and your newest message as read. */
	observe(rooms: readonly RoomSnapshot[], me: Identity | undefined): void {
		if (!me) return;
		const account = this.account();
		const moved: Record<string, string> = {};
		for (const room of rooms) {
			const last = this.observed.get(room.id);
			if (last?.account === account && last.timeline === room.timeline && last.cursor === room.readMessageId) continue;
			this.observed.set(room.id, { account, timeline: room.timeline, ...(room.readMessageId !== undefined ? { cursor: room.readMessageId } : {}) });
			const key = readPositionKey(account, room.id);
			const through = this.through(room, me);
			const kept = this.positions().get(key);
			if (through !== undefined && (kept === undefined || compareLogIds(through, kept) > 0)) moved[key] = through;
		}
		this.advance(moved);
	}

	private positions(): Map<string, string> {
		this.kept ??= new Map(Object.entries(loadReadPositions()));
		return this.kept;
	}

	private advance(positions: Record<string, string>): void {
		const kept = this.positions();
		positions = Object.fromEntries(Object.entries(positions).filter(([key, id]) => !kept.has(key) || compareLogIds(id, kept.get(key)!) > 0));
		if (!Object.keys(positions).length) return;
		// Kept here too, as storage may be off (private mode, a full quota, `/__preview`); and what another tab read since.
		for (const [key, id] of [...Object.entries(positions), ...Object.entries(advanceReadPositions(positions))]) {
			const current = kept.get(key);
			if (current === undefined || compareLogIds(id, current) > 0) kept.set(key, id);
		}
	}
}

/** Your newest message in a timeline after `after`, if any. */
export function newestOwn(timeline: TimelineState, me: Identity | undefined, after?: string): string | undefined {
	if (!me) return undefined;
	for (let index = timeline.order.length - 1; index >= 0; index--) {
		const id = timeline.order[index];
		if (after !== undefined && compareLogIds(id, after) <= 0) return undefined;
		const event = timeline.events[id];
		if (event && isOwn(event, me)) return id;
	}
	return undefined;
}

function furthest(a: string | undefined, b: string | undefined): string | undefined {
	if (a === undefined) return b;
	if (b === undefined) return a;
	return compareLogIds(a, b) >= 0 ? a : b;
}
