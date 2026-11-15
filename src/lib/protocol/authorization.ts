import { isLoopback, pageUrl, type CodeRedemption, type External } from './external';

export { isLoopback, pageUrl, parseExternal, type CodeRedemption, type External } from './external';

/**
 * The authorization code flow that external sign-in (PROTOCOL.md §4.12) and
 * a server's passkey page (`webauthn` with `external`, §4.10) share: a
 * profile of OAuth 2.1 with PKCE. A begin result names the page
 * (`external.url`); the client adds its own parameters to that URL, sends
 * the user there, checks the `state` that comes back, and redeems the `code`
 * on its connection. Only the pieces that need no browser are here: building
 * the URL, reading the answer, and the parameters that redeem it.
 */

/** What this client sends as itself (§4.12.2): its `client_id`, and where the page sends the user back. */
export interface AuthorizationClient {
	clientId: string;
	redirectUri: string;
}

/** One authorization request, as sent: what checks the answer and redeems its code. */
export interface AuthorizationRequest {
	/** The page with the request's parameters, to open. */
	url: string;
	state: string;
	codeVerifier: string;
	redirectUri: string;
	/** The `client_id` sent: `url`'s own when the server put one there, else this client's. */
	clientId: string;
	resource: string;
}

/** What the page sent the user back with (RFC 6749 §4.1.2, RFC 9207): a code, or an error. */
export interface AuthorizationResponse {
	state?: string;
	code?: string;
	iss?: string;
	error?: string;
	errorDescription?: string;
}

/**
 * The server's origin (§4.12.1), sent as `resource` so a code is good only
 * for the server this client is connected to: `https://` plus the host and
 * any port of its WebSocket address. A `ws:` address on a loopback host, as
 * in development, gives `http://` instead, as such a server calls itself.
 * Undefined for an address that isn't a WebSocket URL.
 */
export function serverOrigin(address: string): string | undefined {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return undefined;
	}
	if ((url.protocol !== 'ws:' && url.protocol !== 'wss:') || !url.host) return undefined;
	const scheme = url.protocol === 'ws:' && isLoopback(url.hostname) ? 'http' : 'https';
	return `${scheme}://${url.host}`;
}

/** An unguessable value: 32 random bytes as unpadded base64url (43 characters), for `state` and the PKCE verifier. */
export function randomToken(): string {
	const bytes = new Uint8Array(32);
	globalThis.crypto.getRandomValues(bytes);
	return base64url(bytes);
}

/** The PKCE `S256` challenge for `verifier` (RFC 7636 §4.2). */
export async function codeChallenge(verifier: string): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error('This page can’t sign in on another page here: it needs HTTPS or localhost.');
	return base64url(new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/**
 * `external.url` with this client's parameters added (§4.12.2): its own
 * query is kept, `client_id` only when it has none, and the rest replace any
 * the server put there (§4.12.1 says it puts none). Returns the URL and the
 * `client_id` it carries, which redeeming the code repeats.
 */
export function authorizationUrl(
	page: string,
	params: { client: AuthorizationClient; state: string; challenge: string; resource: string }
): { url: string; clientId: string } {
	const url = new URL(page);
	const query = url.searchParams;
	const clientId = query.get('client_id') || params.client.clientId;
	query.set('response_type', 'code');
	query.set('client_id', clientId);
	query.set('redirect_uri', params.client.redirectUri);
	query.set('code_challenge', params.challenge);
	query.set('code_challenge_method', 'S256');
	query.set('state', params.state);
	query.set('resource', params.resource);
	return { url: url.toString(), clientId };
}

/**
 * A new authorization request for `external`, from a server at the
 * WebSocket address `server`: a fresh `state` and PKCE verifier, and
 * `resource` worked out from that address, never from anything the server
 * said (§4.12.2).
 */
export async function authorizationRequest(external: External, server: string, client: AuthorizationClient): Promise<AuthorizationRequest> {
	const resource = serverOrigin(server);
	if (!resource) throw new Error('The server’s address isn’t a WebSocket URL.');
	const page = pageUrl(external.url);
	if (!page) throw new Error('The server sent a sign-in page this app can’t open.');
	const state = randomToken();
	const codeVerifier = randomToken();
	const { url, clientId } = authorizationUrl(page, { client, state, challenge: await codeChallenge(codeVerifier), resource });
	return { url, state, codeVerifier, redirectUri: client.redirectUri, clientId, resource };
}

/**
 * The page's answer, from the query it sent the user back with
 * (`?code=…&state=…&iss=…`, or `?error=access_denied&state=…`). Undefined
 * when the query carries neither a code nor an error.
 */
export function parseAuthorizationResponse(search: string): AuthorizationResponse | undefined {
	const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
	const code = query.get('code') || undefined;
	const error = query.get('error') || undefined;
	if (!code && !error) return undefined;
	const response: AuthorizationResponse = {};
	for (const [key, value] of [['state', query.get('state')], ['iss', query.get('iss')], ['errorDescription', query.get('error_description')]] as const) {
		if (value) response[key] = value;
	}
	if (error) response.error = error;
	else if (code) response.code = code;
	return response;
}

/** Why an answer can't be used, in words: a decline, a mismatched `state`, or another error from the page. */
export class AuthorizationError extends Error {
	constructor(message: string, readonly reason: 'declined' | 'state' | 'error' | 'closed') {
		super(message);
		this.name = 'AuthorizationError';
	}
}

/**
 * The redemption for `response`, an answer to `request`: only with the
 * request's own `state` (§4.12.2; otherwise the code may be someone else's,
 * to sign the user in to their account), and with a code. Throws an
 * `AuthorizationError` otherwise. `iss` isn't checked: the code goes only to
 * the server this client is connected to, which redeems it at its own issuer.
 */
export function redemption(request: Pick<AuthorizationRequest, 'state' | 'codeVerifier' | 'redirectUri' | 'clientId'>, response: AuthorizationResponse): CodeRedemption {
	if (!response.state || response.state !== request.state) throw new AuthorizationError('That sign-in came back for another request, so it wasn’t used. Try again.', 'state');
	if (response.error === 'access_denied') throw new AuthorizationError('Sign-in was cancelled.', 'declined');
	if (response.error || !response.code) {
		const detail = response.errorDescription || response.error;
		throw new AuthorizationError(`The sign-in page couldn’t sign you in${detail ? ` (${detail})` : ''}. Try again.`, 'error');
	}
	return { code: response.code, code_verifier: request.codeVerifier, redirect_uri: request.redirectUri, client_id: request.clientId };
}

function base64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
