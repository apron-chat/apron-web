import type { RoomSnapshot } from '$lib/protocol/client';
import { compareLogIds } from '$lib/protocol/reducer';
import type { Identity, MessageRecord } from '$lib/protocol/types';
import { isOwn } from './messages';

/** Detects genuinely new, non-own messages without re-alerting on room history or edits. */
export class IncomingMessageTracker {
	private readonly shown = new Map<string, Set<string>>();
	private readonly watermarks = new Map<string, string>();

	reset(): void {
		this.shown.clear();
		this.watermarks.clear();
	}

	observe(rooms: RoomSnapshot[], me: Identity | undefined): MessageRecord[] {
		const incoming: MessageRecord[] = [];
		if (!me) return incoming;
		for (const room of rooms) {
			let shown = this.shown.get(room.id);
			if (!shown) {
				shown = new Set<string>();
				this.shown.set(room.id, shown);
				const newest = [room.latestLogId, ...room.timeline.order.map((id) => room.timeline.events[id]?.log_id)]
					.filter((id): id is string => id !== undefined)
					.sort(compareLogIds)
					.pop();
				if (newest !== undefined) this.watermarks.set(room.id, newest);
			}
			const watermark = this.watermarks.get(room.id);
			for (const id of room.timeline.order) {
				if (shown.has(id)) continue;
				shown.add(id);
				const event = room.timeline.events[id];
				if (!event || event.deleted || isOwn(event, me)) continue;
				if (watermark !== undefined && compareLogIds(event.log_id, watermark) <= 0) continue;
				incoming.push(event);
			}
		}
		return incoming;
	}
}
