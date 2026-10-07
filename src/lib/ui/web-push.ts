import type { PushRegistration } from '$lib/protocol/client';
import { base64url } from '$lib/protocol/webauthn';
import { pushIdFor } from './storage';

/**
 * Web push (§4.9, kind `webpush`): this browser's one push subscription, made
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
	/** On, but this browser's subscription is another server's for now (its host): turning it on here moves it. */
	heldBy?: string;
	/** The server offers push, but only to a signed-in account, and this is a guest. */
	signIn?: boolean;
	/** The wake scopes the server advertises (§4.9); empty when it lists none. */
	offered: string[];
	/** The browser offers to install Apron (`beforeinstallprompt`), and it isn't installed. */
	installable: boolean;
	error?: string;
}

/** The wake scopes a server advertises in `server.push.wake` (§4.9), ours or third-party (`ext:`). */
export function offeredWake(push: unknown): string[] {
	const wake = push && typeof push === 'object' ? (push as { wake?: unknown }).wake : undefined;
	return Array.isArray(wake) ? wake.filter((scope): scope is string => typeof scope === 'string' && scope !== '') : [];
}

/**
 * Whether the page keeps push off for the account signed in (`account`,
 * `webPushAccount`): push isn't on for it here, or the subscription is held
 * by another server (`heldBy`). Before an account is known (a page loading,
 * a guest) there is nothing to keep off: doing so would unregister the
 * browser's endpoint only for push to register it again once the account
 * signs in.
 */
export function keepsPushOff(account: string | undefined, active: boolean, heldBy: string | undefined): boolean {
	return account !== undefined && (!active || heldBy !== undefined);
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

/** Whether a subscription's `applicationServerKey` is this base64url key. */
export function sameServerKey(current: ArrayBuffer | null | undefined, key: string): boolean {
	if (!current) return false;
	try {
		return base64url(current) === base64url(base64UrlToBytes(key));
	} catch {
		return false;
	}
}

/**
 * The server holding this browser's one push subscription, when it isn't
 * `account`'s to use: another account's, made with another key, whose push
 * is still on here (one of `accounts`). Accounts on servers with the same key
 * share it. Undefined when it is free or usable.
 */
export function pushHeldBy(owner: { account: string; key: string } | undefined, account: string | undefined, key: string | undefined, accounts: readonly string[]): string | undefined {
	if (!owner || owner.account === account || owner.key === key || !accounts.includes(owner.account)) return undefined;
	return accountServer(owner.account);
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

/** One account on one server, as push is turned on for it. */
export function webPushAccount(serverUrl: string, userId: string): string {
	return `${serverUrl}\n${userId}`;
}

/** The server of an account (`webPushAccount`). */
export function accountServer(account: string): string {
	const at = account.indexOf('\n');
	return at < 0 ? account : account.slice(0, at);
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
	/** The subscription's endpoint, if there is one. */
	endpoint(): Promise<string | undefined>;
}

/** How long to wait for the service worker before giving up on subscribing. */
const READY_WAIT_MS = 10_000;

/** The active service worker's registration, or a rejection after `READY_WAIT_MS` (one that never activates). */
function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error('The service worker isn’t ready')), READY_WAIT_MS);
	});
	return Promise.race([navigator.serviceWorker.ready, timeout]).finally(() => clearTimeout(timer));
}

const browserPush: PushBrowser = {
	async subscribe(key) {
		const registration = await serviceWorkerReady();
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
	},
	async endpoint() {
		const registration = await navigator.serviceWorker?.getRegistration();
		return (await registration?.pushManager.getSubscription())?.endpoint ?? undefined;
	}
};

/** What push registers on: `ChatClient`. */
interface PushClient {
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

	/** `pushIdOf` gives an account's `push_id` (`pushIdFor`, kept in storage). */
	constructor(readonly browser: PushBrowser = browserPush, private readonly pushIdOf: (account: string) => string = pushIdFor) {}

	/**
	 * Runs subscription steps one at a time: in this tab in the order asked,
	 * and across tabs under the `apron-push` Web Lock where the browser has
	 * one, so two tabs can't subscribe and unsubscribe at once.
	 */
	private serially<T>(step: () => Promise<T>): Promise<T> {
		const locked = (): Promise<T> => {
			const locks = globalThis.navigator?.locks;
			return locks ? (locks.request('apron-push', step) as Promise<T>) : step();
		};
		const next = this.queue.then(locked, locked);
		this.queue = next.catch(() => undefined);
		return next;
	}

	/**
	 * Subscribes with the server's key and registers the subscription for the
	 * account `userId` on `client`'s server, waking for `wake` (§4.9; undefined: the server's defaults). `current`
	 * says whether that is still the account signed in there. Resolves whether
	 * it registered; rejects if the browser couldn't subscribe.
	 */
	async enable(client: PushClient, key: string, userId: string, current: () => boolean = () => true, wake?: readonly string[]): Promise<boolean> {
		const run = ++this.run;
		const url = client.url;
		const live = () => run === this.run && client.url === url && current();
		// Worked out before subscribing, with nothing to wait for: Safari subscribes only close to the user's tap.
		const id = this.pushIdOf(webPushAccount(url, userId));
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

	/** Drops the browser's subscription when no account here has push on any more, after whatever is under way. */
	async release(): Promise<void> {
		this.run += 1;
		await this.serially(() => this.browser.unsubscribe());
	}
}
