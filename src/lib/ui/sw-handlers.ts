import { compareLogIds } from '$lib/protocol/reducer';
import {
	NOTIFICATION_CLICK, PUSH_CLICK, PUSH_ID_PARAM, PUSH_ID_QUERY, PUSH_ROOM_PARAM,
	closeOlderInGroup, pageTarget, planPush, pushTarget, readPush, tabWithPushId,
	type PushPayload, type ShowNotificationOptions
} from './notifications';

/**
 * The service worker's push and notification-click handlers (§4.7), apart
 * from the worker so they can run against stand-ins.
 */

/** What the push handler needs from the service worker. */
export interface PushContext {
	registration: {
		showNotification(title: string, options: ShowNotificationOptions): Promise<void>;
		getNotifications(): Promise<Array<Notification | (Pick<Notification, 'title' | 'body' | 'tag' | 'data' | 'icon' | 'close'>)>>;
	};
	/** The enabled accounts' `push_id`s: undefined when never saved, `unreadable` when the read failed. */
	loadEnabled(): Promise<string[] | undefined | 'unreadable'>;
	/** The newest message each group notified about. */
	loadMarks(): Promise<Record<string, string>>;
	markShown(group: string, messageId: string): Promise<void>;
	setBadge(unread: number): Promise<void>;
	/** A page of the app is in view: it keeps the badge itself. */
	pageVisible(): Promise<boolean>;
	icon: string;
}

/** Handles a push: its payload, read as JSON (throwing when it isn't). */
export async function handlePush(payload: () => unknown, context: PushContext): Promise<void> {
	let push: PushPayload | undefined;
	try {
		push = readPush(payload());
	} catch {
		push = undefined;
	}
	const [visible, enabled, marks] = await Promise.all([context.registration.getNotifications(), context.loadEnabled(), context.loadMarks()]);
	const plan = planPush(push, visible, { ...(enabled !== undefined ? { enabled } : {}), marks });
	if (plan.badge !== undefined && !(await context.pageVisible())) await context.setBadge(plan.badge);
	if (!plan.show) return;
	await context.registration.showNotification(plan.show.title, { icon: context.icon, ...plan.show.options });
	if (plan.notified) {
		closeOlderInGroup(await context.registration.getNotifications(), plan.notified.group, plan.notified.messageId);
		await context.markShown(plan.notified.group, plan.notified.messageId);
	}
}

/** What `appWindows` needs of the service worker's `clients`. */
interface WindowClients<T> {
	matchAll(options: { type: 'window'; includeUncontrolled: true }): Promise<readonly T[]>;
}

/**
 * The app's windows, those this service worker doesn't control yet
 * included: a tab opened before it took over (the first visit, a hard reload)
 * is still the app's.
 */
export function appWindows<T>(clients: WindowClients<T>): Promise<readonly T[]> {
	return clients.matchAll({ type: 'window', includeUncontrolled: true });
}

/** A page of the app is in view (`appWindows`). */
export async function anyWindowVisible(clients: WindowClients<{ visibilityState: DocumentVisibilityState }>): Promise<boolean> {
	return (await appWindows(clients)).some((tab) => tab.visibilityState === 'visible');
}

/** A window of the app, as the click handler uses it. */
export interface Tab {
	postMessage(message: unknown, transfer?: Transferable[]): void;
	focus(): Promise<unknown>;
}

/** What the click handler needs from the service worker. */
interface ClickContext<T extends Tab> {
	tabs(): Promise<readonly T[]>;
	openWindow(url: string): Promise<unknown>;
	/** Asks a tab for its account's `push_id`; undefined when it doesn't answer. */
	askPushId(tab: T): Promise<string | undefined>;
	/** The app's page, such as `/`. */
	page: string;
}

/**
 * Handles a click on a notification shown through the service worker. One for
 * an account (a push, or the page's with a `push_id`) goes to the tab signed
 * in to that account, or a new tab opens at its room. Otherwise the tabs are
 * told, so the one that raised it opens the room, and the first comes
 * forward; with no tab, a new one opens at the room.
 */
export async function handleClick<T extends Tab>(data: unknown, context: ClickContext<T>): Promise<void> {
	const target = pushTarget(data) ?? pageTarget(data);
	const tabs = await context.tabs();
	if (target?.pushId !== undefined) {
		const tab = await tabWithPushId(tabs, target.pushId, context.askPushId);
		if (tab) {
			tab.postMessage({ type: PUSH_CLICK, target });
			await tab.focus();
		} else {
			await context.openWindow(`${context.page}?${new URLSearchParams({ [PUSH_ROOM_PARAM]: target.roomId, [PUSH_ID_PARAM]: target.pushId })}`);
		}
		return;
	}
	if (!tabs.length) {
		await context.openWindow(target ? `${context.page}?${new URLSearchParams({ [PUSH_ROOM_PARAM]: target.roomId })}` : context.page);
		return;
	}
	const message = pushTarget(data) ? { type: PUSH_CLICK, target: data } : { type: NOTIFICATION_CLICK, target: data };
	for (const tab of tabs) tab.postMessage(message);
	await tabs[0].focus();
}

/** How long a tab has to say which account it is signed in to. */
const PUSH_ID_ANSWER_MS = 500;

/** Asks a tab for its account's `push_id` over a MessageChannel, closed after the answer or the wait. */
export function askPushId(tab: Tab): Promise<string | undefined> {
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const done = (pushId: string | undefined) => {
			clearTimeout(timer);
			channel.port1.close();
			resolve(pushId);
		};
		const timer = setTimeout(() => done(undefined), PUSH_ID_ANSWER_MS);
		channel.port1.onmessage = (event: MessageEvent) => {
			const pushId: unknown = event.data?.pushId;
			done(typeof pushId === 'string' ? pushId : undefined);
		};
		tab.postMessage({ type: PUSH_ID_QUERY }, [channel.port2]);
	});
}

/** Orders `message_id`s by creation (§3.5), for remembering a group's newest. */
export const isNewerMessage = (a: string, b: string) => compareLogIds(a, b) > 0;
