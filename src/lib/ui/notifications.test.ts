import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_CLICK, notificationClickTarget, showNotification } from './notifications';

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
