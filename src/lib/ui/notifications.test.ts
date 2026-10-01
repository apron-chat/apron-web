import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_CLICK, PUSH_CLICK, closeOlderInGroup, messageNotificationTag, notificationBody, notificationClickTarget, notificationGroup, pushClickTarget, pushNotification, pushRoute, pushTarget, showNotification, tabWithPushId } from './notifications';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('showing notifications', () => {
	function stubPermission(permission: NotificationPermission, construct: () => void): void {
		const Page = vi.fn(function (this: { onclick?: () => void; close: () => void }) {
			construct();
			this.close = () => undefined;
		});
		vi.stubGlobal('Notification', Object.assign(Page, { permission }));
		vi.stubGlobal('isSecureContext', true);
	}

	it('shows the page\'s own notification without a service worker', async () => {
		stubPermission('granted', () => undefined);
		expect(await showNotification('ada · general', { body: 'hi' }, () => undefined)).toBe(true);
	});

	it('shows through the service worker when there is one, so pushes share its tags, and closes the room\'s older one', async () => {
		const construct = vi.fn();
		stubPermission('granted', construct);
		const older = { tag: 'apron:a1:1', data: { group: 'a1:general' }, close: vi.fn() };
		const shown = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ showNotification: shown, getNotifications: async () => [older, { tag: 'apron:a1:2', data: { group: 'a1:general' }, close: vi.fn() }] }) } });
		const options = { body: 'hi', tag: 'apron:a1:2', renotify: false, data: { group: 'a1:general' } };
		expect(await showNotification('ada · general', options, () => undefined)).toBe(true);
		expect(shown).toHaveBeenCalledWith('ada · general', options);
		expect(construct).not.toHaveBeenCalled();
		expect(older.close).toHaveBeenCalledOnce();
	});

	it('falls back to the page\'s own notification while the service worker isn\'t active', async () => {
		const construct = vi.fn();
		stubPermission('granted', construct);
		vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ showNotification: async () => { throw new TypeError('No active worker'); } }) } });
		expect(await showNotification('t', { tag: 'apron:x' }, () => undefined)).toBe(true);
		expect(construct).toHaveBeenCalledOnce();
	});

	it('reports nothing shown without permission or any way to show one', async () => {
		stubPermission('denied', () => undefined);
		expect(await showNotification('t', {}, () => undefined)).toBe(false);
		stubPermission('granted', () => { throw new TypeError('Illegal constructor'); });
		vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => undefined } });
		expect(await showNotification('t', {}, () => undefined)).toBe(false);
	});

	it('reads a click target the service worker posted, and nothing else', () => {
		const target = { tab: 't1', server: 'wss://chat.example/ws', roomId: 'general', threadId: 'th1' };
		expect(notificationClickTarget({ type: NOTIFICATION_CLICK, target })).toEqual(target);
		expect(notificationClickTarget({ type: 'other', target })).toBeUndefined();
		expect(notificationClickTarget({ type: NOTIFICATION_CLICK, target: { tab: 't1', roomId: 'general' } })).toBeUndefined();
	});
});

