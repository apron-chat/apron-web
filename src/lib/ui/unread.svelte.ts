import type { RoomSnapshot } from '$lib/protocol/client';
import { compareLogIds, type TimelineState } from '$lib/protocol/reducer';
import type { Identity } from '$lib/protocol/types';
import { isOwn } from './messages';

/**
 * Messages from others you haven't read yet, across every room and thread:
 * what the tab title counts. As with mentions, a room's newest known log
 * position when it is first seen is its watermark: what comes after it
 * arrived while the page was open. What came before it counts too, once
 * loaded, if it is after your read position in a joined room (`unreadBefore`),
 * so a reload keeps what you hadn't read; without a read position, as on a new
 * device of a server that keeps no read cursors, it doesn't. A message stops
 * counting once you have had the end of its room on screen (in a visible tab),
 * or once your read position moves past it, from this connection or another
 * device (or your own message after it does, sent from another device). A room
 * someone added you to (`addedTo`) counts from your join instead, once its
 * membership record is loaded, so what was said there while you were away
 * counts too, and nothing before the join does.
 */
export class UnreadTracker {
	/** Unread arrivals per room (threads are rooms of their own). */
	byRoom = $state<Record<string, number>>({});
	total = $derived(Object.values(this.byRoom).reduce((sum, count) => sum + count, 0));
	private readonly shown = new Map<string, Set<string>>();
	private readonly watermarks = new Map<string, string>();
	private readonly arrivals = new Map<string, string[]>();
	/** Rooms someone added you to, whose watermark moves back to your join once its membership is loaded. */
	private readonly added = new Set<string>();
	/** The join a room someone added you to counts from: nothing at or before it is unread. */
	private readonly floors = new Map<string, string>();
	/** Each room's count at or below its watermark, and what it was counted from (`unreadBefore`). */
	private readonly before = new Map<string, { timeline: TimelineState; watermark: string; read: string; floor?: string; count: number }>();

	/** Someone added you to this room: it counts from your join, not from when this page first saw it. */
	addedTo(roomId: string): void {
		this.added.add(roomId);
	}

	/**
	 * Runs over every room after each snapshot; `pane` is the room (or thread)
	 * the viewer is reading, `reading` whether its end is on screen in a visible tab,
	 * and `readThrough` how far you have read a room (`ReadPositions.through`).
	 */
	observe(rooms: RoomSnapshot[], me: Identity | undefined, pane: string | undefined, reading: boolean, readThrough: (room: RoomSnapshot) => string | undefined = (room) => room.readMessageId): void {
		if (!me) return;
		const next: Record<string, number> = {};
		for (const room of rooms) {
			let shown = this.shown.get(room.id);
			if (!shown) {
				shown = new Set<string>();
				this.shown.set(room.id, shown);
				const newest = [room.latestLogId, room.timeline.order[room.timeline.order.length - 1]]
					.filter((id): id is string => id !== undefined)
					.sort(compareLogIds)
					.pop();
				if (newest !== undefined) this.watermarks.set(room.id, newest);
			}
			if (this.added.has(room.id)) {
				const joined = joinOf(room, me.user_id);
				const kept = this.watermarks.get(room.id);
				if (joined !== undefined) {
					this.added.delete(room.id);
					// Counted again from the join: what came before this page saw the room counts too, and
					// what came before the join doesn't, as when you were in the room before, then added again.
					this.floors.set(room.id, joined);
					if (kept === undefined || compareLogIds(joined, kept) !== 0) {
						this.watermarks.set(room.id, joined);
						shown.clear();
						this.arrivals.set(room.id, (this.arrivals.get(room.id) ?? []).filter((id) => compareLogIds(id, joined) > 0));
					}
				}
			}
			const watermark = this.watermarks.get(room.id);
			let arrivals = this.arrivals.get(room.id) ?? [];
			for (const id of room.timeline.order) {
				if (shown.has(id)) continue;
				shown.add(id);
				if (arrivals.includes(id)) continue;
				if (watermark !== undefined && compareLogIds(id, watermark) <= 0) continue;
				const event = room.timeline.events[id];
				if (event && !isOwn(event, me)) arrivals.push(id);
			}
			const read = readThrough(room);
			arrivals = room.id === pane && reading ? [] : arrivals.filter((id) => {
				const event = room.timeline.events[id];
				return event !== undefined && !event.deleted && (read === undefined || compareLogIds(id, read) > 0);
			});
			this.arrivals.set(room.id, arrivals);
			const count = arrivals.length + (room.id === pane && reading ? 0 : this.unreadBefore(room, me, watermark, read));
			if (count > 0) next[room.id] = count;
		}
		if (!sameCounts(this.byRoom, next)) this.byRoom = next;
	}

	/**
	 * Messages from others in a joined room, loaded at or below its watermark
	 * and after your read position (and after your join, in a room someone
	 * added you to): what came while the page was closed. Counted again only
	 * when the timeline, the read position or the bounds change.
	 */
	private unreadBefore(room: RoomSnapshot, me: Identity, watermark: string | undefined, read: string | undefined): number {
		// TODO: A thread loads only when opened (`loadsOnOpen`), so what came there while the page was closed isn't
		// counted until then; nor is more than a room's newest page. One `history` request without `room_id` after
		// reconnect (§4.3), which pages the log of every joined room, threads included, would bring it all to count.
		if (!room.joined || watermark === undefined || read === undefined) return 0;
		const floor = this.floors.get(room.id);
		const kept = this.before.get(room.id);
		if (kept && kept.timeline === room.timeline && kept.watermark === watermark && kept.read === read && kept.floor === floor) return kept.count;
		let count = 0;
		for (const id of room.timeline.order) {
			if (compareLogIds(id, watermark) > 0 || compareLogIds(id, read) <= 0 || (floor !== undefined && compareLogIds(id, floor) <= 0)) continue;
			const event = room.timeline.events[id];
			if (event && !event.deleted && !isOwn(event, me)) count++;
		}
		this.before.set(room.id, { timeline: room.timeline, watermark, read, ...(floor !== undefined ? { floor } : {}), count });
		return count;
	}
}

/** The `log_id` of your latest join of the room among its loaded memberships (§4.2.2), if it is your latest membership. */
function joinOf(room: RoomSnapshot, userId: string): string | undefined {
	const records = room.timeline.memberships;
	for (let index = records.length - 1; index >= 0; index--) {
		const entry = records[index].entries.find((candidate) => candidate.user.user_id === userId);
		if (entry) return entry.joined ? records[index].log_id : undefined;
	}
	return undefined;
}

/** A per-room count added up over every room but `pane`, the one being read. */
export function countElsewhere(byRoom: Record<string, number>, pane: string | undefined): number {
	let total = 0;
	for (const [room, count] of Object.entries(byRoom)) if (room !== pane) total += count;
	return total;
}

function sameCounts(a: Record<string, number>, b: Record<string, number>): boolean {
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
