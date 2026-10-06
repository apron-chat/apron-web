import { compareLogIds } from '$lib/protocol/reducer';
import { isJsonObject } from '$lib/protocol/types';
import { loadShownMarks, markShown } from './push-store';

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';
export type NotificationTestResult = 'sent' | 'denied' | 'unsupported' | 'error';

export function notificationPermission(): NotificationPermissionState {
	if (typeof Notification === 'undefined' || !globalThis.isSecureContext) return 'unsupported';
	return Notification.permission;
}

/** Called only from an explicit user action; browsers reject unsolicited permission prompts. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
	if (typeof Notification === 'undefined' || !globalThis.isSecureContext) return 'unsupported';
	try {
		return await Notification.requestPermission();
	} catch {
		return 'unsupported';
	}
}

/** Where a click on a message notification leads: the tab and backend that raised it, and the room or thread. */
export interface NotificationTarget extends MessageNotificationData {
	tab: string;
	server: string;
	roomId: string;
	threadId?: string;
}

/**
 * What a message notification, the page's or a pushed one, says about its
 * message: the account's `push_id` (§4.9), the message, and its `group`, the
 * room whose newer notification closes this one.
 */
export interface MessageNotificationData {
	pushId?: string;
	messageId?: string;
	group?: string;
}

/**
 * The notification tag of a message for the account with this `push_id`.
 * The page and the service worker use the same one, so a message shows at
 * most once (§4.9): whichever comes second replaces the first, quietly
 * (`renotify: false`).
 */
export function messageNotificationTag(pushId: string, messageId: string): string {
	return `apron:${pushId}:${messageId}`;
}

/** The group of a message notification: one room for one account, which shows only its newest. */
export function notificationGroup(pushId: string, roomId: string): string {
	return `${pushId}:${roomId}`;
}

type ShownNotification = Pick<Notification, 'tag' | 'data' | 'close'>;

/** Where a message notification sits: its group (a room for an account) and its message, from its `data`. */
function placeOf(data: unknown): { group: string; messageId: string } | undefined {
	if (!isJsonObject(data) || typeof data.group !== 'string' || typeof data.messageId !== 'string') return undefined;
	return { group: data.group, messageId: data.messageId };
}

/**
 * The newest message a group has notified about: among the notifications
 * showing, and `mark`, the newest it notified about before (perhaps
 * dismissed since). `message_id`s order by creation (§3.5).
 */
function newestNotified(visible: readonly Pick<ShownNotification, 'data'>[], group: string, mark?: string): string | undefined {
	let newest = mark;
	for (const notification of visible) {
		const place = placeOf(notification.data);
		if (place?.group === group && (newest === undefined || compareLogIds(place.messageId, newest) > 0)) newest = place.messageId;
	}
	return newest;
}

/** Closes a group's notifications of messages strictly older than this one: its room's newer message replaces them. */
export function closeOlderInGroup(notifications: readonly ShownNotification[], group: string, messageId: string): void {
	for (const notification of notifications) {
		const place = placeOf(notification.data);
		if (place?.group === group && compareLogIds(place.messageId, messageId) < 0) notification.close();
	}
}

const newer = (a: string, b: string) => compareLogIds(a, b) > 0;

/** The page's own notifications, by group, where there is no service worker to list them. */
const pageNotifications = new Map<string, Notification>();

/** What the service worker posts to the app's tabs when one of its notifications is clicked. */
export const NOTIFICATION_CLICK = 'apron:notification-click';

/** `renotify` is standard but missing from TypeScript's DOM types. */
export type ShowNotificationOptions = NotificationOptions & { renotify?: boolean };

/**
 * Shows a notification through the service worker, so it shares tags with
 * pushed ones (§4.9) and can be listed and closed, or from the page where
 * there is no service worker. Resolves whether one was shown, or the
 * message already was (by a push, or before): a message notification shows
 * at most once per `push_id` and `message_id`, and never under a newer one
 * of its room. One still showing (a push's, say) is replaced by the page's
 * quietly (same tag, `renotify: false`, silent); one dismissed stays gone. `onclick` handles a
 * click on the page's own notification; a click on the service worker's
 * posts `NOTIFICATION_CLICK`.
 */
