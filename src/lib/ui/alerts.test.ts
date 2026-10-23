import { afterEach, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import { messageRecord, roomSnapshot } from '$lib/test/builders';
import { arrivalAlerts, type AlertSettings, type AlertView } from './alerts';
import { IncomingMessageTracker } from './incoming-messages';
import { MentionTracker } from './mentions.svelte';

const me = { user_id: 'sam', name: 'Sam' };
const message = (id: number, room = 'general', fields: Partial<MessageRecord> = {}) => messageRecord(id, room, { from: { user_id: 'ada', name: 'Ada' }, ...fields });
const mention = (id: number, room = 'general') => message(id, room, { body: { text: '@sam hi', mentions: ['sam'] } });

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

	it('neither hears nor notifies about a room you muted, or a thread of one', () => {
		const muted = { mutedUntil: true as const };
		const thread = (messages: MessageRecord[] = []) => roomSnapshot('t1', messages, { parentRoomId: 'general', latestLogId: '100' });
		const { alerts } = alertsFor([general([], muted), thread()], [general([mention(101)], muted), thread([mention(102, 't1')])], { settings: { offerable: true } });
		expect(alerts).toEqual({ audible: 0, notify: [] });
	});

	it.each([
		['notifications are off', { active: false }],
		['someone is looking', { away: false }],
		['paused or on do not disturb', { silenced: true }]
	])('chimes but shows no notification while %s', (_, fields) => {
		const { alerts } = alertsFor([general()], [general([mention(101)])], { settings: fields });
		expect(alerts.audible).toBe(1);
		expect(alerts.notify).toEqual([]);
	});

	it('notifies only about the checked scopes', () => {
		const random = roomSnapshot('random', [], { latestLogId: '100' });
		const before = [general(), random];
		const after = [general([message(101)]), roomSnapshot('random', [message(102, 'random')])];
		expect(notified(alertsFor(before, after).alerts)).toEqual([]);
		expect(notified(alertsFor(before, after, { settings: { scopes: ['joined'] } }).alerts)).toEqual([['101', false], ['102', false]]);
	});

	it('notifies once per room, for its newest mention over newer messages', () => {
		const { alerts } = alertsFor([general()], [general([message(101), mention(102), message(103)])], { settings: { scopes: ['joined', 'mentions'] } });
		expect(notified(alerts)).toEqual([['102', true]]);
	});

	it('offers notifications at the first mention you’d hear, naming who and where', () => {
		const { alerts } = alertsFor([general()], [general([mention(101), mention(102)])], { settings: { offerable: true, active: false } });
		expect(alerts.offer).toEqual({ from: 'Ada', room: 'General' });
		expect(alertsFor([general()], [general([message(101)])], { settings: { offerable: true } }).alerts.offer).toBeUndefined();
		expect(alertsFor([general()], [general([mention(101)])], { settings: { offerable: false } }).alerts.offer).toBeUndefined();
	});
});
