import {
	AuthorizationError, authorizationRequest, redemption,
	type AuthorizationClient, type AuthorizationHints, type AuthorizationRequest, type AuthorizationResponse, type CodeRedemption, type External
} from '$lib/protocol/authorization';
import { loadKeptSessionUser } from '$lib/protocol/client-internals';
import type { PasskeyPageNeeded } from '$lib/protocol/passkey-route';
import { loadLastAccount } from './storage';
import { CHANNEL, PENDING_KEY, RETURNED_KEY } from './sign-in-window';

export { CHANNEL, PENDING_KEY, RETURNED_KEY, openSignInWindow, returnedWaiting, signInPageError } from './sign-in-window';
export { redemption };

/**
 * Signing in on a server's page (PROTOCOL.md §4.12, and the passkey page,
 * §4.10.1), as this app does it in a browser: the page
 * opens in a popup, or in this tab where the browser blocks one; it sends the
 * user back to this app's `CALLBACK_PATH` with `?code=…&state=…`; and the
 * code is redeemed on the connection. External sign-in, adding an external
 * sign-in, and a passkey whose RP ID this page can't use all go this way:
 * only their begin and their redemption differ (`AuthorizationPurpose`).
 *
 * It loads on demand, once a page is to be opened: what must run during the
 * tap (`openSignInWindow`) and as the app starts (`returnedWaiting`) is in
 * `sign-in-window.ts`, which loads with the app.
 *
 * What a request needs on the way back (its PKCE verifier, `state`, and
 * what it was for) is kept in `sessionStorage` until then: a popup's opener
 * reads it in place, and a page that left this tab finds it when it comes back.
 */

/** Where a sign-in page sends the user back, on this app's own origin (`src/routes/signed-in`). */
export const CALLBACK_PATH = '/signed-in/';

/**
 * This app's client ID metadata document (draft-ietf-oauth-client-id-metadata-document), `static/client-metadata.json`:
 * its URL is this app's `client_id` on `PRODUCTION_ORIGIN`, which the document describes. A server may fetch it, to
 * show the name beside the host and check the `redirect_uri`, or ignore it: any `client_id` works on a server that is
 * its own authorization server (§4.12.3).
 */
export const CLIENT_METADATA_PATH = '/client-metadata.json';
export const PRODUCTION_ORIGIN = 'https://web.apron.chat';

/**
 * The `client_id` on any other origin (development, Previews, a copy another host serves): the metadata document
 * there names production's redirect, which a server that reads it would refuse for this origin's.
 */
export const OTHER_CLIENT_ID = 'apron-web';

/** What this app sends as itself from `origin` (§4.12.2): its `client_id` and its `redirect_uri`. */
export function appClient(origin: string): AuthorizationClient {
	return {
		clientId: origin === PRODUCTION_ORIGIN ? `${origin}${CLIENT_METADATA_PATH}` : OTHER_CLIENT_ID,
		redirectUri: `${origin}${CALLBACK_PATH}`
	};
}

/**
 * What a request is for, which decides how its code is redeemed: an external
 * sign-in on a fresh connection (§4.12.2); an external identity added to the
 * signed-in `account` (§4.12.4); or a passkey ceremony's `webauthn` finish
 * step with the `action` of its begin, a registration's for the signed-in
 * `account` when there is one.
 */
export type AuthorizationPurpose =
	| { scheme: 'external'; kind: 'sign-in' }
	| { scheme: 'external'; kind: 'addition'; account: string }
	| { scheme: 'webauthn'; action: 'login' | 'register'; account?: string };

/** A request on its way, as kept until its answer comes back. */
export interface PendingAuthorization extends Pick<AuthorizationRequest, 'state' | 'codeVerifier' | 'redirectUri' | 'clientId'> {
	/** The server it is for, a `ws:`/`wss:` URL: the code goes only there. */
	server: string;
	purpose: AuthorizationPurpose;
	/** A display name to apply once signed in. */
	name?: string;
	/** Opened in a popup, whose opener waits for its answer; or in this tab, which the answer comes back to. */
	mode: 'popup' | 'page';
	/** Epoch milliseconds after which it is forgotten. */
	expires: number;
}

