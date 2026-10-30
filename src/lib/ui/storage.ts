import { serverAddress, type ServerLook } from '$lib/protocol/client-views';
import { compareLogIds } from '$lib/protocol/reducer';
import { isJsonObject, isLogId, type JsonObject } from '$lib/protocol/types';
import { base64url } from '$lib/protocol/webauthn';
import type { AppearancePreferences } from './appearance.svelte';

/** Everything this client remembers between visits lives under one prefix. */
const KEY = {
	serverUrl: 'apron.serverUrl',
	displayName: 'apron.displayName',
	recentServers: 'apron.recentServers',
	sidebar: 'apron.sidebar',
	notificationsEnabled: 'apron.desktopNotifications',
	/** The offer to add Apron to the Home Screen (`InstallPrompt`) was answered on this device: it isn't made again. */
	installOffer: 'apron.installOffer',
	/** The accounts push is turned on for, and the one this browser's push subscription is registered for. */
	webPush: 'apron.webPushAccounts',
	webPushOwner: 'apron.webPushOwner',
	/** What to notify about, per account (`notifyAccount`): desktop notifications and push alike. */
	notifyScopes: 'apron.notifyScopes',
	/** Each account's `push_id` (§4.9), by `webPushAccount`: random, made here. */
	pushIds: 'apron.pushIds',
	memberList: 'apron.memberList',
	/** The member list's sections folded away (`online`, `offline`), on every room. */
	memberSections: 'apron.memberSections',
	/** Whether Other Threads, the threads you haven't joined under the open room, is folded away. */
	otherThreads: 'apron.otherThreads',
	/** The sidebar's sections folded to their rows with news (`rooms`, `private`, `otherRooms`). */
	sidebarFolds: 'apron.sidebarFolds',
	/** The room and thread descriptions put away with their ×, each kept as the fingerprint of the text put away. Still stored under its old name, so what's put away stays put away. */
	hiddenDescriptions: 'apron.hiddenSummaries',
	/** Private rooms someone else added you to, per account (`notifyAccount`), until their banner is put away or you leave. */
	addedRooms: 'apron.addedRooms',
	/** The rooms whose threads you folded to those with news, per account (`notifyAccount`), until you unfold them. */
	threadFolds: 'apron.threadFolds',
	/** The order of the sidebar's top-level rooms, per account (`notifyAccount`): as they were first listed, then as you dragged them. */
	roomOrder: 'apron.roomOrder',
	/** How far you have read each room and thread, by `readPositionKey`: the `message_id` read through. */
	readPositions: 'apron.readPositions',
	/** How long history is kept on this device (`$lib/history/retention`). */
	historyRetention: 'apron.historyRetention',
	/** Where images and other media load from (`$lib/ui/media-settings`): `{policy, origins}`. */
	media: 'apron.media',
	/** app.html reads this one too, to apply the theme before the app loads. */
	appearance: 'apron.appearance'
} as const;

/**
 * A server signed in to before: its address (§1), the key it is known by, and the `title` and `avatar` of its last
 * `server` frame (§3.1), for showing it while it isn't connected. Never found by its title or avatar.
 */
export type RecentServer = { url: string; title?: string; avatar?: string };
export type SidebarPrefs = { width: number; collapsed: boolean };

const RECENT_SERVERS_MAX = 5;
/** The most rooms kept as added per account; the ones added longest ago go first. */
const ADDED_ROOMS_MAX = 50;
/** The most rooms kept folded per account; the ones folded longest ago unfold first. */
const THREAD_FOLDS_MAX = 200;
/** The most descriptions kept put away; the ones put away longest ago show again first. */
const HIDDEN_DESCRIPTIONS_MAX = 200;
/** The most read positions kept; the ones moved longest ago go first. */
const READ_POSITIONS_MAX = 500;

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

/** An address as recent servers key it (`serverAddress`), or undefined for one that isn't a URL. */
function addressOf(url: string): string | undefined {
	try {
		return serverAddress(url);
	} catch {
		return undefined;
	}
}

/**
 * The servers signed in to before, newest first, each once by its address: entries saved before addresses were
 * normalized, or with a host `label` in place of a title, are folded into the newest entry for their address.
 */
export function loadRecentServers(): RecentServer[] {
	try {
		const parsed: unknown = JSON.parse(read(KEY.recentServers) ?? '[]');
		if (!Array.isArray(parsed)) return [];
		const recent: RecentServer[] = [];
		for (const entry of parsed) {
			if (!isJsonObject(entry) || typeof entry.url !== 'string') continue;
			const url = addressOf(entry.url);
			if (!url || recent.some((kept) => kept.url === url)) continue;
			recent.push({ url, ...(typeof entry.title === 'string' && entry.title ? { title: entry.title } : {}), ...(typeof entry.avatar === 'string' && entry.avatar ? { avatar: entry.avatar } : {}) });
		}
		return recent.slice(0, RECENT_SERVERS_MAX);
	} catch {
		return [];
	}
}

