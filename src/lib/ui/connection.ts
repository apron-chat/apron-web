import type { ClientSnapshot } from '$lib/protocol/client';
import type { ServerParams } from '$lib/protocol/types';
import { retryAfterLabel } from './time';

export type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'offline';

/** The socket is open and the server has accepted our auth; identity kept from a previous connection does not count. */
export function isSessionReady(snapshot: ClientSnapshot): boolean {
	return snapshot.status === 'connected' && snapshot.authenticated && Boolean(snapshot.you);
}

export function connectionStateOf(snapshot: ClientSnapshot): ConnectionState {
	if (isSessionReady(snapshot)) return 'connected';
	if (snapshot.status === 'offline') return 'offline';
	if (snapshot.disconnectedAt !== undefined || snapshot.status === 'reconnecting') return 'reconnecting';
	return 'connecting';
}

/** A transport-level failure during a reconnect is expected noise; anything else (auth refused, bad frames) is worth surfacing. */
export function reconnectErrorOf(snapshot: ClientSnapshot): string {
	return snapshot.error && snapshot.error !== 'WebSocket connection error' ? snapshot.error : '';
}

/** What the status banner says: what happened, then what the client is doing about it. */
export function statusLabel(snapshot: ClientSnapshot, stalled: boolean): string {
	const state = connectionStateOf(snapshot);
	if (state === 'connected') return 'Connected';
	if (state === 'offline') return 'Offline';
	if (state === 'reconnecting') {
		const error = reconnectErrorOf(snapshot);
		if (snapshot.held) return error ? `Signed out: ${error}` : 'Signed out';
		if (snapshot.retryAfterMs && snapshot.retryAfterMs > 0) return `${error || 'Connection limited'}. Retrying in ${retryAfterLabel(snapshot.retryAfterMs)}…`;
		if (error) return stalled ? `Still disconnected: ${error}` : error;
		return stalled ? 'Still trying to reconnect…' : 'Reconnecting…';
	}
	if (snapshot.status === 'connecting' || snapshot.status === 'connected') return 'Connecting…';
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
 * scheme only in `signup`. Undefined when there is nothing to suggest.
 */
export function wayBackNudge(server: Pick<ServerParams, 'auth'> | undefined, methods: readonly string[] | undefined): AddableScheme[] | undefined {
	if (!server || !methods?.length) return undefined;
	const signsIn = (['webauthn', 'email', 'external'] as const).filter((scheme) => server.auth.includes(scheme));
	if (!signsIn.length || methods.some((method) => signsIn.includes(method as AddableScheme))) return undefined;
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
export function addError(cause: unknown, scheme: 'email' | 'external' = 'email'): string {
	const code = (cause as { code?: number } | undefined)?.code;
	if (code === -32001) {
		return scheme === 'email'
			? 'That code was refused: it may be wrong or expired, or the address may belong to another account. Ask for a new code, or sign in with that address instead.'
			: 'That was refused: the code may be wrong or expired, or that sign-in may belong to another account. Start again, or sign in with it instead.';
	}
	return cause instanceof Error && cause.message ? cause.message : scheme === 'email' ? 'Unable to add the address' : 'Unable to add the sign-in';
}

export function backendHost(value: string): string {
	try {
		return new URL(value).host;
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
