import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_CLICK, PUSH_CLICK, QUIET_PUSH, closeOlderInGroup, messageNotificationTag, notificationBody, notificationClickTarget, notificationGroup, pageTarget, planPush, pushClickTarget, pushNotification, pushRoute, pushTarget, readPush, setAppBadge, showNotification, tabWithPushId, type ShowNotificationOptions } from './notifications';

/** A service worker registration's notifications: one per tag, a newer one with a tag replacing the older. */
function fakeRegistration() {
	const list: Array<{ title: string; tag?: string; data?: unknown; options: ShowNotificationOptions; close: () => void }> = [];
	const registration = {
		list,
		showNotification: vi.fn(async (title: string, options: ShowNotificationOptions) => {
			const at = list.findIndex((entry) => options.tag !== undefined && entry.tag === options.tag);
			const entry = { title, tag: options.tag, data: options.data, options, close: () => { const index = list.indexOf(entry); if (index >= 0) list.splice(index, 1); } };
			if (at >= 0) list.splice(at, 1, entry); else list.push(entry);
		}),
		getNotifications: async () => [...list]
	};
	return registration;
}

/** A message notification's options, as the page and the service worker make them. */
function messageOptions(id: string, room = 'general'): ShowNotificationOptions {
	return { body: `message ${id}`, tag: messageNotificationTag('a1', id), renotify: false, data: { pushId: 'a1', messageId: id, group: notificationGroup('a1', room) } };
}

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
		const registration = fakeRegistration();
		vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => registration } });
		expect(await showNotification('ada · general', messageOptions('100'), () => undefined)).toBe(true);
		expect(await showNotification('ada · general', messageOptions('101'), () => undefined)).toBe(true);
		expect(registration.list.map((entry) => entry.tag)).toEqual(['apron:a1:101']);
		expect(construct).not.toHaveBeenCalled();
	});

	it('shows a message the room already notified about, or one older than it, no more', async () => {
		stubPermission('granted', () => undefined);
		const registration = fakeRegistration();
		vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => registration } });
		// A push showed message 101 first; the page's notification of it, or of the older 100, doesn't show.
		await registration.showNotification('ada · #general', messageOptions('101'));
		expect(await showNotification('ada · General', messageOptions('101'), () => undefined)).toBe(true);
		expect(await showNotification('ada · General', messageOptions('100'), () => undefined)).toBe(true);
		expect(registration.showNotification).toHaveBeenCalledTimes(1);
		// The push's notification stays as it was.
		expect(registration.list.map((entry) => entry.title)).toEqual(['ada · #general']);
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
		const message = { message_id: '1724803200042', room_id: 'general', from: { user_id: 'alice', name: 'Alice' }, body: { text: 'Deploy is done' } };
		const push = readPush({ push_id: 'a1', unread: 2, message, future: true });
		expect(push?.pushId).toBe('a1');
		expect(push?.unread).toBe(2);
		const shown = push?.notification;
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

	it('closes the notifications of a room\'s strictly older messages, and only those', () => {
		const shown = (tag: string, data: unknown) => ({ tag, data, close: vi.fn() });
		const older = shown('apron:a1:9', { group: notificationGroup('a1', 'general'), messageId: '9' });
		const same = shown('apron:a1:10', { group: 'a1:general', messageId: '10' });
		const newer = shown('apron:a1:11', { group: 'a1:general', messageId: '11' });
		const otherRoom = shown('apron:a1:3', { group: 'a1:ops', messageId: '3' });
		const test = shown('apron:test', undefined);
		closeOlderInGroup([older, same, newer, otherRoom, test], 'a1:general', '10');
		expect([older, same, newer, otherRoom, test].map((entry) => entry.close.mock.calls.length)).toEqual([1, 0, 0, 0, 0]);
	});

	describe('planning a push', () => {
		const push = (id: string, room = 'general', extra: Record<string, unknown> = {}) => readPush({ push_id: 'a1', message: { message_id: id, room_id: room, from: { user_id: 'bob' }, body: { text: `message ${id}` } }, ...extra });

		it('shows a new message, closing older ones of its room after', () => {
			const plan = planPush(push('12', 'general', { unread: 3 }), [{ data: messageOptions('11').data }], { enabled: ['a1'] });
			expect(plan.show?.options.tag).toBe('apron:a1:12');
			expect(plan.notified).toEqual({ group: 'a1:general', messageId: '12' });
			expect(plan.badge).toBe(3);
		});

		it('leaves the page\'s notifications of m1 and m2 alone when a late push of m1 arrives', () => {
			// The page showed m1, then m2, which closed m1.
			const plan = planPush(push('1'), [{ data: messageOptions('2').data }], { marks: { 'a1:general': '2' } });
			expect(plan.show).toBeUndefined();
			expect(plan.notified).toBeUndefined();
		});

		it('doesn\'t show again a message a push showed before the page tried', () => {
			expect(planPush(push('5'), [{ data: messageOptions('5').data }]).show).toBeUndefined();
		});

		it('shows a dismissed message again only quietly, when nothing else is showing', () => {
			const plan = planPush(push('7'), [], { marks: { 'a1:general': '7' } });
			expect(plan.show?.options).toMatchObject({ tag: 'apron:a1:7', renotify: false, silent: true });
			expect(plan.notified).toBeUndefined();
			// With another notification showing, nothing.
			expect(planPush(push('7'), [{ data: messageOptions('3', 'ops').data }], { marks: { 'a1:general': '7' } }).show).toBeUndefined();
		});

		it('drops a push for an account push isn\'t on for, and stands in a quiet notification when none shows', () => {
			expect(planPush(push('8'), [], { enabled: ['b2'] }).show).toEqual(QUIET_PUSH);
			expect(planPush(push('8'), [{ data: undefined }], { enabled: ['b2'] }).show).toBeUndefined();
			// Unknown before IndexedDB has the list: shown.
			expect(planPush(push('8'), []).show?.options.tag).toBe('apron:a1:8');
		});

		it('never shows a notification for a badge push, only sets the badge', () => {
			expect(planPush(readPush({ push_id: 'a1', unread: 0 }), [], { enabled: ['a1'] })).toEqual({ badge: 0 });
			expect(planPush(readPush({ push_id: 'a1', unread: 4 }), [{ data: undefined }])).toEqual({ badge: 4 });
		});

		it('shows the quiet stand-in for an unreadable push with nothing showing', () => {
			expect(planPush(undefined, []).show).toEqual(QUIET_PUSH);
			expect(planPush(undefined, [{ data: undefined }]).show).toBeUndefined();
		});
	});

	it('routes a clicked page notification by its room when the tab that raised it is gone', () => {
		expect(pageTarget({ tab: 't1', server: 'wss://a/', roomId: 'general', threadId: 'th1', pushId: 'a1', messageId: '5', group: 'a1:th1' })).toEqual({ push: true, roomId: 'th1', pushId: 'a1' });
		expect(pageTarget({ tab: 't1', server: 'wss://a/', roomId: 'general' })).toEqual({ push: true, roomId: 'general' });
		expect(pageTarget({ push: true, roomId: 'general' })).toBeUndefined();
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
		await showNotification('ada · general', messageOptions('1'), () => undefined);
		await showNotification('ada · general', messageOptions('2'), () => undefined);
		await showNotification('ada · ops', messageOptions('3', 'ops'), () => undefined);
		expect(shown.map((entry) => entry.closed)).toEqual([true, false, false]);
	});

	it('reads a badge push, with no message, as no notification', () => {
		expect(readPush({ push_id: 'a1', unread: 0 })).toEqual({ pushId: 'a1', unread: 0 });
		expect(readPush({ push_id: 'a1' })).toEqual({ pushId: 'a1' });
		expect(readPush({ unread: -1, message: 'nope' })).toEqual({});
		expect(readPush({ unread: 1.5 })).toEqual({});
		// Anything but an object can't be read.
		expect(readPush('hello')).toBeUndefined();
		expect(readPush(undefined)).toBeUndefined();
	});

	it('reads a message object without the envelope as no notification', () => {
		expect(readPush({ message_id: '7', room_id: 'general', push_id: 'a1', from: { user_id: 'bob' } })).toEqual({ pushId: 'a1' });
	});

	it('sets the app badge to the unread count, clearing it at 0, where there is one', async () => {
		const nav = { setAppBadge: vi.fn(async () => undefined), clearAppBadge: vi.fn(async () => undefined) };
		await setAppBadge(nav, 3);
		await setAppBadge(nav, 0);
		expect(nav.setAppBadge).toHaveBeenCalledWith(3);
		expect(nav.clearAppBadge).toHaveBeenCalledOnce();
		await setAppBadge({}, 2);
		await setAppBadge(undefined, 2);
		await setAppBadge({ setAppBadge: async () => { throw new Error('not allowed'); } }, 2);
	});
});
