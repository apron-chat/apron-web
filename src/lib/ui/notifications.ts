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
export interface NotificationTarget {
	tab: string;
	server: string;
	roomId: string;
	threadId?: string;
}

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
	try {
		const notification = new Notification(title, options);
		notification.onclick = () => {
			onclick();
			notification.close();
		};
		return true;
	} catch {
		// Only the service worker may show notifications here.
	}
	try {
		const registration = await globalThis.navigator?.serviceWorker?.getRegistration();
		if (!registration) return false;
		await registration.showNotification(title, options);
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
export interface PushTarget {
	push: true;
	roomId: string;
}

/** What the service worker posts to the app's tabs when one of its push notifications is clicked. */
export const PUSH_CLICK = 'apron:push-click';

/** The query parameter that carries a push notification's room into a window opened for it. */
export const PUSH_ROOM_PARAM = 'push_room';

/**
 * The notification for a push payload (§4.7): a message object, whose `body`
 * may be truncated or missing. Undefined for anything else. A newer push for
 * the same room replaces its notification.
 */
export function pushNotification(payload: unknown): { title: string; options: ShowNotificationOptions } | undefined {
	if (!isJsonObject(payload) || typeof payload.room_id !== 'string' || !payload.room_id) return undefined;
	const roomId = payload.room_id;
	const from = isJsonObject(payload.from) ? payload.from : {};
	const sender = [from.name, from.user_id].find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? 'Someone';
	const text = isJsonObject(payload.body) && typeof payload.body.text === 'string' ? payload.body.text : undefined;
	const target: PushTarget = { push: true, roomId };
	return {
		title: `${sender} · ${roomId}`,
		options: { body: notificationBody(text) || 'New message', tag: `apron:push:${roomId}`, renotify: true, data: target }
	};
}

/** A push notification's target, read from its `data`, if it is one. */
export function pushTarget(data: unknown): PushTarget | undefined {
	if (!isJsonObject(data) || data.push !== true || typeof data.roomId !== 'string' || !data.roomId) return undefined;
	return { push: true, roomId: data.roomId };
}

/** A `PUSH_CLICK` message's target, if the message is one. */
export function pushClickTarget(message: unknown): PushTarget | undefined {
	return isJsonObject(message) && message.type === PUSH_CLICK ? pushTarget(message.target) : undefined;
}
