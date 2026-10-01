import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_CLICK, PUSH_CLICK, notificationBody, notificationClickTarget, pushClickTarget, pushNotification, pushTarget, showNotification } from './notifications';

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

	it('shows the page\'s own notification when it can', async () => {
		stubPermission('granted', () => undefined);
		expect(await showNotification('ada · general', { body: 'hi' }, () => undefined)).toBe(true);
	});

	it('falls back to the service worker where the page may not show one', async () => {
		const shown = vi.fn(async () => undefined);
		stubPermission('granted', () => { throw new TypeError('Illegal constructor'); });
		vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ showNotification: shown }) } });
		expect(await showNotification('ada · general', { body: 'hi', tag: 'apron:x' }, () => undefined)).toBe(true);
		expect(shown).toHaveBeenCalledWith('ada · general', { body: 'hi', tag: 'apron:x' });
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
});
