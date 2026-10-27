import type { RoomSnapshot } from '$lib/protocol/client';
import { compareLogIds, type TimelineState } from '$lib/protocol/reducer';
import type { Identity, MessageRecord } from '$lib/protocol/types';
import { isOwn, mentionsMe } from './messages';

/** How long the mention pulse stays on a row; the animation itself runs once. */
const PING_MS = 1200;

/**
 * Mentions of you as they arrive: the row pulses once, a room or thread you
 * aren't reading counts them (its unread bubble turns orange with an `@`; a
 * thread's on its own row, which the sidebar lists under its room whenever it
 * has news, so not on the room too), and one that lands above the fold joins
 * the jump bar's list.
 * A message mentions you when its `body.mentions` lists you (§3.5); an edit
 * that adds you counts as an arrival too. The first time a room is seen its
 * newest known log position becomes its watermark: messages created at or
 * below it are history (a thread's history loads only when it is opened) and
 * never ping, nor do edits logged at or below it; anything after it arrives.
 * A mention in that history after your read position in a joined room still
 * counts on its row, without a ping (`mentionsBefore`), so a reload keeps
 * the mentions you hadn't read; it stops counting once you read past it. The
 * page counts these only where the server keeps read cursors (`readThrough`
 * says nothing elsewhere), as `UnreadTracker` does.
 */
export class MentionTracker {
	/** Message IDs pulsing because a mention of you just arrived. */
	pinged = $state<string[]>([]);
	/** Mentions that landed in a room or thread you weren't reading, cleared when you open it. */
	private live = $state<Record<string, number>>({});
	/** Mentions in each room's history after your read position (`mentionsBefore`), until you read past them. */
	private unreadBefore = $state<Record<string, number>>({});
	/** Each room's unread mentions, of both kinds: what its row counts. */
	byRoom = $derived(addCounts(this.live, this.unreadBefore));
	/** Each room's count of history mentions, and what it was counted from. */
	private readonly before = new Map<string, { timeline: TimelineState; watermark: string; read: string; count: number }>();
	/** Mentions that arrived in the open pane while you were scrolled up, oldest first. */
	unseen = $state<string[]>([]);
	/** How many mentions of you have arrived so far: it ticks up once per new one. */
	arrived = $state(0);
	/** Per room, each message seen: the snapshot's `log_id` and whether it mentioned you. */
	private readonly shown = new Map<string, Map<string, { log: string; mentioned: boolean }>>();
	private readonly watermarks = new Map<string, string>();
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

	/**
	 * Runs over every room after each snapshot; `pane` is the room (or thread)
	 * the viewer is reading, `latestVisible` whether its end is on screen, and
	 * `readThrough` how far you have read a room (`ReadPositions.through`).
	 */
	observe(rooms: RoomSnapshot[], me: Identity | undefined, pane: string | undefined, latestVisible: boolean, readThrough: (room: RoomSnapshot) => string | undefined = (room) => room.readMessageId): MessageRecord[] {
		const arrived: MessageRecord[] = [];
		if (!me) return arrived;
		const before: Record<string, number> = {};
		for (const room of rooms) {
			let shown = this.shown.get(room.id);
			if (!shown) {
				shown = new Map();
				this.shown.set(room.id, shown);
				const newest = [room.latestLogId, room.timeline.order[room.timeline.order.length - 1]]
					.filter((id): id is string => id !== undefined)
					.sort(compareLogIds)
					.pop();
				if (newest !== undefined) this.watermarks.set(room.id, newest);
			}
			const watermark = this.watermarks.get(room.id);
			for (const id of room.timeline.order) {
				const event = room.timeline.events[id];
				const seen = shown.get(id);
				if (!event || seen?.log === event.log_id) continue;
				const mentioned = mentionsMe(event, me);
				shown.set(id, { log: event.log_id, mentioned });
				// A new message, or an edit that adds you, after the watermark.
				if (!mentioned || seen?.mentioned || (watermark !== undefined && compareLogIds(event.log_id, watermark) <= 0)) continue;
				this.ping(id);
				arrived.push(event);
				this.arrived++;
				if (room.id !== pane) this.live = { ...this.live, [room.id]: (this.live[room.id] ?? 0) + 1 };
				else if (!latestVisible && !this.unseen.includes(id)) this.unseen = [...this.unseen, id];
			}
			const count = room.id === pane ? 0 : this.mentionsBefore(room, me, watermark, readThrough(room));
			if (count > 0) before[room.id] = count;
		}
		if (!sameCounts(this.unreadBefore, before)) this.unreadBefore = before;
		return arrived;
	}

	/**
	 * Mentions of you from others in a joined room, loaded at or below its
	 * watermark and after your read position: what came while the page was
	 * closed. Counted again only when the timeline, the read position or the
	 * watermark change. Threads count once opened (see `UnreadTracker.unreadBefore`).
	 */
	private mentionsBefore(room: RoomSnapshot, me: Identity, watermark: string | undefined, read: string | undefined): number {
		if (!room.joined || watermark === undefined || read === undefined) return 0;
		const kept = this.before.get(room.id);
		if (kept && kept.timeline === room.timeline && kept.watermark === watermark && kept.read === read) return kept.count;
		let count = 0;
		for (const id of room.timeline.order) {
			if (compareLogIds(id, watermark) > 0 || compareLogIds(id, read) <= 0) continue;
			const event = room.timeline.events[id];
			if (event && !event.deleted && !isOwn(event, me) && mentionsMe(event, me)) count++;
		}
		this.before.set(room.id, { timeline: room.timeline, watermark, read, count });
		return count;
	}

	reset(): void {
		this.dispose();
		this.shown.clear();
		this.watermarks.clear();
		this.before.clear();
		this.pinged = [];
		this.live = {};
		this.unreadBefore = {};
		this.unseen = [];
	}

	/** Opening a room clears the mentions that arrived while the page was open; those from before go once read past. */
	clearRoom(roomId: string): void {
		if (!this.live[roomId]) return;
		const next = { ...this.live };
		delete next[roomId];
		this.live = next;
	}

	clearUnseen(): void {
		if (this.unseen.length > 0) this.unseen = [];
	}

	/** The oldest mention still above the fold, taken off the list. */
	takeUnseen(): string | undefined {
		const [first, ...rest] = this.unseen;
		if (first) this.unseen = rest;
		return first;
	}

	dispose(): void {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
	}

	/** One ring pulse on arrival, then the row settles back. */
	private ping(id: string): void {
		const running = this.timers.get(id);
		if (running) clearTimeout(running);
		else this.pinged = [...this.pinged, id];
		this.timers.set(id, setTimeout(() => {
			this.timers.delete(id);
			this.pinged = this.pinged.filter((pinged) => pinged !== id);
		}, PING_MS));
	}
}

/** Two per-room counts added up. */
function addCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
	const sum = { ...a };
	for (const [room, count] of Object.entries(b)) sum[room] = (sum[room] ?? 0) + count;
	return sum;
}

function sameCounts(a: Record<string, number>, b: Record<string, number>): boolean {
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