/** How long a request is kept: a code expires within minutes (§4.12.3), but the page may take a while to finish. */
export const PENDING_KEPT_MS = 30 * 60_000;

/** Keeps `pending`, in place of any other request to the same server: one at a time per server. */
export function rememberAuthorization(pending: PendingAuthorization, now = Date.now()): void {
	const kept = readPending(now).filter((entry) => entry.server !== pending.server && entry.state !== pending.state);
	writePending([...kept, pending]);
}

/** The request kept with this `state`, if this tab made it and it hasn't expired. */
export function findAuthorization(state: string | undefined, now = Date.now()): PendingAuthorization | undefined {
	return state ? readPending(now).find((entry) => entry.state === state) : undefined;
}

/** Forgets the request with this `state`: its answer came, or it was given up. */
export function forgetAuthorization(state: string, now = Date.now()): void {
	const kept = readPending(now);
	const left = kept.filter((entry) => entry.state !== state);
	if (left.length !== kept.length) writePending(left);
}

/**
 * Sends the user to `external`'s page for `purpose` on `server` (§4.12.2),
 * and resolves with what redeems the code that comes back. In `popup` (from
 * `openSignInWindow`) when there is one; else in this tab, which leaves this
 * app, and never resolves: the answer comes back to a fresh page load
 * (`takeReturned`). Rejects with an `AuthorizationError` for a decline, a
 * closed window, or an answer that isn't this request's; aborting `signal`
 * closes the window. `hints` go along in the page's URL (`AuthorizationHints`).
 */
export async function authorize(
	external: External, server: string, purpose: AuthorizationPurpose,
	options: { popup: Window | null; name?: string; signal?: AbortSignal; hints?: AuthorizationHints; location?: Pick<Location, 'origin' | 'assign'> }
): Promise<CodeRedemption> {
	const { popup } = options;
	const location = options.location ?? window.location;
	let request: AuthorizationRequest;
	try {
		request = await authorizationRequest(external, server, appClient(location.origin), options.hints);
		options.signal?.throwIfAborted();
	} catch (cause) {
		popup?.close();
		throw cause;
	}
	const pending: PendingAuthorization = {
		state: request.state, codeVerifier: request.codeVerifier, redirectUri: request.redirectUri, clientId: request.clientId,
		server, purpose, ...(options.name ? { name: options.name } : {}), mode: popup ? 'popup' : 'page', expires: Date.now() + PENDING_KEPT_MS
	};
	rememberAuthorization(pending);
	if (!popup) {
		location.assign(request.url);
		return new Promise<never>(() => undefined);
	}
	try {
		popup.location.href = request.url;
		return redemption(request, await answerFrom(popup, request.state, options.signal));
	} finally {
		forgetAuthorization(request.state);
	}
}

/**
 * The answer for `state`, from the callback page in `popup`
 * (`sign-in-callback.ts`). Answers for other requests (another tab's) are left
 * alone. A window closed without one rejects, after a moment for an answer
 * sent as it closed.
 */