/** Puts a server at the head of the recent list, with how it last looked, dropping its older entry and the tail. */
export function rememberServer(recent: RecentServer[], url: string, look: Pick<ServerLook, 'title' | 'avatar'> = {}): RecentServer[] {
	const address = addressOf(url) ?? url;
	const entry: RecentServer = { url: address, ...(look.title ? { title: look.title } : {}), ...(look.avatar ? { avatar: look.avatar } : {}) };
	const next = [entry, ...recent.filter((server) => server.url !== address)].slice(0, RECENT_SERVERS_MAX);
	write(KEY.recentServers, JSON.stringify(next));
	return next;
}

/**
 * Keeps how a recent server looks now (its latest `server` frame's `title` and `avatar`), where it is listed, without
 * moving it: returns the list as it was when nothing changed, or the server isn't listed.
 */
export function refreshRecentServer(recent: RecentServer[], url: string, look: Pick<ServerLook, 'title' | 'avatar'>): RecentServer[] {
	const address = addressOf(url) ?? url;
	const index = recent.findIndex((server) => server.url === address);
	if (index < 0) return recent;
	const kept = recent[index];
	if (kept.title === look.title && kept.avatar === look.avatar) return recent;
	const entry: RecentServer = { url: address, ...(look.title ? { title: look.title } : {}), ...(look.avatar ? { avatar: look.avatar } : {}) };
	const next = recent.map((server, at) => (at === index ? entry : server));
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

/** The member list's sections are open until folded, and stay as they were left. */
/** A list of keys kept as JSON under `key`: none if it isn't one, keeping only the strings. */
function readKeyList(key: string): string[] {
	try {
		const list: unknown = JSON.parse(read(key) ?? '[]');
		return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
	} catch {
		return [];
	}
}

export function loadShutMemberSections(): string[] {
	return readKeyList(KEY.memberSections);
}

export function saveShutMemberSections(shut: readonly string[]): void {
	write(KEY.memberSections, JSON.stringify(shut));
}

/** The sidebar's sections folded to their rows with news, by key; none until one is, and they stay as they were left. */
export function loadSidebarFolds(): string[] {
	return readKeyList(KEY.sidebarFolds);
}

export function saveSidebarFolds(folded: readonly string[]): void {
	write(KEY.sidebarFolds, JSON.stringify(folded));
}

/** Other Threads is open until it's folded, and stays as it was left. */
export function loadOtherThreadsOpen(): boolean {
	return read(KEY.otherThreads) !== 'shut';
}

export function saveOtherThreadsOpen(open: boolean): void {
	write(KEY.otherThreads, open ? 'open' : 'shut');
}

/** The storage key of the descriptions put away: other tabs follow its `storage` events. */
export const HIDDEN_DESCRIPTIONS_KEY = KEY.hiddenDescriptions;

/** The descriptions put away, by the page's key for each room or thread: the fingerprint of the text that was put away. */
export function loadHiddenDescriptions(): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(read(KEY.hiddenDescriptions) ?? '{}');
		if (!isJsonObject(parsed)) return {};
		return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
	} catch {
		return {};
	}
}

/**
 * The descriptions to change: as saved, which another tab may have changed since this one loaded them (its
 * `hidden` would put back what that tab saved), unless nothing is saved for the next visit.
 */
function savedDescriptions(hidden: Record<string, string>): Record<string, string> {
	return persisting ? loadHiddenDescriptions() : hidden;
}

/** Puts a room's or thread's description away, until it's edited: returns the descriptions put away, this one newest. */
export function hideDescription(hidden: Record<string, string>, key: string, description: string): Record<string, string> {
	const others = Object.entries(savedDescriptions(hidden)).filter(([entry]) => entry !== key);
	const next = Object.fromEntries([...others, [key, descriptionFingerprint(description)]].slice(-HIDDEN_DESCRIPTIONS_MAX));
	write(KEY.hiddenDescriptions, JSON.stringify(next));
	return next;
}

/** Brings a room's or thread's description back: returns the descriptions still put away. */
export function showDescription(hidden: Record<string, string>, key: string): Record<string, string> {
	const next = Object.fromEntries(Object.entries(savedDescriptions(hidden)).filter(([entry]) => entry !== key));
	write(KEY.hiddenDescriptions, JSON.stringify(next));
	return next;
}