describe('push notifications', () => {
	it('shows a pushed message from its sender, in its room, replacing the room\'s last one', () => {
		expect(pushNotification({
			message_id: '1724803200042', room_id: 'general',
			from: { user_id: 'alice', name: 'Alice' },
			body: { text: 'Deploy is done,\n  can someone check?' }
		})).toEqual({
			title: 'Alice · general',
			options: { body: 'Deploy is done, can someone check?', tag: 'apron:push:general', renotify: true, data: { push: true, roomId: 'general' } }
		});
	});

	it('falls back to the user_id, and says only that a message arrived when the body was left out', () => {
		const shown = pushNotification({ message_id: '1', room_id: 'ops', from: { user_id: 'bob', name: ' ' } });
		expect(shown?.title).toBe('bob · ops');
		expect(shown?.options.body).toBe('New message');
		expect(pushNotification({ room_id: 'ops', body: { text: 'hi' } })?.title).toBe('Someone · ops');
	});

	it('shortens a long body', () => {
		expect(notificationBody('x'.repeat(200))).toBe(`${'x'.repeat(179)}…`);
		expect(pushNotification({ room_id: 'ops', from: { user_id: 'bob' }, body: { text: 'y'.repeat(181) } })?.options.body).toHaveLength(180);
	});

	it('shows nothing for a payload that isn\'t a message', () => {
		expect(pushNotification(undefined)).toBeUndefined();
		expect(pushNotification('hello')).toBeUndefined();
		expect(pushNotification({ from: { user_id: 'bob' }, body: { text: 'no room' } })).toBeUndefined();
	});

	it('reads a push click target, and tells it apart from a page notification\'s', () => {
		const data = pushNotification({ room_id: 'general' })!.options.data;
		expect(pushTarget(data)).toEqual({ push: true, roomId: 'general' });
		expect(pushTarget({ tab: 't1', server: 'wss://chat.example/', roomId: 'general' })).toBeUndefined();
		expect(pushClickTarget({ type: PUSH_CLICK, target: data })).toEqual({ push: true, roomId: 'general' });
		expect(pushClickTarget({ type: NOTIFICATION_CLICK, target: data })).toBeUndefined();
	});

	it('shows a push with a push_id as its message\'s own notification, the tag the page uses for it', () => {
		const shown = pushNotification({ message_id: '1724803200042', room_id: 'general', push_id: 'a1', from: { user_id: 'alice', name: 'Alice' }, body: { text: 'Deploy is done' } });
		expect(shown?.options).toEqual({
			body: 'Deploy is done', tag: 'apron:a1:1724803200042', renotify: false,
			data: { push: true, roomId: 'general', pushId: 'a1', messageId: '1724803200042', group: 'a1:general' }
		});
		expect(shown?.options.tag).toBe(messageNotificationTag('a1', '1724803200042'));
		expect(pushTarget(shown?.options.data)).toEqual(shown?.options.data);
		expect(pushClickTarget({ type: PUSH_CLICK, target: shown?.options.data })?.pushId).toBe('a1');
	});

	it('opens a pushed room only in a tab signed in to the account its push_id names', () => {
		expect(pushRoute({ pushId: 'a1' }, 'a1', false)).toBe('open');
		expect(pushRoute({ pushId: 'a1' }, 'b2', true)).toBe('ignore');
		expect(pushRoute({ pushId: 'a1' }, undefined, true)).toBe('wait');
		// Without a push_id (an older server): the tab on the account holding the subscription.
		expect(pushRoute({}, 'a1', true)).toBe('open');
		expect(pushRoute({}, 'a1', false)).toBe('ignore');
	});

	it('picks the first tab that answers with the push_id', async () => {
		const answers: Record<string, string | undefined> = { t1: 'b2', t2: undefined, t3: 'a1', t4: 'a1' };
		const ask = async (tab: string) => {
			if (tab === 't2') throw new Error('gone');
			return answers[tab];
		};
		expect(await tabWithPushId(['t1', 't2', 't3', 't4'], 'a1', ask)).toBe('t3');
		expect(await tabWithPushId(['t1', 't2'], 'a1', ask)).toBeUndefined();
		expect(await tabWithPushId([], 'a1', ask)).toBeUndefined();
	});

	it('closes the older notifications of a room, and only those', () => {
		const shown = (tag: string, data: unknown) => ({ tag, data, close: vi.fn() });
		const older = shown('apron:a1:1', { group: notificationGroup('a1', 'general') });
		const newest = shown('apron:a1:2', { group: 'a1:general' });
		const otherRoom = shown('apron:a1:3', { group: 'a1:ops' });
		const test = shown('apron:test', undefined);
		closeOlderInGroup([older, newest, otherRoom, test], 'a1:general', 'apron:a1:2');
		expect([older, newest, otherRoom, test].map((entry) => entry.close.mock.calls.length)).toEqual([1, 0, 0, 0]);
	});

	it('replaces the page\'s older notification of a room with the newer message\'s, without a service worker', async () => {
		type Shown = { tag?: string; data?: unknown; close: () => void; closed: boolean };
		const shown: Shown[] = [];
		const Page = vi.fn(function (this: Shown, _title: string, options: NotificationOptions) {
			this.tag = options.tag;
			this.data = options.data;
			this.closed = false;
			this.close = () => { this.closed = true; };
			shown.push(this);
		});
		vi.stubGlobal('Notification', Object.assign(Page, { permission: 'granted' }));
		vi.stubGlobal('isSecureContext', true);
		const data = { group: 'a1:general' };
		await showNotification('ada · general', { tag: 'apron:a1:1', data }, () => undefined);
		await showNotification('ada · general', { tag: 'apron:a1:2', data }, () => undefined);
		await showNotification('ada · ops', { tag: 'apron:a1:3', data: { group: 'a1:ops' } }, () => undefined);
		expect(shown.map((entry) => entry.closed)).toEqual([true, false, false]);
	});
});
