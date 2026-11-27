import { afterEach, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import { messageRecord, roomSnapshot } from '$lib/test/builders';
import { arrivalAlerts, type AlertSettings, type AlertView } from './alerts';
import { IncomingMessageTracker, notificationsByRoom } from './incoming-messages';
import { MentionTracker } from './mentions.svelte';

const me = { user_id: 'sam', name: 'Sam' };
const message = (id: number, room = 'general', fields: Partial<MessageRecord> = {}) => messageRecord(id, room, { from: { user_id: 'ada', name: 'Ada' }, ...fields });
const mention = (id: number, room = 'general') => message(id, room, { body: { text: '@sam hi', mentions: ['sam'] } });
const reply = (id: number, to: string, room = 'general') => message(id, room, { reply_to: { message_id: to }, body: { text: 'yes' } });

/** Notifications on, nobody looking, nothing silenced, the default scopes; no offer up. */
const settings = (fields: Partial<AlertSettings> = {}): AlertSettings => ({ offerable: false, active: true, away: true, silenced: false, scopes: ['mentions', 'replies'], ...fields });

const trackers: Array<MentionTracker> = [];
afterEach(() => trackers.splice(0).forEach((tracker) => tracker.dispose()));

/**
 * A page that has seen `before` (each room's history, which never alerts), then gets `after`: what that alerts.
 * `held` makes the second view a held one.
 */
function alertsFor(before: RoomSnapshot[], after: RoomSnapshot[], options: { settings?: Partial<AlertSettings>; held?: boolean; pane?: string } = {}) {
	const mentions = new MentionTracker();
	trackers.push(mentions);
	const tracked = { mentions, messages: new IncomingMessageTracker() };
	const view = (rooms: RoomSnapshot[], held = false): AlertView => ({ held, rooms, you: me, pane: options.pane, latestVisible: true });
	arrivalAlerts(view(before), tracked, settings());
	return { alerts: arrivalAlerts(view(after, options.held), tracked, settings(options.settings)), next: (rooms: RoomSnapshot[]) => arrivalAlerts(view(rooms), tracked, settings(options.settings)) };
}

const general = (messages: MessageRecord[] = [], fields: Partial<RoomSnapshot> = {}) => roomSnapshot('general', messages, { title: 'General', latestLogId: '100', ...fields });
const notified = (alerts: ReturnType<typeof arrivalAlerts>) => alerts.notify.map(({ event, mention: isMention }) => [event.message_id, isMention]);

describe('alerts as messages arrive', () => {
	it('notifies about a mention while you are away, and counts it as heard', () => {
		const { alerts } = alertsFor([general()], [general([mention(101)])]);
		expect(alerts.audible).toBe(1);
		expect(notified(alerts)).toEqual([['101', true]]);
	});

	it('never alerts from a held view, nor afterwards for what it showed', () => {
		// A view held from before (a reconnect, or one kept on this device) arrives first: nothing in it is new.
		const { alerts, next } = alertsFor([], [general([mention(101)], { latestLogId: '101' })], { held: true });
		expect(alerts).toEqual({ audible: 0, notify: [] });
		// The live rooms count from where they are, not from where the held view left off: what came meanwhile is history.
		expect(next([general([mention(101), mention(102)], { latestLogId: '102' })])).toEqual({ audible: 0, notify: [] });
		expect(notified(next([general([mention(101), mention(102), mention(103)], { latestLogId: '103' })]))).toEqual([['103', true]]);
	});

	it('never alerts about history, or your own messages', () => {
		const { alerts } = alertsFor([], [general([mention(90)], { latestLogId: '90' })]);
		expect(alerts).toEqual({ audible: 0, notify: [] });
		const own = alertsFor([general()], [general([message(101, 'general', { from: me, body: { text: 'hi', mentions: ['sam'] } })])]).alerts;
		expect(notified(own)).toEqual([]);
	});

	it('hears and notifies about mentions through a mute, in the room or a thread of it, but not other messages', () => {
		const muted = { mutedUntil: true as const };
		const thread = (messages: MessageRecord[] = []) => roomSnapshot('t1', messages, { parentRoomId: 'general', latestLogId: '100' });
		const { alerts } = alertsFor([general([], muted), thread()], [general([mention(101), message(103)], muted), thread([mention(102, 't1'), message(104, 't1')])], { settings: { offerable: true, scopes: ['mentions', 'joined'] } });
		expect(alerts.audible).toBe(2);
		expect(alerts.offer).toBeDefined();
		expect(notified(alerts)).toEqual([['101', true], ['102', true]]);
	});

	it('chimes but shows no notification while notifications are off, someone is looking, or they are paused or on do not disturb', () => {
		for (const fields of [{ active: false }, { away: false }, { silenced: true }]) {
			const { alerts } = alertsFor([general()], [general([mention(101)])], { settings: fields });
			expect(alerts, JSON.stringify(fields)).toMatchObject({ audible: 1, notify: [] });
		}
	});

	it('notifies only about the checked scopes', () => {
		const random = roomSnapshot('random', [], { latestLogId: '100' });
		const before = [general(), random];
		const after = [general([message(101)]), roomSnapshot('random', [message(102, 'random')])];
		expect(notified(alertsFor(before, after).alerts)).toEqual([]);
		expect(notified(alertsFor(before, after, { settings: { scopes: ['joined'] } }).alerts)).toEqual([['101', false], ['102', false]]);
	});

	it('notifies once per room, for its newest mention over newer messages, else its newest message', () => {
		const random = (messages: MessageRecord[] = []) => roomSnapshot('random', messages, { latestLogId: '100' });
		const { alerts } = alertsFor([general(), random()], [general([message(101), mention(102), message(103)]), random([message(104, 'random'), message(105, 'random')])], { settings: { scopes: ['joined', 'mentions'] } });
		expect(notified(alerts)).toEqual([['102', true], ['105', false]]);
		// The pick doesn't rest on the mentions coming after the other messages.
		expect(notificationsByRoom([mention(102), message(103)], new Set(['102'])).map((event) => event.message_id)).toEqual(['102']);
	});

	it('offers notifications at the first mention you’d hear, naming who and where', () => {
		const { alerts } = alertsFor([general()], [general([mention(101), mention(102)])], { settings: { offerable: true, active: false } });
		expect(alerts.offer).toEqual({ from: 'Ada', room: 'General' });
		expect(alertsFor([general()], [general([message(101)])], { settings: { offerable: true } }).alerts.offer).toBeUndefined();
		expect(alertsFor([general()], [general([mention(101)])], { settings: { offerable: false } }).alerts.offer).toBeUndefined();
	});

	it('offers notifications at the first reply to one of your messages, unless a mention came too', () => {
		const mine = messageRecord(100, 'general', { from: me, body: { text: 'lunch?' } });
		const offerable = { settings: { offerable: true, active: false } };
		expect(alertsFor([general([mine])], [general([mine, reply(101, '100')])], offerable).alerts.offer).toEqual({ from: 'Ada', room: 'General', reply: true });
		// A mention in the same batch is named instead, even after the reply.
		expect(alertsFor([general([mine])], [general([mine, reply(101, '100'), mention(102)])], offerable).alerts.offer).toEqual({ from: 'Ada', room: 'General' });
		// A reply hasn't the chime of a mention.
		expect(alertsFor([general([mine])], [general([mine, reply(101, '100')])], offerable).alerts.audible).toBe(0);
	});

	it('offers nothing at a reply the Replies scope wouldn’t notify about, or when an offer isn’t due', () => {
		const mine = messageRecord(100, 'general', { from: me, body: { text: 'lunch?' } });
		const offerable = (fields: Partial<AlertSettings> = {}) => ({ settings: { offerable: true, active: false, ...fields } });
		const offer = (before: RoomSnapshot[], after: RoomSnapshot[], options = offerable()) => alertsFor(before, after, options).alerts.offer;
		// Replies to my messages unchecked, or no offer due.
		expect(offer([general([mine])], [general([mine, reply(101, '100')])], offerable({ scopes: ['mentions'] }))).toBeUndefined();
		expect(offer([general([mine])], [general([mine, reply(101, '100')])], { settings: { offerable: false, active: false } })).toBeUndefined();
		// A reply to someone else's message, to your deleted one, or to one that isn't loaded.
		const theirs = message(99);
		expect(offer([general([theirs])], [general([theirs, reply(101, '99')])])).toBeUndefined();
		const gone = { ...mine, deleted: true };
		expect(offer([general([gone])], [general([gone, reply(101, '100')])])).toBeUndefined();
		expect(offer([general()], [general([reply(101, '100')])])).toBeUndefined();
		// In a room you muted, or a thread of one.
		const muted = { mutedUntil: true as const };
		expect(offer([general([mine], muted)], [general([mine, reply(101, '100')], muted)])).toBeUndefined();
		const thread = (messages: MessageRecord[] = []) => roomSnapshot('t1', messages, { parentRoomId: 'general', latestLogId: '100' });
		const inThread = messageRecord(100, 't1', { from: me, body: { text: 'lunch?' } });
		expect(offer([general([], muted), thread([inThread])], [general([], muted), thread([inThread, reply(101, '100', 't1')])])).toBeUndefined();
	});

	it('names no room for an offer in a private room named for its members', () => {
		const dm = (messages: MessageRecord[] = []) => roomSnapshot('dm', messages, { title: 'Ada', namedForMembers: true, private: true, latestLogId: '100' });
		expect(alertsFor([dm()], [dm([mention(101, 'dm')])], { settings: { offerable: true } }).alerts.offer).toEqual({ from: 'Ada' });
	});
});