export async function showNotification(title: string, options: ShowNotificationOptions, onclick: () => void): Promise<boolean> {
	if (notificationPermission() !== 'granted') return false;
	const place = placeOf(options.data);
	const group = place?.group;
	const registration = await globalThis.navigator?.serviceWorker?.getRegistration().catch(() => undefined);
	if (registration) {
		try {
			let shownOptions = options;
			if (place) {
				const visible = await registration.getNotifications();
				const newest = newestNotified(visible, place.group, (await loadShownMarks())[place.group]);
				const order = newest === undefined ? 1 : compareLogIds(place.messageId, newest);
				if (order < 0) return true;
				if (order === 0) {
					// Already notified: replace it quietly while it shows (a push's, say), never bring it back once dismissed.
					const same = visible.some((shown) => { const at = placeOf(shown.data); return at?.group === place.group && at.messageId === place.messageId; });
					if (!same) return true;
					shownOptions = { ...options, renotify: false, silent: true };
				}
			}
			await registration.showNotification(title, shownOptions);
			if (place) {
				closeOlderInGroup(await registration.getNotifications(), place.group, place.messageId);
				await markShown(place.group, place.messageId, newer);
			}
			return true;
		} catch {
			// Not active yet: the page shows its own.
		}
	}
	try {
		const notification = new Notification(title, options);
		notification.onclick = () => {
			onclick();
			notification.close();
		};
		if (group !== undefined && place) {
			const older = pageNotifications.get(group);
			if (older) closeOlderInGroup([older], group, place.messageId);
			pageNotifications.set(group, notification);
			notification.onclose = () => {
				if (pageNotifications.get(group) === notification) pageNotifications.delete(group);
			};
		}
		return true;
	} catch {
		return false;
	}
}

/** A `NOTIFICATION_CLICK` message's target, if the message is one. */
export function notificationClickTarget(message: unknown): NotificationTarget | undefined {
	if (!message || typeof message !== 'object') return undefined;
	const { type, target } = message as { type?: unknown; target?: unknown };
	if (type !== NOTIFICATION_CLICK || !target || typeof target !== 'object') return undefined;
	const { tab, server, roomId, threadId } = target as Record<string, unknown>;
	if (typeof tab !== 'string' || typeof server !== 'string' || typeof roomId !== 'string') return undefined;
	if (threadId !== undefined && typeof threadId !== 'string') return undefined;
	return { tab, server, roomId, ...(threadId !== undefined ? { threadId } : {}) };
}

/** A message's text as a notification body: one line, at most 180 characters. */
export function notificationBody(text: string | undefined): string {
	const line = text?.replace(/\s+/g, ' ').trim() ?? '';
	return line.length > 180 ? `${line.slice(0, 179)}…` : line;
}

/**
 * Where a click on a push notification leads: a room for the account its
 * `push_id` names. It is the notification's `data`.
 */
export interface PushTarget extends MessageNotificationData {
	push: true;
	roomId: string;
}

/** What the service worker posts to the tab it picks when one of its push notifications is clicked. */
export const PUSH_CLICK = 'apron:push-click';

/** What the service worker asks each tab, with a port to answer on: `{pushId}` of the account it is signed in to. */
export const PUSH_ID_QUERY = 'apron:push-id';

/** The query parameters that carry a push notification's room, and its `push_id`, into a window opened for it. */
export const PUSH_ROOM_PARAM = 'push_room';
export const PUSH_ID_PARAM = 'push_id';

/** What a push payload (§4.9) carries: the registration's `push_id`, the user's `unread` count, and the notification for its `message`. */
export interface PushPayload {
	pushId?: string;
	unread?: number;
	notification?: { title: string; options: ShowNotificationOptions };
	/** It has a `message` that isn't one this client can show. */
	unreadable?: true;
}

/**
 * Reads a push payload (§4.9): an object with `push_id`, `unread` and
 * `message`, ignoring other fields. Without `message` (a badge push) there
 * is no notification. Undefined for anything but an object.
 */
export function readPush(payload: unknown): PushPayload | undefined {
	if (!isJsonObject(payload)) return undefined;
	const pushId = typeof payload.push_id === 'string' && payload.push_id ? payload.push_id : undefined;
	const unread = typeof payload.unread === 'number' && Number.isInteger(payload.unread) && payload.unread >= 0 ? payload.unread : undefined;
	const notification = Object.hasOwn(payload, 'message') ? pushNotification(payload.message, pushId) : undefined;
	const unreadable = Object.hasOwn(payload, 'message') && !notification;
	return { ...(pushId ? { pushId } : {}), ...(unread !== undefined ? { unread } : {}), ...(notification ? { notification } : {}), ...(unreadable ? { unreadable: true as const } : {}) };
}

