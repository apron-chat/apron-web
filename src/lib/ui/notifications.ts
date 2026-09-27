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
