import { describe, expect, it, vi } from 'vitest';
import { PUSH_CLICK, NOTIFICATION_CLICK, type ShowNotificationOptions } from './notifications';
import { withShown } from './push-store';
import { anyWindowVisible, appWindows, handleClick, handlePush, isNewerMessage, type PushContext, type Tab } from './sw-handlers';

/** A service worker registration's notifications: one per tag, a newer one with a tag replacing the older. */
function fakeRegistration() {
	type Shown = { title: string; body: string; tag: string; data: unknown; icon: string; options: ShowNotificationOptions; close: () => void };
	const list: Shown[] = [];
	return {
		list,
		showNotification: vi.fn(async (title: string, options: ShowNotificationOptions) => {
			const at = list.findIndex((entry) => entry.tag === options.tag);
			const entry: Shown = { title, body: options.body ?? '', tag: options.tag ?? '', data: options.data, icon: options.icon ?? '', options, close: () => { const index = list.indexOf(entry); if (index >= 0) list.splice(index, 1); } };
			if (at >= 0) list.splice(at, 1, entry); else list.push(entry);
		}),
		getNotifications: async () => [...list]
	};
}

function context(overrides: Partial<PushContext> = {}) {
	const registration = fakeRegistration();
	let marks: Record<string, string> = {};
	const setBadge = vi.fn(async () => undefined);
	const value: PushContext = {
		registration,
		loadEnabled: async () => ['a1'],
		loadMarks: async () => marks,
		markShown: async (group, messageId) => { marks = withShown(marks, group, messageId, isNewerMessage) ?? marks; },
		setBadge,
		pageVisible: async () => false,
		icon: '/icon-192.png',
		...overrides
	};
	return { value, registration, setBadge, marks: () => marks };
}

const payload = (id: string, extra: Record<string, unknown> = {}) => () => ({ push_id: 'a1', message: { message_id: id, room_id: 'general', from: { user_id: 'bob', name: 'Bob' }, body: { text: `message ${id}` } }, ...extra });

// What to show for a push is `planPush`'s decision, tested in `notifications.test.ts` › planning a push. Here:
// what the handler does with it that the plan can't see.
describe('the push handler', () => {
	it('shows new messages, closing the room\'s older ones, and remembers the newest', async () => {
		const { value, registration, setBadge, marks } = context();
		await handlePush(payload('10', { unread: 1 }), value);
		await handlePush(payload('11', { unread: 2 }), value);
		expect(registration.list.map((entry) => entry.tag)).toEqual(['apron:a1:11']);
		expect(registration.list[0].options).toMatchObject({ icon: '/icon-192.png', renotify: false });
		expect(marks()).toEqual({ 'a1:general': '11' });
		expect(setBadge).toHaveBeenLastCalledWith(2);
	});

	it('leaves the badge to a page in view', async () => {
		const { value, setBadge } = context({ pageVisible: async () => true });
		await handlePush(() => ({ push_id: 'a1', unread: 3 }), value);
		expect(setBadge).not.toHaveBeenCalled();
	});

	it('shows nothing for a badge push, and the stand-in for one it can\'t read', async () => {
		const { value, registration, setBadge } = context();
		await handlePush(() => ({ push_id: 'a1', unread: 0 }), value);
		expect(registration.list).toEqual([]);
		expect(setBadge).toHaveBeenCalledWith(0);
		await handlePush(() => { throw new SyntaxError('not JSON'); }, value);
		expect(registration.list.map((entry) => entry.tag)).toEqual(['apron:push']);
	});
});

describe('the notification click handler', () => {
	function tab(pushId?: string) {
		return { pushId, postMessage: vi.fn(), focus: vi.fn(async () => undefined) };
	}
	function clicks(tabs: Array<ReturnType<typeof tab>>) {
		const openWindow = vi.fn(async () => undefined);
		return { openWindow, context: { tabs: async () => tabs, openWindow, askPushId: async (t: Tab & { pushId?: string }) => t.pushId, page: '/' } };
	}

	it('opens a pushed room in the tab signed in to its account', async () => {
		const other = tab('b2');
		const mine = tab('a1');
		const { openWindow, context: c } = clicks([other, mine]);
		await handleClick({ push: true, roomId: 'general', pushId: 'a1' }, c);
		expect(mine.postMessage).toHaveBeenCalledWith({ type: PUSH_CLICK, target: { push: true, roomId: 'general', pushId: 'a1' } });
		expect(mine.focus).toHaveBeenCalled();
		expect(other.postMessage).not.toHaveBeenCalled();
		expect(openWindow).not.toHaveBeenCalled();
	});

	it('opens a new tab at the room when no tab is signed in to its account', async () => {
		const { openWindow, context: c } = clicks([tab('b2')]);
		await handleClick({ push: true, roomId: 'general', pushId: 'a1' }, c);
		expect(openWindow).toHaveBeenCalledWith('/?push_room=general&push_id=a1');
	});

	it('routes the page\'s notification by its room once its tab has gone', async () => {
		const { openWindow, context: c } = clicks([]);
		await handleClick({ tab: 't1', server: 'wss://a/', roomId: 'general', threadId: 'th1' }, c);
		expect(openWindow).toHaveBeenCalledWith('/?push_room=th1');
	});

	it('tells every tab about the page\'s notification, so the one that raised it opens the room', async () => {
		const first = tab();
		const second = tab();
		const { context: c } = clicks([first, second]);
		const data = { tab: 't1', server: 'wss://a/', roomId: 'general' };
		await handleClick(data, c);
		expect(second.postMessage).toHaveBeenCalledWith({ type: NOTIFICATION_CLICK, target: data });
		expect(first.focus).toHaveBeenCalled();
	});
});

describe('the app\'s windows', () => {
	it('include those the service worker doesn\'t control yet', async () => {
		const matchAll = vi.fn(async () => [{ visibilityState: 'hidden' as const }, { visibilityState: 'visible' as const }]);
		expect(await anyWindowVisible({ matchAll })).toBe(true);
		expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
		await appWindows({ matchAll });
		expect(matchAll).toHaveBeenLastCalledWith({ type: 'window', includeUncontrolled: true });
		expect(await anyWindowVisible({ matchAll: async () => [{ visibilityState: 'hidden' as const }] })).toBe(false);
	});
});

describe('remembering what a room notified about', () => {
	it('keeps the newest message per group, the most recent groups only', () => {
		expect(withShown({}, 'g', '5', isNewerMessage)).toEqual({ g: '5' });
		expect(withShown({ g: '5' }, 'g', '4', isNewerMessage)).toBeUndefined();
		expect(withShown({ g: '5' }, 'g', '5', isNewerMessage)).toBeUndefined();
		expect(withShown({ g: '5', h: '1' }, 'g', '10', isNewerMessage)).toEqual({ h: '1', g: '10' });
		const many = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`g${index}`, '1']));
		const next = withShown(many, 'new', '1', isNewerMessage)!;
		expect(Object.keys(next)).toHaveLength(200);
		expect(next.g0).toBeUndefined();
		expect(next.new).toBe('1');
	});
});