/**
 * Shown when a push brings nothing to show and none of this origin's
 * notifications is showing: browsers expect each push to leave one showing,
 * and WebKit revokes a subscription whose pushes don't.
 */
export const QUIET_PUSH = { title: 'Apron', options: { body: 'Open Apron to catch up.', tag: 'apron:push', renotify: false, silent: true } satisfies ShowNotificationOptions };

/** A notification showing, as the service worker lists it. */
type VisibleNotification = Pick<Notification, 'title' | 'body' | 'tag' | 'data' | 'icon'>;

/** What to do with a push. */
interface PushPlan {
	show?: { title: string; options: ShowNotificationOptions };
	/** After showing, close the group's notifications of older messages, and remember this one. */
	notified?: { group: string; messageId: string };
	/** Set the app badge to this unread count. */
	badge?: number;
}

/** A notification shown again as it is, quietly: it changes nothing anyone sees. */
function again(notification: VisibleNotification): { title: string; options: ShowNotificationOptions } {
	return {
		title: notification.title,
		options: { body: notification.body, tag: notification.tag, data: notification.data, ...(notification.icon ? { icon: notification.icon } : {}), renotify: false, silent: true }
	};
}

/**
 * Plans a push (`readPush`; undefined when it can't be read). A push for a
 * `push_id` not among `enabled` (when known) is dropped (§4.9), and doesn't
 * set the badge; when the list couldn't be read (`unreadable`), a push with a
 * `push_id` may be any account's, so it shows only `QUIET_PUSH`, without its
 * preview or the badge. A new message shows and closes its room's older ones. The
 * same message again (an edit, say) replaces its notification quietly,
 * keeping its title. A message the room already notified about and that was
 * dismissed doesn't notify again, and one older than the room's newest never
 * shows: with nothing showing, `QUIET_PUSH` stands in.
 *
 * Every push but a badge push (no `message`, never shown, §4.9) shows
 * something, as browsers require: what is showing, shown again as it is
 * (the room's newest, else any), else the message quietly, else `QUIET_PUSH`.
 */
export function planPush(push: PushPayload | undefined, visible: readonly VisibleNotification[], known: { enabled?: readonly string[] | 'unreadable'; marks?: Record<string, string> } = {}): PushPlan {
	const enabled = known.enabled;
	// Fail closed: whose a push is can't be told without the list.
	if (push?.pushId !== undefined && enabled === 'unreadable') return push.notification || push.unreadable ? { show: QUIET_PUSH } : {};
	const dropped = push?.pushId !== undefined && Array.isArray(enabled) && !enabled.includes(push.pushId);
	const plan: PushPlan = !dropped && push?.unread !== undefined ? { badge: push.unread } : {};
	const quietly = (preferred?: VisibleNotification) => {
		const showing = preferred ?? visible[0];
		return showing ? again(showing) : QUIET_PUSH;
	};
	if (!push || dropped || push.unreadable) return { ...plan, show: quietly() };
	const notification = push.notification;
	if (!notification) return plan;
	const place = placeOf(notification.options.data);
	if (!place) return { ...plan, show: notification };
	const newest = newestNotified(visible, place.group, known.marks?.[place.group]);
	const order = newest === undefined ? 1 : compareLogIds(place.messageId, newest);
	if (order > 0) return { ...plan, show: notification, notified: place };
	const same = visible.find((shown) => shown.tag === notification.options.tag);
	if (order === 0 && same) return { ...plan, show: { title: same.title, options: { ...notification.options, renotify: false, silent: true } } };
	if (!visible.length) return { ...plan, show: order < 0 ? QUIET_PUSH : { title: notification.title, options: { ...notification.options, renotify: false, silent: true } } };
	return { ...plan, show: quietly(visible.find((shown) => placeOf(shown.data)?.group === place.group && placeOf(shown.data)?.messageId === newest)) };
}

/**
 * The notification for a pushed message (a message object, whose `body` may
 * be truncated or missing), for the registration with this `push_id`.
 * Undefined for anything else. With a `push_id` it is the message's own
 * notification, which replaces the page's for the same message quietly, and
 * the other way round; without one (an older server), a newer push for the
 * room replaces it.
 */
