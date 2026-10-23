import type { RoomSnapshot } from '$lib/protocol/client';
import { createTimeline, type TimelineState } from '$lib/protocol/reducer';
import type { MessageRecord } from '$lib/protocol/types';

/**
 * Test support: records and snapshots with the fields a test doesn't care
 * about filled in. Each takes the fields it does care about last, and they win.
 */

/**
 * A message from `ada` in `roomId`, its `message_id` and `log_id` both `id`
 * (epoch milliseconds read as a time), its text `hello <id>`.
 */
export function messageRecord(id: number | string, roomId = 'general', fields: Partial<MessageRecord> = {}): MessageRecord {
	return { message_id: String(id), log_id: String(id), room_id: roomId, from: { user_id: 'ada' }, body: { text: `hello ${id}` }, ...fields };
}

/** A room's timeline holding `messages` in the order given. */
export function timelineOf(roomId: string, messages: MessageRecord[] = []): TimelineState {
	return { ...createTimeline(roomId), events: Object.fromEntries(messages.map((event) => [event.message_id, event])), order: messages.map((event) => event.message_id) };
}

/** A joined room titled by its id, loaded and holding `messages`, as the client publishes it. */
export function roomSnapshot(id: string, messages: MessageRecord[] = [], fields: Partial<RoomSnapshot> = {}): RoomSnapshot {
	return { id, title: id, joined: true, timeline: timelineOf(id, messages), recovering: false, loaded: true, loading: false, notices: [], ...fields };
}
