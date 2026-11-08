import type { ClientSnapshot } from '$lib/protocol/client';
import type { ServerParams } from '$lib/protocol/types';
import { retryAfterLabel } from '$lib/words';

export type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'offline';

/** The socket is open and the server has accepted our auth; identity kept from a previous connection does not count. */
export function isSessionReady(snapshot: Pick<ClientSnapshot, 'status' | 'authenticated' | 'you'>): boolean {
	return snapshot.status === 'connected' && snapshot.authenticated && Boolean(snapshot.you);
}

export function connectionStateOf(snapshot: Pick<ClientSnapshot, 'status' | 'authenticated' | 'you' | 'disconnectedAt'>): ConnectionState {
	if (isSessionReady(snapshot)) return 'connected';
	if (snapshot.status === 'offline') return 'offline';
	if (snapshot.disconnectedAt !== undefined || snapshot.status === 'reconnecting') return 'reconnecting';
	return 'connecting';
}

/** A transport-level failure during a reconnect is expected noise; anything else (auth refused, bad frames) is worth surfacing. */
export function reconnectErrorOf(snapshot: Pick<ClientSnapshot, 'error'>): string {
	return snapshot.error && snapshot.error !== 'WebSocket connection error' ? snapshot.error : '';
}

/**
 * When the wait the server asked for before reconnecting (`retryAfterMs`) ends, in epoch milliseconds: worked out
 * as a snapshot arrives, since its `retryAfterMs` is the time left when it was made and nothing is emitted while the
 * wait runs. Undefined without one.
 */
export function retryUntil(snapshot: Pick<ClientSnapshot, 'retryAfterMs'>, now = Date.now()): number | undefined {
	return snapshot.retryAfterMs && snapshot.retryAfterMs > 0 ? now + snapshot.retryAfterMs : undefined;
}

/**
 * What the status banner says: what happened, then what the client is doing about it. `retryLeftMs` is the time
 * left of the server's wait (`retryUntil`) as it counts down, the snapshot's own when not given. With `server` (its
 * `serverLabel`), connecting and reconnecting say which server: where nothing else on screen does, such as before
 * the rooms are listed.
 */
export function statusLabel(snapshot: ClientSnapshot, stalled: boolean, retryLeftMs = snapshot.retryAfterMs, server?: string): string {
	const state = connectionStateOf(snapshot);
	if (state === 'connected') return 'Connected';
	if (state === 'offline') return 'Offline';
	if (state === 'reconnecting') {
		const error = reconnectErrorOf(snapshot);
		if (snapshot.held) return error ? `Signed out: ${error}` : 'Signed out';
		if (retryLeftMs && retryLeftMs > 0) return `${error || 'Connection limited'}. Retrying in ${retryAfterLabel(retryLeftMs)}…`;
		if (error) return stalled ? (server ? `Can't reach ${server}: ${error}` : `Still disconnected: ${error}`) : error;
		if (server) return stalled ? `Still trying to reach ${server}…` : `Reconnecting to ${server}…`;
		return stalled ? 'Still trying to reconnect…' : 'Reconnecting…';
	}
	if (snapshot.status === 'connecting' || snapshot.status === 'connected') return server ? `Connecting to ${server}…` : 'Connecting…';
	return 'Waiting to connect';
}

/**
 * What a scheme does on this server (§3.1, §3.2): with `server.signup`,
 * `auth` lists the schemes that sign in and `signup` those that create an
 * account; without it, every scheme in `auth` does both.
 */
export function schemeUse(server: Pick<ServerParams, 'auth' | 'signup'> | undefined, scheme: string): { signIn: boolean; signUp: boolean } {
	const signIn = server?.auth.includes(scheme) === true;
	return { signIn, signUp: server?.signup ? server.signup.includes(scheme) : signIn };
}

/** Every scheme a server offers for signing in or creating an account, in its order: `auth`, then the rest of `signup`. */
export function offeredSchemes(server: Pick<ServerParams, 'auth' | 'signup'> | undefined): string[] {
	if (!server) return [];
	return [...new Set([...server.auth, ...(server.signup ?? [])])];
}

/** The ways back in that can be added to an account (§4.10, §4.11), in the order suggested. */
export type AddableScheme = 'webauthn' | 'email' | 'external';

/**
 * The schemes worth adding to a registered account so its user can sign back
 * in (§3.2.1): the passkey, email and external schemes the server signs in
 * with (`auth`), when none of the ways this browser knows the account has
 * (`methods`: how it signed in, then what it added) is one of them. That
 * covers a kept token as the only way back, and an account made with a
 * scheme only in `signup`. A `link` method is an email or an external
 * sign-in, not known which: either one the server signs in with counts.
 * Undefined when there is nothing to suggest.
 */
export function wayBackNudge(server: Pick<ServerParams, 'auth'> | undefined, methods: readonly string[] | undefined): AddableScheme[] | undefined {
	if (!server || !methods?.length) return undefined;
	const signsIn = (['webauthn', 'email', 'external'] as const).filter((scheme) => server.auth.includes(scheme));
	const has = (scheme: AddableScheme) => methods.includes(scheme) || (scheme !== 'webauthn' && methods.includes('link'));
	if (!signsIn.length || signsIn.some(has)) return undefined;
	return signsIn;
}

/** The nudge's suggestion in words, such as "a passkey or an email". */
export function wayBackWords(schemes: readonly AddableScheme[]): string {
	const words = schemes.map((scheme) => (scheme === 'webauthn' ? 'a passkey' : scheme === 'email' ? 'an email' : 'an external sign-in'));
	return words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}` : words[0] ?? '';
}

/**
 * What went wrong adding an address or an external identity (§4.11.3), in
 * words: `denied` is usually one that belongs to another account already.
 */
export function addError(cause: unknown, scheme: 'email' | 'external' | 'link' = 'email'): string {
	const code = (cause as { code?: number } | undefined)?.code;
	if (code === -32001) {
		// `link`: a link of no addition made here, which may have been for signing in, or for another account (§4.11.3).
		return scheme === 'email'
			? 'That code was refused: it may be wrong or expired, or the address may belong to another account. Ask for a new code, or sign in with that address instead.'
			: scheme === 'external'
				? 'That was refused: the code may be wrong or expired, or that sign-in may belong to another account. Start again, or sign in with it instead.'
				: 'That link was refused: it may have expired or been used, be for signing in rather than adding, or be for another account, which it adds to only where that account is signed in. Open it again to sign in with it instead.';
	}
	return cause instanceof Error && cause.message ? cause.message : scheme === 'email' ? 'Unable to add the address' : 'Unable to add the sign-in';
}

/**
 * A server's address as people read it: its host and path, without the
 * scheme or a trailing `/`, so `wss://scene.apron.chat/piper` is
 * `scene.apron.chat/piper` and `wss://chat.example/` is `chat.example`.
 * Many servers can share a host under different paths, so the path is kept.
 * Empty for a value that isn't a URL.
 */
export function serverLabel(value: string): string {
	try {
		const url = new URL(value);
		return url.host ? `${url.host}${url.pathname.replace(/\/+$/, '')}` : '';
	} catch {
		return '';
	}
}

/** The user-facing reading of a WebAuthn failure. */
export function passkeyMessage(cause: unknown): string {
	return cause instanceof DOMException && cause.name === 'NotAllowedError'
		? 'Cancelled.'
		: cause instanceof Error ? cause.message : 'Unable to use passkey';
}