export function pushNotification(message: unknown, pushId?: string): { title: string; options: ShowNotificationOptions } | undefined {
	if (!isJsonObject(message) || typeof message.room_id !== 'string' || !message.room_id) return undefined;
	const roomId = message.room_id;
	const from = isJsonObject(message.from) ? message.from : {};
	const sender = [from.name, from.user_id].find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? 'Someone';
	const text = isJsonObject(message.body) && typeof message.body.text === 'string' ? message.body.text : undefined;
	const body = notificationBody(text) || 'New message';
	const messageId = typeof message.message_id === 'string' && message.message_id ? message.message_id : undefined;
	if (pushId === undefined || messageId === undefined) {
		const target: PushTarget = { push: true, roomId };
		return { title: `${sender} · ${roomId}`, options: { body, tag: `apron:push:${roomId}`, renotify: true, data: target } };
	}
	const target: PushTarget = { push: true, roomId, pushId, messageId, group: notificationGroup(pushId, roomId) };
	return { title: `${sender} · ${roomId}`, options: { body, tag: messageNotificationTag(pushId, messageId), renotify: false, data: target } };
}

/** The app badge API, where the browser has it (`navigator` in a page or a service worker). */
export interface BadgeNavigator {
	setAppBadge?: (count?: number) => Promise<void>;
	clearAppBadge?: () => Promise<void>;
}

/** Shows the unread count as the app badge, clearing it at 0, where the browser supports badges. */
export async function setAppBadge(nav: BadgeNavigator | undefined, unread: number): Promise<void> {
	try {
		if (unread > 0) await nav?.setAppBadge?.(unread);
		else await nav?.clearAppBadge?.();
	} catch {
		// Badges are a nicety: not installed, or not allowed.
	}
}

/** A push notification's target, read from its `data`, if it is one. */
export function pushTarget(data: unknown): PushTarget | undefined {
	if (!isJsonObject(data) || data.push !== true || typeof data.roomId !== 'string' || !data.roomId) return undefined;
	const text = (key: string) => (typeof data[key] === 'string' && data[key] ? { [key]: data[key] } : {});
	return { push: true, roomId: data.roomId, ...text('pushId'), ...text('messageId'), ...text('group') };
}

/**
 * What a tab does with a pushed room: open it when the `push_id` is its
 * account's, or, for a push without one (an older server), when its account
 * holds this browser's push subscription; wait while its own `push_id` is
 * still being worked out; otherwise leave it.
 */
export function pushRoute(target: Pick<PushTarget, 'pushId'>, pushId: string | undefined, subscribed: boolean): 'open' | 'wait' | 'ignore' {
	if (target.pushId === undefined) return subscribed ? 'open' : 'ignore';
	if (pushId === undefined) return 'wait';
	return target.pushId === pushId ? 'open' : 'ignore';
}

/**
 * A page notification's place as a push target, for a click with no tab
 * that raised it to open: the room or thread its message is in, and its
 * account's `push_id` if it has one.
 */
export function pageTarget(data: unknown): PushTarget | undefined {
	if (!isJsonObject(data) || typeof data.roomId !== 'string' || !data.roomId || typeof data.tab !== 'string') return undefined;
	const roomId = typeof data.threadId === 'string' && data.threadId ? data.threadId : data.roomId;
	return { push: true, roomId, ...(typeof data.pushId === 'string' && data.pushId ? { pushId: data.pushId } : {}) };
}

/** A `PUSH_CLICK` message's target, if the message is one. */
export function pushClickTarget(message: unknown): PushTarget | undefined {
	return isJsonObject(message) && message.type === PUSH_CLICK ? pushTarget(message.target) : undefined;
}

/**
 * The first of `tabs` (in order) whose account has this `push_id`, asking
 * them all at once with `ask`, which resolves undefined for a tab that
 * doesn't answer in time.
 */
export async function tabWithPushId<T>(tabs: readonly T[], pushId: string, ask: (tab: T) => Promise<string | undefined>): Promise<T | undefined> {
	const answers = await Promise.all(tabs.map((tab) => ask(tab).catch(() => undefined)));
	return tabs.find((_, index) => answers[index] === pushId);
}