export function answerFrom(popup: Pick<Window, 'closed' | 'close'>, state: string, signal?: AbortSignal, poll = 250): Promise<AuthorizationResponse> {
	return new Promise((resolve, reject) => {
		const channel = new BroadcastChannel(CHANNEL);
		let closedFor = 0;
		const timer = setInterval(() => {
			if (!popup.closed) return;
			closedFor += poll;
			if (closedFor > 1_000) end(() => reject(new AuthorizationError('The sign-in window was closed before signing in finished.', 'closed')));
		}, poll);
		const abort = () => {
			popup.close();
			end(() => reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')));
		};
		function end(settle: () => void): void {
			clearInterval(timer);
			channel.close();
			signal?.removeEventListener('abort', abort);
			settle();
		}
		channel.onmessage = (event: MessageEvent) => {
			const response = readResponse(event.data);
			if (response?.state === state) end(() => resolve(response));
		};
		if (signal?.aborted) abort();
		else signal?.addEventListener('abort', abort, { once: true });
	});
}

/**
 * The answer a page brought back to this tab, with the request it answers,
 * taken (and forgotten) as the app starts. Undefined when none came back, or
 * when it answers no request of this tab's: one that isn't ours is never used.
 */
export function takeReturned(now = Date.now()): { pending: PendingAuthorization; response: AuthorizationResponse } | undefined {
	let raw: string | null = null;
	try {
		raw = sessionStorage.getItem(RETURNED_KEY);
		if (raw !== null) sessionStorage.removeItem(RETURNED_KEY);
	} catch {
		return undefined;
	}
	if (!raw) return undefined;
	let response: AuthorizationResponse | undefined;
	try {
		response = readResponse(JSON.parse(raw));
	} catch {
		return undefined;
	}
	const pending = findAuthorization(response?.state, now);
	if (!response || !pending) return undefined;
	forgetAuthorization(pending.state, now);
	return { pending, response };
}

/**
 * External sign-in, or adding one (§4.12): begins on `server`, sends the
 * user to the page it names (`authorize`, in `popup` or this tab), and
 * redeems the code that comes back for `purpose`. Closes `popup` if it fails
 * before then.
 */
export async function externalOnPage(
	chat: AuthorizationFinisher & { beginExternal(url: string): Promise<External> }, server: string, purpose: Extract<AuthorizationPurpose, { scheme: 'external' }>,
	options: { popup: Window | null; name?: string; signal?: AbortSignal; beforeSwitch?: () => void }
): Promise<void> {
	let external: External;
	try {
		external = await chat.beginExternal(server);
		options.signal?.throwIfAborted();
	} catch (cause) {
		options.popup?.close();
		throw cause;
	}
	const redeem = await authorize(external, server, purpose, options);
	await finishAuthorization(chat, { server, purpose, ...(options.name ? { name: options.name } : {}) }, redeem, options.beforeSwitch);
}

/** What finishing a request needs of the chat client. */
export interface AuthorizationFinisher {
	readonly url: string;
	signInWithExternalCode(redeem: CodeRedemption, url: string, options: { name?: string; beforeSwitch?: () => void }): Promise<unknown>;
	addExternalWithCode(redeem: CodeRedemption, account: string): Promise<void>;
	finishPasskeyWithCode(action: 'register' | 'login', redeem: CodeRedemption, options: { server: string; account?: string; name?: string }): Promise<unknown>;
}

/** Redeems `redeem`, the code for `pending`'s request, as its purpose says (see `AuthorizationPurpose`). */
export async function finishAuthorization(
	chat: AuthorizationFinisher, pending: Pick<PendingAuthorization, 'server' | 'purpose' | 'name'>, redeem: CodeRedemption, beforeSwitch?: () => void
): Promise<void> {
	const { purpose, server, name } = pending;
	if (purpose.scheme === 'webauthn') {
		await chat.finishPasskeyWithCode(purpose.action, redeem, { server, ...(purpose.account !== undefined ? { account: purpose.account } : {}), ...(name ? { name } : {}) });
	} else if (purpose.kind === 'addition') {
		if (chat.url !== server) throw new Error('This page is connected to another server now, so that sign-in can’t be added here. Try again.');
		await chat.addExternalWithCode(redeem, purpose.account);
	} else {
		await chat.signInWithExternalCode(redeem, server, { ...(name ? { name } : {}), ...(beforeSwitch ? { beforeSwitch } : {}) });
	}
}

/**
 * Runs a passkey ceremony on the server's passkey page (`PasskeyPageNeeded`,
 * from `usePasskey`) and finishes it on `chat`'s connection, in `popup`
 * (`openSignInWindow`, opened by the caller as soon as it knew: after a
 * ceremony this page couldn't run, a browser may block it, and the page
 * then opens in this tab). A login tells the page what helps it choose the
 * RP ID to ask for first (`passkeyPageHints`).
 */
export async function passkeyOnPage(
	chat: AuthorizationFinisher, needed: PasskeyPageNeeded, options: { popup: Window | null; name?: string; signal?: AbortSignal }
): Promise<void> {
	const purpose: AuthorizationPurpose = { scheme: 'webauthn', action: needed.action, ...(needed.account !== undefined ? { account: needed.account } : {}) };
	const server = chat.url;
	const hints = passkeyPageHints(needed, server);
	const redeem = await authorize(needed.external, server, purpose, { ...options, ...(hints ? { hints } : {}) });
	await finishAuthorization(chat, { server, purpose, ...(options.name ? { name: options.name } : {}) }, redeem);
}

/**
 * The hints a login on `server`'s passkey page goes with (§4.10.1), if any:
 * `login_hint`, the account last signed in to it on this device (as noted
 * when a session there was ready, else the one whose session is saved
 * there); and `rp_id_last`, the RP ID that a ceremony in this page just
 * tried without a credential (`needed.rpIdLast`), for the page to ask for
 * last. A registration has none: it is for
 * a new passkey, not one already made for either RP ID.
 */
export function passkeyPageHints(needed: Pick<PasskeyPageNeeded, 'action' | 'rpIdLast'>, server: string): AuthorizationHints | undefined {
	if (needed.action !== 'login') return undefined;
	const account = loadLastAccount(server) ?? loadKeptSessionUser(server);
	const hints: AuthorizationHints = { ...(account ? { login_hint: account } : {}), ...(needed.rpIdLast ? { rp_id_last: needed.rpIdLast } : {}) };
	return hints.login_hint || hints.rp_id_last ? hints : undefined;
}

function readResponse(value: unknown): AuthorizationResponse | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const entry = value as Record<string, unknown>;
	const response: AuthorizationResponse = {};
	for (const key of ['state', 'code', 'iss', 'error', 'errorDescription'] as const) {
		if (typeof entry[key] === 'string') response[key] = entry[key] as string;
	}
	return response.code || response.error ? response : undefined;
}

