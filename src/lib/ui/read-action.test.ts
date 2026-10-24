import { describe, expect, it } from 'vitest';
import { notificationGroup } from './notifications';
import { readAction, type ReadState } from './read-action';

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
