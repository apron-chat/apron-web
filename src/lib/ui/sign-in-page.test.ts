import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '$lib/protocol/authorization';
import { PasskeyPageNeeded } from '$lib/protocol/passkey-route';
import { memoryStorage } from '$lib/test/storage';
import metadataText from '../../../static/client-metadata.json?raw';
import {
	CALLBACK_PATH, CHANNEL, CLIENT_METADATA_PATH, OTHER_CLIENT_ID, PENDING_KEY, PRODUCTION_ORIGIN, RETURNED_KEY, answerFrom, appClient, authorize, finishAuthorization, findAuthorization,
	forgetAuthorization, openSignInWindow, passkeyOnPage, rememberAuthorization, takeReturned, type AuthorizationFinisher, type PendingAuthorization
} from './sign-in-page';
import * as callback from './sign-in-callback';
import { receiveCallback } from './sign-in-callback';

/** Signing in on a server's page in a browser (§4.12, the passkey page): popup or this tab, the way back, and redemption. */
const values = new Map<string, string>();

beforeEach(() => {
	values.clear();
	vi.stubGlobal('sessionStorage', memoryStorage(values));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const redeem = { code: 'Hk41x9', code_verifier: 'dBjftJ', redirect_uri: 'https://web.example/signed-in/', client_id: 'apron-web' };

function pending(state: string, overrides: Partial<PendingAuthorization> = {}): PendingAuthorization {
	return {
		state, codeVerifier: 'v', redirectUri: 'https://web.example/signed-in/', clientId: 'apron-web', server: 'wss://chat.example/',
		purpose: { scheme: 'external', kind: 'sign-in' }, mode: 'page', expires: Date.now() + 60_000, ...overrides
	};
}

/** A window that a test closes, as a popup closes itself. */
function fakePopup(): Window & { href?: string } {
	const popup = { closed: false, close: vi.fn(() => (popup.closed = true)), location: {} as { href?: string } };
	return popup as unknown as Window & { href?: string };
}

/** Posts `response` as the callback page in a popup does. */
function answer(response: Record<string, string>): void {
	const channel = new BroadcastChannel('apron.authorization');
	channel.postMessage(response);
	channel.close();
}

describe('this app as a client', () => {
	it('names itself by its metadata document in production, and returns to /signed-in/ on its own origin', () => {
		expect(appClient(PRODUCTION_ORIGIN)).toEqual({ clientId: `${PRODUCTION_ORIGIN}${CLIENT_METADATA_PATH}`, redirectUri: `${PRODUCTION_ORIGIN}${CALLBACK_PATH}` });
		// Elsewhere the document would name another redirect: a plain client_id, which any server accepts.
		expect(appClient('http://localhost:5173')).toEqual({ clientId: OTHER_CLIENT_ID, redirectUri: 'http://localhost:5173/signed-in/' });
		expect(appClient('https://branch-apron-web.shazow.workers.dev')).toEqual({ clientId: OTHER_CLIENT_ID, redirectUri: 'https://branch-apron-web.shazow.workers.dev/signed-in/' });
	});

	it('serves a metadata document that lists exactly what it sends', () => {
		const document = JSON.parse(metadataText) as Record<string, unknown>;
		const client = appClient(PRODUCTION_ORIGIN);
		expect(document.client_id).toBe(client.clientId);
		expect(document.redirect_uris).toEqual([client.redirectUri]);
		expect(document).toMatchObject({ client_name: 'Apron', token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] });
	});
});

describe('requests kept for the way back', () => {
	it('keeps one per server until its answer comes, or it expires', () => {
		rememberAuthorization(pending('a'), 0);
		rememberAuthorization(pending('b', { server: 'wss://other.example/' }), 0);
		expect(findAuthorization('a', 0)?.server).toBe('wss://chat.example/');
		// A new request to the same server replaces the last.
		rememberAuthorization(pending('c'), 0);
		expect(findAuthorization('a', 0)).toBeUndefined();
		expect(findAuthorization('b', 0)).toBeDefined();
		forgetAuthorization('b', 0);
		expect(findAuthorization('b', 0)).toBeUndefined();
		expect(findAuthorization('c', Date.now() + 120_000)).toBeUndefined();
		expect(findAuthorization(undefined)).toBeUndefined();
		values.set('apron.authorizations', '[{"state":"x"}, 3]');
		expect(findAuthorization('x')).toBeUndefined();
	});
});

describe('the callback page', () => {
	it('keeps its requests and answers where the app does', () => {
		expect([callback.PENDING_KEY, callback.RETURNED_KEY, callback.CHANNEL]).toEqual([PENDING_KEY, RETURNED_KEY, CHANNEL]);
	});

	it('brings a request that left this tab back to the app, without the code in the address', () => {
		rememberAuthorization(pending('q8Rz'));
		const replace = vi.fn();
		const close = vi.fn();
		expect(receiveCallback({ search: '?code=Hk41x9&state=q8Rz&iss=https%3A%2F%2Fchat.example', replace }, close)).toBe('page');
		expect(replace).toHaveBeenCalledWith('/');
		expect(close).not.toHaveBeenCalled();
		// The app takes it as it starts, once, with the request it answers.
		const returned = takeReturned();
		expect(returned?.pending.state).toBe('q8Rz');
		expect(returned?.response).toEqual({ code: 'Hk41x9', state: 'q8Rz', iss: 'https://chat.example' });
		expect(takeReturned()).toBeUndefined();
		expect(findAuthorization('q8Rz')).toBeUndefined();
	});

	it('hands a popup’s answer to the tab that opened it, and closes', async () => {
		const heard = new Promise<unknown>((resolve) => {
			const channel = new BroadcastChannel('apron.authorization');
			channel.onmessage = (event) => {
				channel.close();
				resolve(event.data);
			};
		});
		const close = vi.fn();
		expect(receiveCallback({ search: '?error=access_denied&state=s1', replace: vi.fn() }, close)).toBe('popup');
		expect(close).toHaveBeenCalled();
		await expect(heard).resolves.toEqual({ error: 'access_denied', state: 's1' });
		// Nothing for the app in this tab.
		expect(takeReturned()).toBeUndefined();
	});

	it('does nothing with an address that carries no answer, or an answer to no request of this tab’s', () => {
		expect(receiveCallback({ search: '', replace: vi.fn() }, vi.fn())).toBe('none');
		values.set('apron.authorization-returned', JSON.stringify({ code: 'x', state: 'not-ours' }));
		expect(takeReturned()).toBeUndefined();
		expect(values.has('apron.authorization-returned')).toBe(false);
	});
});

describe('authorize', () => {
	const external = { url: 'https://chat.example/oauth/authorize?scope=chat' };

	it('sends this tab to the page where there is no popup, keeping what the way back needs', async () => {
		const assign = vi.fn();
		void authorize(external, 'wss://chat.example/ws', { scheme: 'external', kind: 'sign-in' }, { popup: null, name: 'Ada', location: { origin: 'https://web.example', assign } });
		await vi.waitFor(() => expect(assign).toHaveBeenCalled());
		const url = new URL(assign.mock.calls[0][0] as string);
		expect(url.searchParams.get('scope')).toBe('chat');
		expect(url.searchParams.get('resource')).toBe('https://chat.example');
		expect(url.searchParams.get('redirect_uri')).toBe('https://web.example/signed-in/');
		const kept = findAuthorization(url.searchParams.get('state')!);
		expect(kept).toMatchObject({ mode: 'page', server: 'wss://chat.example/ws', name: 'Ada', purpose: { scheme: 'external', kind: 'sign-in' }, clientId: 'apron-web' });
	});

	it('opens the page in the popup and redeems the answer to its own state only', async () => {
		const popup = fakePopup();
		const location = { origin: 'https://web.example', assign: vi.fn() };
		const done = authorize(external, 'wss://chat.example/', { scheme: 'external', kind: 'sign-in' }, { popup, location });
		await vi.waitFor(() => expect(popup.location.href).toBeDefined());
		const state = new URL(popup.location.href!).searchParams.get('state')!;
		expect(findAuthorization(state)?.mode).toBe('popup');
		// Another tab's answer is left alone.
		answer({ code: 'theirs', state: 'another' });
		answer({ code: 'Hk41x9', state, iss: 'https://chat.example' });
		const redeemed = await done;
		expect(redeemed).toMatchObject({ code: 'Hk41x9', redirect_uri: 'https://web.example/signed-in/', client_id: 'apron-web' });
		expect(redeemed.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(findAuthorization(state)).toBeUndefined();
		expect(location.assign).not.toHaveBeenCalled();
	});

	it('says a decline is a cancel, and forgets the request', async () => {
		const popup = fakePopup();
		const done = authorize(external, 'wss://chat.example/', { scheme: 'external', kind: 'sign-in' }, { popup, location: { origin: 'https://web.example', assign: vi.fn() } });
		await vi.waitFor(() => expect(popup.location.href).toBeDefined());
		const state = new URL(popup.location.href!).searchParams.get('state')!;
		answer({ error: 'access_denied', state });
		await expect(done).rejects.toThrow('Sign-in was cancelled.');
		expect(findAuthorization(state)).toBeUndefined();
	});

	it('closes the popup when aborted, and the popup for a page it can’t open', async () => {
		const popup = fakePopup();
		const abort = new AbortController();
		const done = authorize(external, 'wss://chat.example/', { scheme: 'external', kind: 'sign-in' }, { popup, signal: abort.signal, location: { origin: 'https://web.example', assign: vi.fn() } });
		await vi.waitFor(() => expect(popup.location.href).toBeDefined());
		abort.abort();
		await expect(done).rejects.toMatchObject({ name: 'AbortError' });
		expect(popup.close).toHaveBeenCalled();
		const other = fakePopup();
		await expect(authorize({ url: 'javascript:alert(1)' }, 'wss://chat.example/', { scheme: 'external', kind: 'sign-in' }, { popup: other, location: { origin: 'https://web.example', assign: vi.fn() } })).rejects.toThrow('can’t open');
		expect(other.close).toHaveBeenCalled();
	});
});

describe('answerFrom', () => {
	it('gives up once the window is closed without an answer, after a moment for one sent as it closed', async () => {
		vi.useFakeTimers();
		const popup = { closed: false, close: vi.fn() };
		const waiting = answerFrom(popup, 's1');
		const failed = waiting.catch((cause: unknown) => cause);
		popup.closed = true;
		await vi.advanceTimersByTimeAsync(750);
		await vi.advanceTimersByTimeAsync(1_000);
		const cause = await failed;
		expect(cause).toBeInstanceOf(AuthorizationError);
		expect(cause).toMatchObject({ reason: 'closed', message: 'The sign-in window was closed before signing in finished.' });
	});
});

describe('finishing', () => {
	function finisher(url = 'wss://chat.example/'): AuthorizationFinisher & { [K in 'signInWithExternalCode' | 'addExternalWithCode' | 'finishPasskeyWithCode']: ReturnType<typeof vi.fn> } {
		return { url, signInWithExternalCode: vi.fn(async () => undefined), addExternalWithCode: vi.fn(async () => undefined), finishPasskeyWithCode: vi.fn(async () => undefined) };
	}

	it('redeems each purpose its own way', async () => {
		const chat = finisher();
		const beforeSwitch = vi.fn();
		await finishAuthorization(chat, { server: 'wss://other.example/', purpose: { scheme: 'external', kind: 'sign-in' }, name: 'Ada' }, redeem, beforeSwitch);
		expect(chat.signInWithExternalCode).toHaveBeenCalledWith(redeem, 'wss://other.example/', { name: 'Ada', beforeSwitch });
		await finishAuthorization(chat, { server: 'wss://chat.example/', purpose: { scheme: 'external', kind: 'addition', account: 'ada' } }, redeem);
		expect(chat.addExternalWithCode).toHaveBeenCalledWith(redeem, 'ada');
		await finishAuthorization(chat, { server: 'wss://chat.example/', purpose: { scheme: 'webauthn', action: 'register', account: 'ada' }, name: 'Ada' }, redeem);
		expect(chat.finishPasskeyWithCode).toHaveBeenCalledWith('register', redeem, { server: 'wss://chat.example/', account: 'ada', name: 'Ada' });
		// An addition only on the server it began on.
		await expect(finishAuthorization(chat, { server: 'wss://other.example/', purpose: { scheme: 'external', kind: 'addition', account: 'ada' } }, redeem)).rejects.toThrow('another server');
	});

	it('runs a passkey ceremony on the passkey page in this tab where no popup opens', async () => {
		const assign = vi.fn();
		vi.stubGlobal('window', { open: () => null, location: { origin: 'https://web.example', assign } });
		void passkeyOnPage(finisher(), new PasskeyPageNeeded('register', { url: 'https://chat.example/passkey?action=register&request=rq_7' }, 'ada'), { popup: openSignInWindow(), name: 'Ada' });
		await vi.waitFor(() => expect(assign).toHaveBeenCalled());
		const url = new URL(assign.mock.calls[0][0] as string);
		expect(url.searchParams.get('action')).toBe('register');
		expect(url.searchParams.get('request')).toBe('rq_7');
		expect(findAuthorization(url.searchParams.get('state')!)).toMatchObject({ mode: 'page', name: 'Ada', purpose: { scheme: 'webauthn', action: 'register', account: 'ada' } });
	});
});
