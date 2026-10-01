import { isJsonObject } from '$lib/protocol/types';

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';
export type NotificationTestResult = 'sent' | 'denied' | 'unsupported' | 'error';
export type NotificationScope = 'everything' | 'mentions';

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
 * message: the server's push `tag` (§4.7), the message, and its `group`, the
 * room whose newer notification closes this one.
 */
export interface MessageNotificationData {
	tag?: string;
	messageId?: string;
	group?: string;
}

/**
 * The notification tag of a message on the server with this push `tag`.
 * The page and the service worker use the same one, so a message shows at
 * most once (§4.7): whichever comes second replaces the first, quietly
 * (`renotify: false`).
 */
export function messageNotificationTag(tag: string, messageId: string): string {
	return `apron:${tag}:${messageId}`;
}

/** The group of a message notification: one room on one server, which shows only its newest. */
export function notificationGroup(tag: string, roomId: string): string {
	return `${tag}:${roomId}`;
}

type ShownNotification = Pick<Notification, 'tag' | 'data' | 'close'>;

/** Closes the notifications of a group but the one with this tag: its room's newer message replaces them. */
export function closeOlderInGroup(notifications: readonly ShownNotification[], group: string, tag: string): void {
	for (const notification of notifications) {
		if (notification.tag !== tag && isJsonObject(notification.data) && notification.data.group === group) notification.close();
	}
}

/** The page's own notifications, by group (the service worker's are listed by its registration). */
const pageNotifications = new Map<string, Notification>();

/** What the service worker posts to the app's tabs when one of its notifications is clicked. */
export const NOTIFICATION_CLICK = 'apron:notification-click';

/** `renotify` is standard but missing from TypeScript's DOM types. */
export type ShowNotificationOptions = NotificationOptions & { renotify?: boolean };

/**
 * Shows a notification from the page, or through the service worker where the
 * page may not (Android Chrome's `Notification` constructor throws). Resolves
 * whether one was shown. `onclick` handles a click on the page's own
 * notification; a click on the service worker's posts `NOTIFICATION_CLICK`.
 */
export async function showNotification(title: string, options: ShowNotificationOptions, onclick: () => void): Promise<boolean> {
	if (notificationPermission() !== 'granted') return false;
	const group = isJsonObject(options.data) && typeof options.data.group === 'string' ? options.data.group : undefined;
	const registration = await globalThis.navigator?.serviceWorker?.getRegistration().catch(() => undefined);
	const closeOlder = async () => {
		if (group === undefined || options.tag === undefined) return;
		const older = pageNotifications.get(group);
		if (older) closeOlderInGroup([older], group, options.tag);
		closeOlderInGroup(await registration?.getNotifications().catch(() => []) ?? [], group, options.tag);
	};
	try {
		const notification = new Notification(title, options);
		notification.onclick = () => {
			onclick();
			notification.close();
		};
		await closeOlder();
		if (group !== undefined) {
			pageNotifications.set(group, notification);
			notification.onclose = () => {
				if (pageNotifications.get(group) === notification) pageNotifications.delete(group);
			};
		}
		return true;
	} catch {
		// Only the service worker may show notifications here.
	}
	try {
		if (!registration) return false;
		await registration.showNotification(title, options);
		await closeOlder();
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
 * Where a click on a push notification leads: a room on the server this
 * device's push subscription is for. It is the notification's `data`.
 */
export interface PushTarget extends MessageNotificationData {
	push: true;
	roomId: string;
}

/** What the service worker posts to the app's tabs when one of its push notifications is clicked. */
export const PUSH_CLICK = 'apron:push-click';

/** The query parameters that carry a push notification's room, and its server's push `tag`, into a window opened for it. */
export const PUSH_ROOM_PARAM = 'push_room';
export const PUSH_TAG_PARAM = 'push_tag';

/**
 * The notification for a push payload (§4.7): a message object, whose `body`
 * may be truncated or missing, with the registration's `tag`. Undefined for
 * anything else. With a `tag` it is the message's own notification, which
 * the page's for the same message replaces quietly, and the other way round;
 * without one (an older server), a newer push for the room replaces it.
 */
export function pushNotification(payload: unknown): { title: string; options: ShowNotificationOptions } | undefined {
	if (!isJsonObject(payload) || typeof payload.room_id !== 'string' || !payload.room_id) return undefined;
	const roomId = payload.room_id;
	const from = isJsonObject(payload.from) ? payload.from : {};
	const sender = [from.name, from.user_id].find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? 'Someone';
	const text = isJsonObject(payload.body) && typeof payload.body.text === 'string' ? payload.body.text : undefined;
	const body = notificationBody(text) || 'New message';
	const tag = typeof payload.tag === 'string' && payload.tag ? payload.tag : undefined;
	const messageId = typeof payload.message_id === 'string' && payload.message_id ? payload.message_id : undefined;
	if (tag === undefined || messageId === undefined) {
		const target: PushTarget = { push: true, roomId };
		return { title: `${sender} · ${roomId}`, options: { body, tag: `apron:push:${roomId}`, renotify: true, data: target } };
	}
	const target: PushTarget = { push: true, roomId, tag, messageId, group: notificationGroup(tag, roomId) };
	return { title: `${sender} · ${roomId}`, options: { body, tag: messageNotificationTag(tag, messageId), renotify: false, data: target } };
}

/** A push notification's target, read from its `data`, if it is one. */
export function pushTarget(data: unknown): PushTarget | undefined {
	if (!isJsonObject(data) || data.push !== true || typeof data.roomId !== 'string' || !data.roomId) return undefined;
	const text = (key: string) => (typeof data[key] === 'string' && data[key] ? { [key]: data[key] } : {});
	return { push: true, roomId: data.roomId, ...text('tag'), ...text('messageId'), ...text('group') };
}

/**
 * What a tab does with a pushed room: open it when the push tag is its
 * server's, or, for a push without a tag (an older server), when its server
 * holds this browser's push subscription; wait while its own tag is still
 * being worked out; otherwise leave it to another tab.
 */
export function pushRoute(target: Pick<PushTarget, 'tag'>, serverTag: string | undefined, subscribed: boolean): 'open' | 'wait' | 'ignore' {
	if (target.tag === undefined) return subscribed ? 'open' : 'ignore';
	if (serverTag === undefined) return 'wait';
	return target.tag === serverTag ? 'open' : 'ignore';
}

/** A `PUSH_CLICK` message's target, if the message is one. */
export function pushClickTarget(message: unknown): PushTarget | undefined {
	return isJsonObject(message) && message.type === PUSH_CLICK ? pushTarget(message.target) : undefined;
}