/** Whether a description was put away as it now reads: an edit brings it back. */
export function descriptionHidden(hidden: Record<string, string>, key: string, description: string): boolean {
	return hidden[key] === descriptionFingerprint(description);
}

/** A short hash of a description (FNV-1a), enough to tell an edit, without keeping the text itself. */
function descriptionFingerprint(description: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < description.length; i++) hash = Math.imul(hash ^ description.charCodeAt(i), 0x01000193);
	return (hash >>> 0).toString(36);
}

/** Where a room's read position is kept: by account (`notifyAccount`) and `room_id`, a thread's own. */
export function readPositionKey(account: string, roomId: string): string {
	return JSON.stringify([account, roomId]);
}

/** Every read position kept on this device, by `readPositionKey`, the ones moved longest ago first. */
export function loadReadPositions(): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(read(KEY.readPositions) ?? '{}');
		if (!isJsonObject(parsed)) return {};
		return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => isLogId(entry[1])));
	} catch {
		return {};
	}
}

/**
 * Moves read positions forward, never back, over what is kept now (another
 * tab may have read further): returns every position kept, these newest.
 */
export function advanceReadPositions(positions: Record<string, string>): Record<string, string> {
	const kept = loadReadPositions();
	const moved = Object.entries(positions).filter(([key, id]) => kept[key] === undefined || compareLogIds(id, kept[key]) > 0);
	if (!moved.length) return kept;
	const keys = new Set(moved.map(([key]) => key));
	const next = Object.fromEntries([...Object.entries(kept).filter(([key]) => !keys.has(key)), ...moved].slice(-READ_POSITIONS_MAX));
	write(KEY.readPositions, JSON.stringify(next));
	return next;
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

/** Whether the offer to add Apron to the Home Screen was answered on this device (installed, or Not now). */
export function installOfferAnswered(): boolean {
	return read(KEY.installOffer) !== null;
}

export function answerInstallOffer(answer: 'installed' | 'declined'): void {
	write(KEY.installOffer, answer);
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

/** What an account chose to be notified about (`notifyAccount`); undefined until it chose. */
export function loadNotifyScopes(account: string): string[] | undefined {
	return readScopeChoices(KEY.notifyScopes)[account];
}

export function saveNotifyScopes(account: string, scopes: readonly string[]): void {
	write(KEY.notifyScopes, JSON.stringify({ ...readScopeChoices(KEY.notifyScopes), [account]: [...scopes] }));
}

/** The private rooms someone else added this account to whose "You were added" banner still shows, oldest first. */
export function loadAddedRooms(account: string): string[] {
	return readScopeChoices(KEY.addedRooms)[account] ?? [];
}

/** Keeps the account's added rooms: those whose banner still shows. */
export function saveAddedRooms(account: string, rooms: readonly string[]): void {
	const kept = rooms.slice(-ADDED_ROOMS_MAX);
	const { [account]: _previous, ...others } = readScopeChoices(KEY.addedRooms);
	write(KEY.addedRooms, JSON.stringify(kept.length ? { ...others, [account]: kept } : others));
}

/** The rooms whose threads this account folded to those with news, folded longest ago first. */
export function loadThreadFolds(account: string): string[] {
	return readScopeChoices(KEY.threadFolds)[account] ?? [];
}

export function saveThreadFolds(account: string, rooms: readonly string[]): void {
	const kept = rooms.slice(-THREAD_FOLDS_MAX);
	const { [account]: _previous, ...others } = readScopeChoices(KEY.threadFolds);
	write(KEY.threadFolds, JSON.stringify(kept.length ? { ...others, [account]: kept } : others));
}

/** The account's top-level rooms in the order the sidebar lists them, by `room_id`. */
export function loadRoomOrder(account: string): string[] {
	return readScopeChoices(KEY.roomOrder)[account] ?? [];
}

export function saveRoomOrder(account: string, rooms: readonly string[]): void {
	const { [account]: _previous, ...others } = readScopeChoices(KEY.roomOrder);
	write(KEY.roomOrder, JSON.stringify(rooms.length ? { ...others, [account]: [...rooms] } : others));
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

export const HISTORY_RETENTION_KEY = KEY.historyRetention;

export function loadHistoryRetention(): string | undefined {
	return read(KEY.historyRetention) ?? undefined;
}

export function saveHistoryRetention(value: string): void {
	write(KEY.historyRetention, value);
}

export const MEDIA_KEY = KEY.media;

export function loadMediaSettings(): unknown {
	try {
		return JSON.parse(read(KEY.media) ?? 'null');
	} catch {
		return undefined;
	}
}

export function saveMediaSettings(value: { policy: string; origins: readonly string[] }): void {
	write(KEY.media, JSON.stringify(value));
}
