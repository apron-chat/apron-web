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

export function demoRetentionNotice(server: ServerParams | undefined): string {
	const seconds = server?.ext?.demo?.retention_seconds;
	if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '';
	const hours = Math.max(1, Math.round(seconds / 3600));
	return hours >= 20 && hours <= 28
		? 'This demo keeps roughly the last day of history; older messages may expire.'
		: `This demo keeps roughly the last ${hours} hours of history; older messages may expire.`;
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
		? 'Cancelled. You’re still signed in as before.'
		: cause instanceof Error ? cause.message : 'Unable to use passkey';
}
