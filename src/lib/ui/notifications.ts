const ENABLED_KEY = 'apron.desktopNotifications';
const SCOPE_KEY = 'apron.notificationScope';

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';
export type NotificationTestResult = 'sent' | 'denied' | 'unsupported' | 'error';
export type NotificationScope = 'everything' | 'mentions';

export function loadNotificationScope(): NotificationScope {
	try {
		const saved = globalThis.localStorage?.getItem(SCOPE_KEY);
		return saved === 'everything' ? 'everything' : 'mentions';
	} catch {
		return 'mentions';
	}
}

export function saveNotificationScope(scope: NotificationScope): void {
	try {
		globalThis.localStorage?.setItem(SCOPE_KEY, scope);
	} catch {
		// Keep the selected scope for this visit when storage is unavailable.
	}
}

export function loadNotificationsEnabled(): boolean {
	try {
		return globalThis.localStorage?.getItem(ENABLED_KEY) === 'true';
	} catch {
		return false;
	}
}

export function saveNotificationsEnabled(enabled: boolean): void {
	try {
		if (enabled) globalThis.localStorage?.setItem(ENABLED_KEY, 'true');
		else globalThis.localStorage?.removeItem(ENABLED_KEY);
	} catch {
		// Notifications still work for this visit when storage is unavailable.
	}
}

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
