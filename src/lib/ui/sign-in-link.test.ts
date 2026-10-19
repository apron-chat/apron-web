import { describe, expect, it } from 'vitest';
import type { Proposal } from '$lib/protocol/proposals';
import { askedLinkFailure, codeStillFor, linkUse, parseSignInLink, returnUrl, runSignInLink, sessionSettled, signInLinkPrompt, takeSignInLink, type SignInLinkClient } from './sign-in-link';

describe('sign-in links (§4.11.2)', () => {
	it('reads the token, and the optional state and server, from the fragment', () => {
		expect(parseSignInLink('#token=Hk41x9')).toEqual({ token: 'Hk41x9' });
		expect(parseSignInLink('#x=1&token=Hk41x9')).toEqual({ token: 'Hk41x9' });
		expect(parseSignInLink('#token=Hk41x9&state=q8Rz&server=wss%3A%2F%2Fchat.example%2Fws')).toEqual({ token: 'Hk41x9', state: 'q8Rz', server: 'wss://chat.example/ws' });
	});

	it('refuses fragments without a token, and marks a server that isn’t a WebSocket URL', () => {
		expect(parseSignInLink('')).toBeUndefined();
		expect(parseSignInLink('#')).toBeUndefined();
		expect(parseSignInLink('#token=')).toBeUndefined();
		expect(parseSignInLink('#room')).toBeUndefined();
		expect(parseSignInLink('#token=1&server=https%3A%2F%2Fevil.example')).toEqual({ token: '1', badServer: true });
		expect(parseSignInLink('#token=1&state=s&server=')).toEqual({ token: '1', state: 's', badServer: true });
	});

	it('scrubs any sign-in fragment from the URL, keeping its path and query', () => {
		const replaced: string[] = [];
		const link = takeSignInLink({ hash: '#token=Hk41x9&state=s', pathname: '/login', search: '?x=1' }, (url: string) => replaced.push(url));
		expect(link).toEqual({ token: 'Hk41x9', state: 's' });
		expect(replaced).toEqual(['/login?x=1']);
		// An unusable one is scrubbed too; anything else in the fragment is left alone.
		expect(takeSignInLink({ hash: '#token=', pathname: '/', search: '' }, (url: string) => replaced.push(url))).toBeUndefined();
		expect(takeSignInLink({ hash: '#section', pathname: '/', search: '' }, (url: string) => replaced.push(url))).toBeUndefined();
		expect(replaced).toEqual(['/login?x=1', '/']);
	});

	it('reads the link before scrubbing a live location', () => {
		const location = { hash: '#token=9', pathname: '/', search: '' };
		expect(takeSignInLink(location, () => (location.hash = ''))).toEqual({ token: '9' });
	});

	const proposal = (fields: Partial<Proposal>): Proposal => ({ scheme: 'email', kind: 'sign-in', url: 'wss://home.example/', state: 's', expires: Infinity, ...fields });

	it('uses its own proposal’s server, ignoring the link’s, and asks about any other link', () => {
		const find = (proposals: Proposal[]) => (state: string | undefined) => proposals.find((entry) => entry.state === state);
		const ours = [proposal({ scheme: 'external' }), proposal({ state: 'add', kind: 'addition', account: 'ada' })];
		expect(linkUse({ token: 't', state: 's', server: 'wss://evil.example/' }, find(ours))).toEqual({ kind: 'own', token: 't', server: 'wss://home.example/', scheme: 'external', state: 's' });
		// Even a server that isn't one: it is ignored.
		expect(linkUse({ token: 't', state: 's', badServer: true }, find(ours))).toMatchObject({ kind: 'own', server: 'wss://home.example/' });
		expect(linkUse({ token: 't', state: 'add' }, find(ours))).toEqual({ kind: 'addition', token: 't', server: 'wss://home.example/', account: 'ada', state: 'add' });
		// Without the state of a proposal made here, the viewer is asked; and a bad server is never swapped for another.
		const stranger = { token: 't', state: 'theirs', server: 'wss://other.example/' };
		expect(linkUse(stranger, find(ours))).toEqual({ kind: 'ask', link: stranger });
		expect(linkUse({ token: 't' }, find(ours))).toEqual({ kind: 'ask', link: { token: 't' } });
		expect(linkUse({ token: 't', badServer: true }, find(ours))).toBeUndefined();
	});

	it('asks before using a link of no proposal here, naming the server and what continuing replaces', () => {
		const link = { token: '1' };
		const here = signInLinkPrompt(link, { url: 'wss://chat.example/', signedInAs: 'Bob (@bob)' });
		expect(here.title).toBe('Sign in to chat.example with this link?');
		expect(here.switchesServer).toBe(false);
		expect(here.lines.join(' ')).toMatch(/signed in here as Bob \(@bob\).*signs you out/);
		expect(here.lines.join(' ')).toMatch(/their account/);
		const elsewhere = signInLinkPrompt({ ...link, server: 'wss://other.example/' }, { url: 'wss://chat.example/', label: 'Chat' });
		expect(elsewhere.title).toBe('Sign in to other.example with this link?');
		expect(elsewhere.switchesServer).toBe(true);
		expect(elsewhere.lines[0]).toMatch(/not Chat/);
		// A kept session that hasn't resumed yet is still named.
		expect(signInLinkPrompt(link, { url: 'wss://chat.example/', keptSession: true }).lines[0]).toMatch(/saved session here/);
	});

	it('offers to add a link of no proposal here to the account signed in on its server, or to sign in with it', () => {
		const link = { token: '1' };
		const both = signInLinkPrompt(link, { url: 'wss://chat.example/', signedInAs: 'Ada (@ada)', addAs: 'Ada (@ada)' });
		expect(both.adds).toBe(true);
		expect(both.title).toBe('Use this link on chat.example?');
		expect(both.lines.join(' ')).toMatch(/add this way of signing in to Ada \(@ada\)/);
		expect(both.lines.join(' ')).toMatch(/signs you out of Ada \(@ada\)/);
		expect(both.lines.join(' ')).toMatch(/their account/);
		// Only on that server: on another, the page isn't signed in to anything the link could add to.
		const elsewhere = signInLinkPrompt({ ...link, server: 'wss://other.example/' }, { url: 'wss://chat.example/', addAs: 'Ada (@ada)' });
		expect(elsewhere.adds).toBe(false);
		expect(elsewhere.title).toBe('Sign in to other.example with this link?');
		expect(signInLinkPrompt(link, { url: 'wss://chat.example/' }).adds).toBe(false);
		// A refused one says it may have been for adding, and where that works; not to send a new code.
		expect(askedLinkFailure('Invalid token')).toMatch(/Invalid token.*add a way of signing in.*where you’re signed in to that account/);
		expect(askedLinkFailure('Invalid token')).not.toMatch(/code/);
	});

	it('waits for a kept session’s resume to settle before an addition’s link is given up on', () => {
		const server = { apron: 9, auth: ['email', 'token', 'guest'], capabilities: [] };
		const base = { status: 'connected' as const, authenticated: false, server };
		expect(sessionSettled({ ...base, authenticated: true })).toBe(true);
		expect(sessionSettled({ ...base, authenticated: true, authBusy: true })).toBe(false);
		expect(sessionSettled({ ...base, status: 'reconnecting', authenticated: true })).toBe(false);
		// Still resuming: no error yet, or one (a limit) while the resume is retried.
		expect(sessionSettled({ ...base, keptSession: true })).toBe(false);
		expect(sessionSettled({ ...base, keptSession: true, error: 'Slow down' })).toBe(false);
		// Past resuming: refused (held), or nothing to resume and failed.
		expect(sessionSettled({ ...base, held: true, error: 'Session expired' })).toBe(true);
		expect(sessionSettled({ ...base, error: 'Sign in with your email from the connect screen.' })).toBe(true);
		expect(sessionSettled({ ...base, server: { ...server, auth: ['email'] }, keptSession: true, error: 'No token resume' })).toBe(true);
		expect(sessionSettled(base)).toBe(false);
	});

	it('returns an external sign-in to this app’s own path', () => {
		expect(returnUrl({ origin: 'https://web.apron.chat', pathname: '/' })).toBe('https://web.apron.chat/');
		expect(returnUrl({ origin: 'http://localhost:5173', pathname: '/app/' })).toBe('http://localhost:5173/app/');
	});

	function fakeClient(url: string, outcome: 'ok' | 'refused'): SignInLinkClient & { calls: string[] } {
		const calls: string[] = [];
		let current = url;
		return {
			get url() { return current; },
			calls,
			async signInWithLink(token, server, options) {
				calls.push(`signIn ${token} on ${server}${options.scheme ? ` with ${options.scheme} for ${options.state}` : ''}`);
				if (outcome === 'refused') throw new Error('Invalid or expired token');
				options.beforeSwitch?.();
				current = server;
			}
		};
	}

	it('uses a confirmed link on its own server, and remembers the switch only once signed in', async () => {
		const chat = fakeClient('wss://home.example/', 'ok');
		const events: string[] = [];
		await runSignInLink({ kind: 'ask', link: { token: '9', server: 'wss://other.example/' } }, chat, {
			beforeSwitch: (switched) => events.push(`leave ${switched}`),
			onSignedIn: (server, switched) => events.push(`signed in ${server} ${switched}`),
			onFailed: () => events.push('failed')
		});
		expect(chat.calls).toEqual(['signIn 9 on wss://other.example/']);
		expect(events).toEqual(['leave true', 'signed in wss://other.example/ true']);
	});

	it('uses its own proposal’s link on the server proposed to, with its scheme and state', async () => {
		const chat = fakeClient('wss://home.example/', 'ok');
		const events: string[] = [];
		await runSignInLink({ kind: 'own', token: '9', server: 'wss://home.example/', scheme: 'external', state: 's' }, chat, {
			onSignedIn: (server, switched) => events.push(`signed in ${server} ${switched}`),
			onFailed: () => events.push('failed')
		});
		expect(chat.calls).toEqual(['signIn 9 on wss://home.example/ with external for s']);
		expect(events).toEqual(['signed in wss://home.example/ false']);
	});

	it('reports a refused link, changing nothing', async () => {
		const chat = fakeClient('wss://home.example/', 'refused');
		const events: string[] = [];
		await runSignInLink({ kind: 'ask', link: { token: '9', server: 'wss://other.example/' } }, chat, {
			beforeSwitch: () => events.push('leave'),
			onSignedIn: () => events.push('signed in'),
			onFailed: (error: string, server: string) => events.push(`${error} ${server}`)
		});
		expect(chat.url).toBe('wss://home.example/');
		expect(events).toEqual(['Invalid or expired token wss://other.example/']);
	});

	it('keeps a connect-screen code only for the server that sent it', () => {
		const sent = { scheme: 'email' as const, email: 'a@b', url: 'wss://a.example/' };
		expect(codeStillFor(sent, 'wss://a.example/')).toBe(sent);
		expect(codeStillFor(sent, 'wss://b.example/')).toBeUndefined();
		expect(codeStillFor(undefined, 'wss://a.example/')).toBeUndefined();
	});
});