function readPending(now: number): PendingAuthorization[] {
	let raw: string | null = null;
	try {
		raw = globalThis.sessionStorage?.getItem(PENDING_KEY) ?? null;
	} catch {
		// Storage can be unavailable (blocked site data): nothing is pending.
	}
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((entry): entry is PendingAuthorization => isPending(entry) && entry.expires > now) : [];
	} catch {
		return [];
	}
}

function writePending(list: PendingAuthorization[]): void {
	try {
		const storage = globalThis.sessionStorage;
		if (!storage) return;
		if (list.length) storage.setItem(PENDING_KEY, JSON.stringify(list));
		else storage.removeItem(PENDING_KEY);
	} catch {
		// Best effort: a popup's answer still comes back to the request in memory.
	}
}

function isPending(value: unknown): value is PendingAuthorization {
	if (typeof value !== 'object' || value === null) return false;
	const entry = value as Record<string, unknown>;
	const purpose = entry.purpose as Record<string, unknown> | undefined;
	return ['state', 'codeVerifier', 'redirectUri', 'clientId', 'server'].every((key) => typeof entry[key] === 'string')
		&& typeof entry.expires === 'number' && (entry.mode === 'popup' || entry.mode === 'page')
		&& typeof purpose === 'object' && purpose !== null
		&& ((purpose.scheme === 'external' && (purpose.kind === 'sign-in' || (purpose.kind === 'addition' && typeof purpose.account === 'string')))
			|| (purpose.scheme === 'webauthn' && (purpose.action === 'login' || purpose.action === 'register')));
}
