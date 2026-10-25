import { describe, expect, it } from 'vitest';
import type { Proposal } from '$lib/protocol/proposals';
import { askedLinkFailure, codeStillFor, linkUse, parseSignInLink, returnUrl, sessionSettled, signInLinkPrompt, takeSignInLink } from './sign-in-link';

describe('sign-in links (§4.11.2)', () => {
	it('reads the token, and the optional state and server, from the fragment, refusing one without a token and marking a server that isn’t a WebSocket URL', () => {
		expect(parseSignInLink('#token=Hk41x9')).toEqual({ token: 'Hk41x9' });
		expect(parseSignInLink('#x=1&token=Hk41x9')).toEqual({ token: 'Hk41x9' });
		expect(parseSignInLink('#token=Hk41x9&state=q8Rz&server=wss%3A%2F%2Fchat.example%2Fws')).toEqual({ token: 'Hk41x9', state: 'q8Rz', server: 'wss://chat.example/ws' });
		// None without a token; a server that isn’t a WebSocket URL is marked.
		expect(parseSignInLink('')).toBeUndefined();
		expect(parseSignInLink('#')).toBeUndefined();
		expect(parseSignInLink('#token=')).toBeUndefined();
		expect(parseSignInLink('#room')).toBeUndefined();
		expect(parseSignInLink('#token=1&server=https%3A%2F%2Fevil.example')).toEqual({ token: '1', badServer: true });
		expect(parseSignInLink('#token=1&state=s&server=')).toEqual({ token: '1', state: 's', badServer: true });
	});

	it('scrubs the token and state from the URL, keeping its path, query and other keys, after reading it', () => {
		const replaced: string[] = [];
		const link = takeSignInLink({ hash: '#token=Hk41x9&state=s', pathname: '/login', search: '?x=1' }, (url: string) => replaced.push(url));
		expect(link).toEqual({ token: 'Hk41x9', state: 's' });
		expect(replaced).toEqual(['/login?x=1']);
		// An unusable one is scrubbed too; anything else in the fragment is left alone.
		expect(takeSignInLink({ hash: '#token=', pathname: '/', search: '' }, (url: string) => replaced.push(url))).toBeUndefined();
		expect(takeSignInLink({ hash: '#section', pathname: '/', search: '' }, (url: string) => replaced.push(url))).toBeUndefined();
		expect(replaced).toEqual(['/login?x=1', '/']);
		// A place link.apron.chat passed with the token stays (Appendix A.4).
		expect(takeSignInLink({ hash: '#server=wss://chat.example/ws&room=general&token=apron_invite_x', pathname: '/', search: '' }, (url: string) => replaced.push(url))).toEqual({ token: 'apron_invite_x', server: 'wss://chat.example/ws' });
		expect(replaced.at(-1)).toBe('/#server=wss%3A%2F%2Fchat.example%2Fws&room=general');
		// Read before a live location is scrubbed.
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

	it('keeps a connect-screen code only for the server that sent it', () => {
		const sent = { scheme: 'email' as const, email: 'a@b', url: 'wss://a.example/' };
		expect(codeStillFor(sent, 'wss://a.example/')).toBe(sent);
		expect(codeStillFor(sent, 'wss://b.example/')).toBeUndefined();
		expect(codeStillFor(undefined, 'wss://a.example/')).toBeUndefined();
	});
});
