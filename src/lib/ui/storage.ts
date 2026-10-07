import { isJsonObject, type JsonObject } from '$lib/protocol/types';
import { base64url } from '$lib/protocol/webauthn';
import type { AppearancePreferences } from './appearance.svelte';

/** Everything this client remembers between visits lives under one prefix. */
const KEY = {
	serverUrl: 'apron.serverUrl',
	displayName: 'apron.displayName',
	recentServers: 'apron.recentServers',
	sidebar: 'apron.sidebar',
	notificationsEnabled: 'apron.desktopNotifications',
	/** The accounts push is turned on for, and the one this browser's push subscription is registered for. */
	webPush: 'apron.webPushAccounts',
	webPushOwner: 'apron.webPushOwner',
	/** What to notify about, per account (`notifyAccount`): desktop notifications and push alike. */
	notifyScopes: 'apron.notifyScopes',
	/** Each account's `push_id` (§4.9), by `webPushAccount`: random, made here. */
	pushIds: 'apron.pushIds',
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

/** Whether notifications were ever turned on or off on this device (or the first-mention offer answered): whether to offer them. */
export function notificationsChosen(): boolean {
	return read(KEY.notificationsEnabled) !== null;
}

export function saveNotificationsEnabled(enabled: boolean): void {
	write(KEY.notificationsEnabled, String(enabled));
}

/** `push_id`s made here and not saved (no storage, or `/__preview`). */
const unsavedPushIds = new Map<string, string>();

/**
 * The `push_id` (§4.9) of an account (`webPushAccount`): a random one,
 * made the first time and kept in `apron.pushIds`, so it reveals neither
 * server nor account.
 */
export function pushIdFor(account: string, make: () => string = defaultPushId): string {
	const ids = readPushIds();
	const kept = ids[account] ?? unsavedPushIds.get(account);
	if (kept) return kept;
	const id = make();
	unsavedPushIds.set(account, id);
	write(KEY.pushIds, JSON.stringify({ ...ids, [account]: id }));
	return id;
}

function readPushIds(): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(read(KEY.pushIds) ?? '{}');
		if (!isJsonObject(parsed)) return {};
		return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(entry[1])));
	} catch {
		return {};
	}
}

/** 12 random bytes in base64url: 16 characters. */
function defaultPushId(): string {
	return base64url(globalThis.crypto.getRandomValues(new Uint8Array(12)));
}

/** The storage keys of the accounts push is on for, and of what to notify about: other tabs follow their `storage` events. */
export const WEB_PUSH_ACCOUNTS_KEY = KEY.webPush;
export const NOTIFY_SCOPES_KEY = KEY.notifyScopes;

/**
 * The accounts the user turned push notifications on for (§4.9), each as
 * `webPushAccount(server, userId)`: another account signing in here isn't on.
 */
export function loadWebPushAccounts(): string[] {
	try {
		const parsed: unknown = JSON.parse(read(KEY.webPush) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((account): account is string => typeof account === 'string') : [];
	} catch {
		return [];
	}
}

/** Turns push on or off for one account, and returns the accounts it is on for. */
export function saveWebPushEnabled(accounts: string[], account: string, enabled: boolean): string[] {
	const next = [...accounts.filter((entry) => entry !== account), ...(enabled ? [account] : [])];
	write(KEY.webPush, JSON.stringify(next));
	return next;
}

/** Stored for accounts that haven't chosen: the old device-wide "Everything" setting. */
const NOTIFY_DEFAULT = '*';

function readScopeChoices(key: string): Record<string, string[]> {
	try {
		const parsed: unknown = JSON.parse(read(key) ?? '{}');
		const choices: Record<string, string[]> = Object.create(null);
		if (!isJsonObject(parsed)) return choices;
		for (const [account, scopes] of Object.entries(parsed)) {
			if (Array.isArray(scopes)) choices[account] = scopes.filter((scope): scope is string => typeof scope === 'string');
		}
		return choices;
	} catch {
		return Object.create(null);
	}
}

function remove(key: string): void {
	if (!persisting) return;
	try {
		globalThis.localStorage?.removeItem(key);
	} catch {
		// As `write`.
	}
}

/**
 * Moves the device-wide desktop setting (`apron.notificationScope`) into
 * `apron.notifyScopes` as the choice of accounts that have none:
 * "Everything" is every scope; "Mentions" was the default, now mentions and
 * replies.
 */
function migrateNotifyScopes(): void {
	const scope = read('apron.notificationScope');
	if (scope === null) return;
	if (scope === 'everything') {
		const choices = readScopeChoices(KEY.notifyScopes);
		choices[NOTIFY_DEFAULT] ??= ['mentions', 'replies', 'private', 'joined'];
		write(KEY.notifyScopes, JSON.stringify(choices));
	}
	remove('apron.notificationScope');
}

/** What an account chose to be notified about (`notifyAccount`); undefined until it chose. */
export function loadNotifyScopes(account: string): string[] | undefined {
	migrateNotifyScopes();
	const choices = readScopeChoices(KEY.notifyScopes);
	return choices[account] ?? choices[NOTIFY_DEFAULT];
}

export function saveNotifyScopes(account: string, scopes: readonly string[]): void {
	migrateNotifyScopes();
	write(KEY.notifyScopes, JSON.stringify({ ...readScopeChoices(KEY.notifyScopes), [account]: [...scopes] }));
}

/**
 * Whose this browser's one push subscription is: the account it was last
 * subscribed for, and the server key it was made with. Other accounts on a
 * server with the same key share it; one on a server with another key would
 * replace it.
 */
export interface WebPushOwner {
	account: string;
	key: string;
}

/** The storage key of the subscription's owner: other tabs follow its `storage` events. */
export const WEB_PUSH_OWNER_KEY = KEY.webPushOwner;

export function loadWebPushOwner(): WebPushOwner | undefined {
	try {
		const parsed: unknown = JSON.parse(read(KEY.webPushOwner) ?? 'null');
		return isJsonObject(parsed) && typeof parsed.account === 'string' && typeof parsed.key === 'string' ? { account: parsed.account, key: parsed.key } : undefined;
	} catch {
		return undefined;
	}
}

export function saveWebPushOwner(owner: WebPushOwner | undefined): void {
	if (owner === undefined) remove(KEY.webPushOwner);
	else write(KEY.webPushOwner, JSON.stringify(owner));
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
