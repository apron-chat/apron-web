import { describe, expect, it } from 'vitest';
import { notificationGroup } from './notifications';
import { readAction, readElsewhere, readFurthest, type ReadState } from './read-action';

const SERVER = 'wss://chat.example/';

/** A live, visible, loaded pane at its latest message, with someone looking. */
const reading = (fields: Partial<ReadState> = {}): ReadState => ({
	server: SERVER, room: { id: 'general', loaded: true }, last: '120', ready: true, readingLatest: true, visible: true, away: false, ...fields
});
const none = { pushId: undefined, closedThrough: undefined };

describe('reading the latest message', () => {
	it('marks it read, and closes the room’s notifications on this device up to it, the account’s where it has a push_id', () => {
		expect(readAction(reading(), none)).toEqual({ room: 'general', message: '120', close: { key: `:${SERVER}:general:120`, target: { tag: `apron:${SERVER}:general` } } });
		// The account's, where it has a push_id.
		expect(readAction(reading(), { pushId: 'a1', closedThrough: undefined })?.close).toEqual({ key: `a1:${SERVER}:general:120`, target: { group: notificationGroup('a1', 'general') } });
	});

	it('sends no read cursor unless a live session’s loaded pane is in view at its latest message', () => {
		const not: Array<[string, Partial<ReadState>]> = [
			['the session isn’t live yet (a view held through a reconnect)', { ready: false }],
			['the pane isn’t loaded (a view kept on this device, still catching up)', { room: { id: 'general', loaded: false } }],
			['the pane hasn’t opened at its divider, or its latest isn’t on screen', { readingLatest: false }],
			['the page isn’t in view', { visible: false }],
			['the pane has no messages', { last: undefined }],
			['there is no pane', { room: undefined }],
			['there is no client', { server: undefined }]
		];
		for (const [why, fields] of not) expect(readAction(reading(fields), none), why).toBeUndefined();
	});

	it('leaves the notifications while nobody is looking: an unfocused window shows its own', () => {
		expect(readAction(reading({ away: true }), none)).toEqual({ room: 'general', message: '120' });
	});

	it('closes each read’s notifications once', () => {
		const first = readAction(reading(), none)!;
		expect(readAction(reading(), { pushId: undefined, closedThrough: first.close!.key })).toEqual({ room: 'general', message: '120' });
		// The same message read as another account, or a newer one, closes again.
		expect(readAction(reading(), { pushId: 'a1', closedThrough: first.close!.key })?.close).toBeDefined();
		expect(readAction(reading({ last: '121' }), { pushId: undefined, closedThrough: first.close!.key })?.close).toBeDefined();
	});
});

describe('reading on another device', () => {
	const rooms = (cursors: Record<string, string | undefined>) => Object.entries(cursors).map(([id, readMessageId]) => ({ id, ...(readMessageId !== undefined ? { readMessageId } : {}) }));

	it('closes a room’s notifications here up to your read cursor, once a cursor, for rooms with one', () => {
		expect(readElsewhere(rooms({ general: '120', dev: undefined }), new Map(), new Map())).toEqual([{ room: 'general', message: '120' }]);
		// Closed through 120 already: only a cursor past it closes again.
		const closed = new Map([['general', '120']]);
		expect(readElsewhere(rooms({ general: '120' }), new Map(), closed)).toEqual([]);
		expect(readElsewhere(rooms({ general: '130' }), new Map(), closed)).toEqual([{ room: 'general', message: '130' }]);
	});

	it('leaves what this page read itself to readAction, which keeps them for a window behind another', () => {
		const own = new Map([['general', '120']]);
		expect(readElsewhere(rooms({ general: '120' }), own, new Map())).toEqual([]);
		// Compared as log IDs, not text: 1000 is past 999.
		expect(readElsewhere(rooms({ general: '1000' }), new Map([['general', '999']]), new Map())).toEqual([{ room: 'general', message: '1000' }]);
		// The page's own reads only move forward: a latest message deleted doesn't make an earlier read look like another device's.
		readFurthest(own, 'general', '110');
		expect(own.get('general')).toBe('120');
		readFurthest(own, 'general', '130');
		expect(own.get('general')).toBe('130');
	});
});
