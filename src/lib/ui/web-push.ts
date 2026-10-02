import type { PushRegistration } from '$lib/protocol/client';

/**
 * Web push (§4.7, kind `webpush`): this browser's one push subscription, made
 * with the server's VAPID key and registered with `push_register`. The
 * service worker shows what arrives.
 */

/** What Preferences shows for push, on a server that offers web push. */
export interface WebPushPreference {
	/** This browser can subscribe here. */
	supported: boolean;
	/** iPhone or iPad Safari outside a Home Screen app, where push isn't offered. */
	homeScreen: boolean;
	/** On for this account, and notifications are allowed. */
	enabled: boolean;
	/** The wake scopes the server advertises (§4.7); empty when it lists none. */
	offered: string[];
	/** The browser offers to install Apron (`beforeinstallprompt`), and it isn't installed. */
	installable: boolean;
	error?: string;
}

/** The wake scopes a server advertises in `server.push.wake` (§4.7), ours or third-party (`ext:`). */
export function offeredWake(push: unknown): string[] {
	const wake = push && typeof push === 'object' ? (push as { wake?: unknown }).wake : undefined;
	return Array.isArray(wake) ? wake.filter((scope): scope is string => typeof scope === 'string' && scope !== '') : [];
}

/** Apron runs as an installed app (a Home Screen or desktop app window). */
export function isStandalone(): boolean {
	const nav = globalThis.navigator as (Navigator & { standalone?: boolean }) | undefined;
	return nav?.standalone === true || globalThis.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** Whether to offer Install app: the browser offered it (`beforeinstallprompt`), and Apron isn't running installed. */
export function canOfferInstall(prompt: unknown): boolean {
	return Boolean(prompt) && !isStandalone();
}

/** Chromium's `beforeinstallprompt` event, which TypeScript's DOM types lack. */
export interface InstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Decodes base64url (padded or not), such as a VAPID public key. Throws on anything else. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) throw new Error('Not base64url');
	const base64 = value.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

/** Encodes bytes as unpadded base64url. */
export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
	let binary = '';
	for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Whether a subscription's `applicationServerKey` is this base64url key. */
export function sameServerKey(current: ArrayBuffer | null | undefined, key: string): boolean {
	if (!current) return false;
	try {
		return bytesToBase64Url(current) === bytesToBase64Url(base64UrlToBytes(key));
	} catch {
		return false;
	}
}

/**
 * The `push_register` params for a subscription (`PushSubscription.toJSON()`),
 * if it is complete, with its `push_id` and the `wake` scopes (undefined: the
 * server's defaults; empty: nothing).
 */
export function webPushRegistration(subscription: PushSubscriptionJSON, pushId?: string, wake?: readonly string[]): PushRegistration | undefined {
	const { endpoint, keys } = subscription;
	if (!endpoint || !keys?.p256dh || !keys.auth) return undefined;
	return { kind: 'webpush', url: endpoint, ...(pushId ? { push_id: pushId } : {}), keys: { p256dh: keys.p256dh, auth: keys.auth }, ...(wake ? { wake: [...wake] } : {}) };
}

/** One account on one server, as push is turned on for it and as its `push_id` is made from. */
export function webPushAccount(serverUrl: string, userId: string): string {
	return `${serverUrl}\n${userId}`;
}

/**
 * The `push_id` (§4.7) of an account (`webPushAccount`): its SHA-256 in
 * base64url, cut to 16 characters. The server copies it into every payload,
 * so a pushed message can be matched to its server and account, and to the
 * page's own notification of it. Undefined where the browser can't hash.
 */
export async function pushId(account: string): Promise<string | undefined> {
	try {
		const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(account));
		return bytesToBase64Url(digest).slice(0, 16);
	} catch {
		return undefined;
	}
}

/** Whether this browser can subscribe to web push here. */
export function webPushSupported(): boolean {
	return Boolean(globalThis.isSecureContext && globalThis.navigator?.serviceWorker && 'PushManager' in globalThis && 'Notification' in globalThis);
}

/** iPhone and iPad Safari offer web push only to a site added to the Home Screen. */
export function needsHomeScreen(): boolean {
	const nav = globalThis.navigator;
	if (!nav || isStandalone()) return false;
	return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** This browser's push subscription; tests stand in for it. */
export interface PushBrowser {
	/** Subscribes with the server's key, keeping a subscription made with it and replacing one made with another. */
	subscribe(key: string): Promise<PushSubscriptionJSON>;
	/** Drops the subscription, if there is one. */
	unsubscribe(): Promise<void>;
}

export const browserPush: PushBrowser = {
	async subscribe(key) {
		const registration = await navigator.serviceWorker.ready;
		let subscription = await registration.pushManager.getSubscription();
		if (subscription && !sameServerKey(subscription.options.applicationServerKey, key)) {
			await subscription.unsubscribe();
			subscription = null;
		}
		subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) });
		return subscription.toJSON();
	},
	async unsubscribe() {
		const registration = await navigator.serviceWorker?.getRegistration();
		const subscription = await registration?.pushManager.getSubscription();
		await subscription?.unsubscribe();
	}
};

/** What push registers on: `ChatClient`. */
export interface PushClient {
	readonly url: string;
	setPushRegistration(registration: PushRegistration | undefined, userId?: string): void;
}

/**
 * Keeps this browser's one push subscription in step with what the page
 * wants. Subscribing and unsubscribing run one at a time, in the order asked,
 * and a newer call supersedes an older one still in flight: it registers
 * nothing once turned off, or once its client has moved to another server
 * or account.
 */
export class WebPushSync {
	private run = 0;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly browser: PushBrowser = browserPush) {}

	private serially<T>(step: () => Promise<T>): Promise<T> {
		const next = this.queue.then(step, step);
		this.queue = next.catch(() => undefined);
		return next;
	}

	/**
	 * Subscribes with the server's key and registers the subscription for the
	 * account `userId` on `client`'s server, waking for `wake` (§4.7; undefined: the server's defaults). `current`
	 * says whether that is still the account signed in there. Resolves whether
	 * it registered; rejects if the browser couldn't subscribe.
	 */
	async enable(client: PushClient, key: string, userId: string, current: () => boolean = () => true, wake?: readonly string[]): Promise<boolean> {
		const run = ++this.run;
		const url = client.url;
		const live = () => run === this.run && client.url === url && current();
		const id = await pushId(webPushAccount(url, userId));
		if (!live()) return false;
		const subscription = await this.serially(async () => (live() ? this.browser.subscribe(key) : undefined));
		if (!subscription || !live()) return false;
		const registration = webPushRegistration(subscription, id, wake);
		if (!registration) throw new Error('The browser returned an incomplete push subscription');
		client.setPushRegistration(registration, userId);
		return true;
	}

	/**
	 * Turns push off on `client`: supersedes a subscription in flight,
	 * unregisters, and with `unsubscribe` drops the browser's subscription,
	 * after whatever subscribing is under way.
	 */
	async disable(client: PushClient, unsubscribe: boolean): Promise<void> {
		this.run += 1;
		client.setPushRegistration(undefined);
		if (unsubscribe) await this.serially(() => this.browser.unsubscribe());
	}
}
