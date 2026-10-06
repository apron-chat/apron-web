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

/** What the service worker remembers notifying about per group, as `loadShownMarks` reads it (dismissed ones too). */
const shownMarks = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('./push-store', async (importOriginal) => ({
	...await importOriginal<typeof import('./push-store')>(),
	loadShownMarks: async () => ({ ...shownMarks.value })
}));

afterEach(() => {
	vi.unstubAllGlobals();
	shownMarks.value = {};
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

	it('replaces a pushed notification of the same message quietly, and shows an older one no more', async () => {
		stubPermission('granted', () => undefined);
		const registration = fakeRegistration();
		vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => registration } });
		// A push showed message 101 first; the page's notification of it takes its place, quietly.
		await registration.showNotification('ada · #general', messageOptions('101'));
		expect(await showNotification('ada · General', messageOptions('101'), () => undefined)).toBe(true);
		expect(registration.list.map((entry) => entry.title)).toEqual(['ada · General']);
		expect(registration.list[0].options).toMatchObject({ tag: 'apron:a1:101', renotify: false, silent: true });
		// The room's older message 100 doesn't show under it.
		expect(await showNotification('ada · General', messageOptions('100'), () => undefined)).toBe(true);
		expect(registration.showNotification).toHaveBeenCalledTimes(2);
		expect(registration.list.map((entry) => entry.tag)).toEqual(['apron:a1:101']);
	});

	it('doesn\'t bring back a message notification that was dismissed', async () => {
		stubPermission('granted', () => undefined);
		const registration = fakeRegistration();
		vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => registration } });
		// A push notified about 101, and it was dismissed: only the mark is left.
		shownMarks.value = { [notificationGroup('a1', 'general')]: '101' };
		expect(await showNotification('ada · General', messageOptions('101'), () => undefined)).toBe(true);
		expect(registration.showNotification).not.toHaveBeenCalled();
		// A newer message still shows, as usual (not silent).
		expect(await showNotification('ada · General', messageOptions('102'), () => undefined)).toBe(true);
		expect(registration.list.map((entry) => entry.options.silent)).toEqual([undefined]);
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
	it('falls back to the user_id, and says only that a message arrived when the body was left out', () => {
		const shown = pushNotification({ message_id: '1', room_id: 'ops', from: { user_id: 'bob', name: ' ' } }, 'a1');
		expect(shown?.title).toBe('bob · ops');
		expect(shown?.options.body).toBe('New message');
		expect(pushNotification({ message_id: '1', room_id: 'ops', body: { text: 'hi' } }, 'a1')?.title).toBe('Someone · ops');
	});

	it('shortens a long body', () => {
		expect(notificationBody('x'.repeat(200))).toBe(`${'x'.repeat(179)}…`);
		expect(pushNotification({ message_id: '1', room_id: 'ops', from: { user_id: 'bob' }, body: { text: 'y'.repeat(181) } }, 'a1')?.options.body).toHaveLength(180);
	});

	it('shows nothing for a payload that isn\'t a message, or lacks its push_id or message_id', () => {
		expect(pushNotification(undefined, 'a1')).toBeUndefined();
		expect(pushNotification('hello', 'a1')).toBeUndefined();
		expect(pushNotification({ message_id: '1', from: { user_id: 'bob' }, body: { text: 'no room' } }, 'a1')).toBeUndefined();
		expect(pushNotification({ room_id: 'ops', from: { user_id: 'bob' }, body: { text: 'no id' } }, 'a1')).toBeUndefined();
		expect(pushNotification({ message_id: '1', room_id: 'ops', from: { user_id: 'bob' } }, undefined)).toBeUndefined();
		expect(readPush({ message: { message_id: '1', room_id: 'ops', from: { user_id: 'bob' } } })).toEqual({ unreadable: true });
	});

	it('reads a push click target, and tells it apart from a page notification\'s', () => {
		const data = pushNotification({ message_id: '7', room_id: 'general' }, 'a1')!.options.data;
		const target = { push: true, roomId: 'general', pushId: 'a1', messageId: '7', group: 'a1:general' };
		expect(pushTarget(data)).toEqual(target);
		expect(pushTarget({ tab: 't1', server: 'wss://chat.example/', roomId: 'general' })).toBeUndefined();
		expect(pushClickTarget({ type: PUSH_CLICK, target: data })).toEqual(target);
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
		expect(pushRoute({ pushId: 'a1' }, 'a1')).toBe('open');
		expect(pushRoute({ pushId: 'a1' }, 'b2')).toBe('ignore');
		expect(pushRoute({ pushId: 'a1' }, undefined)).toBe('wait');
		// A page notification from an account without one: whichever tab opened for it.
		expect(pushRoute({}, 'a1')).toBe('open');
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
		/** A notification showing a room's message, as the service worker lists it. */
		const showing = (id: string, room = 'general', title = `bob · ${room}`) => {
			const options = messageOptions(id, room);
			return { title, body: options.body ?? '', tag: options.tag ?? '', data: options.data, icon: '' };
		};
		const other = { title: 'Apron', body: 'hi', tag: 'apron:other', data: undefined, icon: '' };

		it('shows a new message, closing older ones of its room after', () => {
			const plan = planPush(push('12', 'general', { unread: 3 }), [showing('11')], { enabled: ['a1'] });
			expect(plan.show?.options.tag).toBe('apron:a1:12');
			expect(plan.show?.options.renotify).toBe(false);
			expect(plan.notified).toEqual({ group: 'a1:general', messageId: '12' });
			expect(plan.badge).toBe(3);
		});

		it('replaces the same message quietly, keeping the title showing (an edit that newly mentions you)', () => {
			const plan = planPush(push('5'), [showing('5', 'general', 'bob · General')]);
			expect(plan.show).toEqual({ title: 'bob · General', options: { ...push('5')!.notification!.options, renotify: false, silent: true } });
			expect(plan.notified).toBeUndefined();
		});

		it('leaves the page\'s notifications of m1 and m2 as they are when a late push of m1 arrives', () => {
			// The page showed m1, then m2, which closed m1. Browsers still need a notification for the push:
			// m2 shows again, as it was, quietly.
			const plan = planPush(push('1'), [showing('2')], { marks: { 'a1:general': '2' } });
			expect(plan.show?.title).toBe('bob · general');
			expect(plan.show?.options).toMatchObject({ tag: 'apron:a1:2', body: 'message 2', renotify: false, silent: true });
			expect(plan.notified).toBeUndefined();
		});

		it('shows a dismissed message again only quietly, and only when nothing else is showing', () => {
			const plan = planPush(push('7'), [], { marks: { 'a1:general': '7' } });
			expect(plan.show?.options).toMatchObject({ tag: 'apron:a1:7', renotify: false, silent: true });
			expect(plan.notified).toBeUndefined();
			// Another notification showing: that one shows again, as it is.
			expect(planPush(push('7'), [showing('3', 'ops')], { marks: { 'a1:general': '7' } }).show?.options.tag).toBe('apron:a1:3');
		});

		it('drops a push for an account push isn\'t on for, without setting the badge, still showing something', () => {
			const plan = planPush(push('8', 'general', { unread: 9 }), [], { enabled: ['b2'] });
			expect(plan).toEqual({ show: QUIET_PUSH });
			expect(planPush(push('8', 'general', { unread: 9 }), [other], { enabled: ['b2'] })).toEqual({ show: { title: 'Apron', options: { body: 'hi', tag: 'apron:other', data: undefined, renotify: false, silent: true } } });
			// Unknown before IndexedDB has the list: shown.
			expect(planPush(push('8'), []).show?.options.tag).toBe('apron:a1:8');
		});

		it('fails closed when the enabled accounts couldn\'t be read: only the quiet stand-in, no preview, no badge', () => {
			expect(planPush(push('8', 'general', { unread: 9 }), [], { enabled: 'unreadable' })).toEqual({ show: QUIET_PUSH });
			expect(planPush(push('8', 'general', { unread: 9 }), [showing('7')], { enabled: 'unreadable' })).toEqual({ show: QUIET_PUSH });
			expect(planPush(readPush({ push_id: 'a1', unread: 4 }), [], { enabled: 'unreadable' })).toEqual({});
		});

		it('shows the quiet stand-in, never an older message, when nothing is showing', () => {
			expect(planPush(push('6'), [], { marks: { 'a1:general': '7' } })).toEqual({ show: QUIET_PUSH });
		});

		it('never shows a notification for a badge push, only sets the badge', () => {
			expect(planPush(readPush({ push_id: 'a1', unread: 0 }), [], { enabled: ['a1'] })).toEqual({ badge: 0 });
			expect(planPush(readPush({ push_id: 'a1', unread: 4 }), [other])).toEqual({ badge: 4 });
		});

		it('shows the quiet stand-in for an unreadable push, or a message it can\'t show, with nothing showing', () => {
			expect(planPush(undefined, []).show).toEqual(QUIET_PUSH);
			expect(planPush(readPush({ push_id: 'a1', message: { body: { text: 'no room' } } }), [])).toEqual({ show: QUIET_PUSH });
			expect(planPush(undefined, [other]).show?.options.tag).toBe('apron:other');
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
		expect(readPush({ unread: -1, message: 'nope' })).toEqual({ unreadable: true });
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
