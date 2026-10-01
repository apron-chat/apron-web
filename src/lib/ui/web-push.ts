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
	/** On for this server, and notifications are allowed. */
	enabled: boolean;
	error?: string;
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

/** The `push_register` params for a subscription (`PushSubscription.toJSON()`), if it is complete. */
export function webPushRegistration(subscription: PushSubscriptionJSON): PushRegistration | undefined {
	const { endpoint, keys } = subscription;
	if (!endpoint || !keys?.p256dh || !keys.auth) return undefined;
	return { kind: 'webpush', url: endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** Whether this browser can subscribe to web push here. */
export function webPushSupported(): boolean {
	return Boolean(globalThis.isSecureContext && globalThis.navigator?.serviceWorker && 'PushManager' in globalThis && 'Notification' in globalThis);
}

/** iPhone and iPad Safari offer web push only to a site added to the Home Screen. */
export function needsHomeScreen(): boolean {
	const nav = globalThis.navigator as (Navigator & { standalone?: boolean }) | undefined;
	if (!nav || nav.standalone === true) return false;
	const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
	return ios && !globalThis.matchMedia?.('(display-mode: standalone)').matches;
}

/**
 * Subscribes this browser with the server's key, keeping a subscription that
 * already uses it, and replacing one made with another key. Resolves the
 * `push_register` params. Needs notification permission granted.
 */
export async function subscribeWebPush(key: string): Promise<PushRegistration> {
	const registration = await navigator.serviceWorker.ready;
	let subscription = await registration.pushManager.getSubscription();
	if (subscription && !sameServerKey(subscription.options.applicationServerKey, key)) {
		await subscription.unsubscribe();
		subscription = null;
	}
	subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) });
	const params = webPushRegistration(subscription.toJSON());
	if (!params) throw new Error('The browser returned an incomplete push subscription');
	return params;
}

/** Drops this browser's push subscription, if it has one. */
export async function unsubscribeWebPush(): Promise<void> {
	const registration = await navigator.serviceWorker?.getRegistration();
	const subscription = await registration?.pushManager.getSubscription();
	await subscription?.unsubscribe();
}
