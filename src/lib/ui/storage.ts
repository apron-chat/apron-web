import { isJsonObject, type JsonObject } from '$lib/protocol/types';
import type { AppearancePreferences } from './appearance.svelte';
import type { NotificationScope } from './notifications';

/** Everything this client remembers between visits lives under one prefix. */
const KEY = {
	serverUrl: 'apron.serverUrl',
	displayName: 'apron.displayName',
	recentServers: 'apron.recentServers',
	sidebar: 'apron.sidebar',
	notificationsEnabled: 'apron.desktopNotifications',
	notificationScope: 'apron.notificationScope',
	/** The servers push is turned on for, and the one this browser's push subscription is registered with. */
	webPush: 'apron.webPush',
	webPushServer: 'apron.webPushServer',
	memberList: 'apron.memberList',
	/** app.html reads this one too, to apply the theme before the app loads. */
	appearance: 'apron.appearance'
} as const;

export type RecentServer = { url: string; label?: string };
export type SidebarPrefs = { width: number; collapsed: boolean };

const RECENT_SERVERS_MAX = 5;

function read(key: string): string | null {
	try {
		return globalThis.localStorage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

/** Off for `/__preview`, whose name, servers and layout shouldn't replace the real ones. */
let persisting = true;

/** Keeps every setting this page changes to the page: nothing is saved for the next visit. */
export function keepSettingsInMemory(): void {
	persisting = false;
}

function write(key: string, value: string): void {
	if (!persisting) return;
	try {
		globalThis.localStorage?.setItem(key, value);
	} catch {
		// Private mode or a full quota: the page still works for this visit.
	}
}

export function loadServerUrl(): string | undefined {
	return read(KEY.serverUrl) ?? undefined;
}

export function saveServerUrl(url: string): void {
	write(KEY.serverUrl, url);
}

export function loadDisplayName(): string {
	return read(KEY.displayName) ?? '';
}

export function saveDisplayName(name: string): void {
	write(KEY.displayName, name);
}

export function loadRecentServers(): RecentServer[] {
	try {
		const parsed: unknown = JSON.parse(read(KEY.recentServers) ?? '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(isJsonObject)
			.filter((entry): entry is RecentServer & JsonObject => typeof entry.url === 'string')
			.map((entry) => ({ url: entry.url, ...(typeof entry.label === 'string' ? { label: entry.label } : {}) }))
			.slice(0, RECENT_SERVERS_MAX);
	} catch {
		return [];
	}
}

/** Puts a backend at the head of the recent list, dropping its older entry and the tail. */
export function rememberServer(recent: RecentServer[], url: string, label: string | undefined): RecentServer[] {
	const entry: RecentServer = { url, ...(label ? { label } : {}) };
	const next = [entry, ...recent.filter((server) => server.url !== url)].slice(0, RECENT_SERVERS_MAX);
	write(KEY.recentServers, JSON.stringify(next));
	return next;
}

function loadPanelPrefs(key: string): Partial<SidebarPrefs> {
	try {
		const parsed: unknown = JSON.parse(read(key) ?? '{}');
		if (!isJsonObject(parsed)) return {};
		return {
			...(typeof parsed.width === 'number' && Number.isFinite(parsed.width) && parsed.width > 0 ? { width: parsed.width } : {}),
			...(typeof parsed.collapsed === 'boolean' ? { collapsed: parsed.collapsed } : {})
		};
	} catch {
		return {};
	}
}

export function loadSidebarPrefs(): Partial<SidebarPrefs> {
	return loadPanelPrefs(KEY.sidebar);
}

export function saveSidebarPrefs(prefs: SidebarPrefs): void {
	write(KEY.sidebar, JSON.stringify(prefs));
}

/** The member list's width and whether it's collapsed on wide screens; narrow ones overlay it instead. */
export function loadMemberListPrefs(): Partial<SidebarPrefs> {
	return loadPanelPrefs(KEY.memberList);
}

export function saveMemberListPrefs(prefs: SidebarPrefs): void {
	write(KEY.memberList, JSON.stringify(prefs));
}

export function loadNotificationsEnabled(): boolean {
	return read(KEY.notificationsEnabled) === 'true';
}

export function saveNotificationsEnabled(enabled: boolean): void {
	write(KEY.notificationsEnabled, String(enabled));
}

export function loadNotificationScope(): NotificationScope {
	return read(KEY.notificationScope) === 'everything' ? 'everything' : 'mentions';
}

export function saveNotificationScope(scope: NotificationScope): void {
	write(KEY.notificationScope, scope);
}

/** The servers the user turned push notifications on for (§4.7), by URL. */
export function loadWebPushServers(): string[] {
	try {
		const parsed: unknown = JSON.parse(read(KEY.webPush) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === 'string') : [];
	} catch {
		return [];
	}
}

/** Turns push on or off for one server, and returns the servers it is on for. */
export function saveWebPushEnabled(servers: string[], url: string, enabled: boolean): string[] {
	const next = [...servers.filter((server) => server !== url), ...(enabled ? [url] : [])];
	write(KEY.webPush, JSON.stringify(next));
	return next;
}

/** The server this browser's one push subscription is registered with: its notifications open rooms there. */
export function loadWebPushServer(): string | undefined {
	return read(KEY.webPushServer) ?? undefined;
}

export function saveWebPushServer(url: string | undefined): void {
	if (!persisting) return;
	try {
		if (url === undefined) globalThis.localStorage?.removeItem(KEY.webPushServer);
		else globalThis.localStorage?.setItem(KEY.webPushServer, url);
	} catch {
		// As `write`.
	}
}

/** The saved theme and fonts as stored; `decodeAppearance` checks them. */
export function loadAppearance(): unknown {
	try {
		return JSON.parse(read(KEY.appearance) ?? 'null');
	} catch {
		return undefined;
	}
}

export function saveAppearance(preferences: AppearancePreferences): void {
	write(KEY.appearance, JSON.stringify(preferences));
}
