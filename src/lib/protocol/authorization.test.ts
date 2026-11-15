import { describe, expect, it } from 'vitest';
import {
	AuthorizationError, authorizationRequest, authorizationUrl, codeChallenge, pageUrl, parseAuthorizationResponse, parseExternal, randomToken, redemption, serverOrigin
} from './authorization';

/** The authorization code flow that `external` (§4.12) and the passkey page share: the URL, the answer, and its redemption. */
describe('authorization requests', () => {
	const client = { clientId: 'https://web.example/client-metadata.json', redirectUri: 'https://web.example/signed-in/' };

	it('works out the server’s origin from its WebSocket address, port and all, never its path', () => {
		expect(serverOrigin('wss://chat.example/ws')).toBe('https://chat.example');
		expect(serverOrigin('wss://chat.example:8443/apron/ws')).toBe('https://chat.example:8443');
		// The scheme's default port is no port: wss's 443 is https's.
		expect(serverOrigin('wss://chat.example:443/')).toBe('https://chat.example');
		expect(serverOrigin('wss://CHAT.Example/')).toBe('https://chat.example');
		expect(serverOrigin('wss://[2001:db8::1]:9000/')).toBe('https://[2001:db8::1]:9000');
		// Loopback `ws:`, as in development, is the `http` server it is.
		expect(serverOrigin('ws://127.0.0.1:8080/ws')).toBe('http://127.0.0.1:8080');
		expect(serverOrigin('ws://localhost:8787/')).toBe('http://localhost:8787');
		expect(serverOrigin('ws://[::1]:8080/')).toBe('http://[::1]:8080');
		// Any other `ws:` server's origin is `https://` (§4.12.1).
		expect(serverOrigin('ws://chat.example:8080/')).toBe('https://chat.example:8080');
		for (const refused of ['https://chat.example/', 'chat.example', '', 'wss:///']) expect(serverOrigin(refused)).toBeUndefined();
	});

	it('keeps the page’s own query and adds the request’s parameters', () => {
		const { url, clientId } = authorizationUrl('https://chat.example/passkey?action=register&name=Ada%20L', { client, state: 'q8Rz', challenge: 'E9Mel', resource: 'https://chat.example' });
		const parsed = new URL(url);
		expect(parsed.origin + parsed.pathname).toBe('https://chat.example/passkey');
		expect(Object.fromEntries(parsed.searchParams)).toEqual({
			action: 'register', name: 'Ada L', response_type: 'code', client_id: client.clientId, redirect_uri: client.redirectUri,
			code_challenge: 'E9Mel', code_challenge_method: 'S256', state: 'q8Rz', resource: 'https://chat.example'
		});
		expect(clientId).toBe(client.clientId);
	});

	it('sends the page’s own client_id once, and redeems with it', () => {
		// A server naming a foreign issuer puts a client_id that issuer accepts in `url` (§4.12.1).
		const { url, clientId } = authorizationUrl('https://id.example/authorize?client_id=apron-public&scope=openid', { client, state: 's', challenge: 'c', resource: 'https://chat.example' });
		const query = new URL(url).searchParams;
		expect(query.getAll('client_id')).toEqual(['apron-public']);
		expect(query.get('scope')).toBe('openid');
		expect(clientId).toBe('apron-public');
		// A parameter of the request's own that the server put there anyway is replaced, never sent twice.
		const replaced = new URL(authorizationUrl('https://chat.example/oauth/authorize?state=theirs&resource=https://other.example', { client, state: 'ours', challenge: 'c', resource: 'https://chat.example' }).url).searchParams;
		expect(replaced.getAll('state')).toEqual(['ours']);
		expect(replaced.getAll('resource')).toEqual(['https://chat.example']);
	});

	it('makes a request with a fresh state and an S256 challenge, for the server it is connected to', async () => {
		const request = await authorizationRequest({ url: 'https://chat.example/oauth/authorize' }, 'wss://chat.example/ws', client);
		const query = new URL(request.url).searchParams;
		expect(request.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(request.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(query.get('state')).toBe(request.state);
		expect(query.get('code_challenge')).toBe(await codeChallenge(request.codeVerifier));
		expect(query.get('resource')).toBe('https://chat.example');
		expect(request).toMatchObject({ redirectUri: client.redirectUri, clientId: client.clientId, resource: 'https://chat.example' });
		// `resource` comes from the address connected to, never from the page the server named (§4.12.2).
		const elsewhere = await authorizationRequest({ url: 'https://other.example/oauth/authorize' }, 'wss://chat.example/', client);
		expect(new URL(elsewhere.url).searchParams.get('resource')).toBe('https://chat.example');
		await expect(authorizationRequest({ url: 'javascript:alert(1)' }, 'wss://chat.example/', client)).rejects.toThrow('can’t open');
		expect(randomToken()).not.toBe(randomToken());
	});

	it('computes the PKCE challenge of RFC 7636’s example', async () => {
		await expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
	});

	it('opens only an absolute https page, or http on a loopback host', () => {
		expect(pageUrl('https://chat.example/oauth/authorize?p=1')).toBe('https://chat.example/oauth/authorize?p=1');
		for (const loopback of ['http://localhost:8080/sso', 'http://127.0.0.1/sso', 'http://[::1]:3000/', 'http://app.localhost/']) {
			expect(pageUrl(loopback)).toBe(new URL(loopback).toString());
		}
		for (const refused of ['javascript:alert(1)', 'data:text/html,hi', 'http://chat.example/sso', 'http://128.0.0.1/', '/sso', 'sso', 'wss://chat.example/', '', undefined, 3]) {
			expect(pageUrl(refused)).toBeUndefined();
		}
		expect(parseExternal({ url: 'https://chat.example/oauth/authorize', issuer: 'https://id.example' })).toEqual({ url: 'https://chat.example/oauth/authorize', issuer: 'https://id.example' });
		expect(parseExternal({ url: 'javascript:alert(1)' })).toBeUndefined();
		expect(parseExternal('https://chat.example/')).toBeUndefined();
	});
});

describe('authorization responses', () => {
	const request = { state: 'q8Rz', codeVerifier: 'dBjftJ', redirectUri: 'https://web.example/signed-in/', clientId: 'apron-web' };

	it('reads a code or an error from the query it came back with', () => {
		expect(parseAuthorizationResponse('?code=Hk41x9&state=q8Rz&iss=https%3A%2F%2Fchat.example')).toEqual({ code: 'Hk41x9', state: 'q8Rz', iss: 'https://chat.example' });
		expect(parseAuthorizationResponse('error=access_denied&state=q8Rz')).toEqual({ error: 'access_denied', state: 'q8Rz' });
		expect(parseAuthorizationResponse('?error=server_error&error_description=Try+later&state=q8Rz')).toEqual({ error: 'server_error', errorDescription: 'Try later', state: 'q8Rz' });
		// An error wins over a code beside it.
		expect(parseAuthorizationResponse('?error=access_denied&code=x&state=q8Rz')).toEqual({ error: 'access_denied', state: 'q8Rz' });
		expect(parseAuthorizationResponse('')).toBeUndefined();
		expect(parseAuthorizationResponse('?state=q8Rz')).toBeUndefined();
	});

	it('redeems only its own state’s code, with the request’s verifier, redirect and client_id', () => {
		expect(redemption(request, { code: 'Hk41x9', state: 'q8Rz', iss: 'https://anything.example' })).toEqual({
			code: 'Hk41x9', code_verifier: 'dBjftJ', redirect_uri: 'https://web.example/signed-in/', client_id: 'apron-web'
		});
		// Someone else's code, or none of ours: never used (login CSRF).
		for (const response of [{ code: 'Hk41x9', state: 'other' }, { code: 'Hk41x9' }, { code: 'Hk41x9', state: '' }]) {
			expect(() => redemption(request, response)).toThrow(expect.objectContaining({ reason: 'state' }));
		}
		// A decline is a cancel; any other error says what the page said.
		expect(() => redemption(request, { error: 'access_denied', state: 'q8Rz' })).toThrow('Sign-in was cancelled.');
		expect(() => redemption(request, { error: 'server_error', errorDescription: 'Try later', state: 'q8Rz' })).toThrow('(Try later)');
		// A decline for another request isn't ours to show either.
		expect(() => redemption(request, { error: 'access_denied', state: 'other' })).toThrow(AuthorizationError);
		expect(() => redemption(request, { error: 'access_denied', state: 'other' })).toThrow(expect.objectContaining({ reason: 'state' }));
	});
});
