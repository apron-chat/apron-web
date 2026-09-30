import { describe, expect, it } from 'vitest';
import { codeStillFor, emailLinkPrompt, parseEmailLink, runEmailLink, takeEmailLink, type EmailLinkClient } from './email-link';

describe('emailed sign-in links (§4.10)', () => {
	it('reads the token and optional server from the fragment', () => {
		expect(parseEmailLink('#token=Hk41x9')).toEqual({ token: 'Hk41x9' });
		expect(parseEmailLink('#x=1&token=Hk41x9')).toEqual({ token: 'Hk41x9' });
		expect(parseEmailLink('#token=Hk41x9&server=wss%3A%2F%2Fchat.example%2Fws')).toEqual({ token: 'Hk41x9', server: 'wss://chat.example/ws' });
		// An address, as earlier drafts' links carried, is not needed and not used.
		expect(parseEmailLink('#email=ada%40example.com&token=418092')).toEqual({ token: '418092' });
	});

	it('refuses fragments that are not a complete link, or name a server that isn’t a WebSocket URL', () => {
		expect(parseEmailLink('')).toBeUndefined();
		expect(parseEmailLink('#')).toBeUndefined();
		expect(parseEmailLink('#email=ada%40example.com')).toBeUndefined();
		expect(parseEmailLink('#token=')).toBeUndefined();
		expect(parseEmailLink('#room')).toBeUndefined();
		expect(parseEmailLink('#token=1&server=https%3A%2F%2Fevil.example')).toBeUndefined();
		expect(parseEmailLink('#token=1&server=')).toBeUndefined();
	});

	it('scrubs any sign-in fragment from the URL, keeping its path and query', () => {
		const replaced: string[] = [];
		const link = takeEmailLink({ hash: '#token=Hk41x9', pathname: '/login', search: '?x=1' }, (url) => replaced.push(url));
		expect(link).toEqual({ token: 'Hk41x9' });
		expect(replaced).toEqual(['/login?x=1']);
		// An unusable one is scrubbed too; anything else in the fragment is left alone.
		expect(takeEmailLink({ hash: '#token=1&server=javascript%3Aalert(1)', pathname: '/', search: '' }, (url) => replaced.push(url))).toBeUndefined();
		expect(takeEmailLink({ hash: '#email=a%40b', pathname: '/', search: '' }, (url) => replaced.push(url))).toBeUndefined();
		expect(takeEmailLink({ hash: '#section', pathname: '/', search: '' }, (url) => replaced.push(url))).toBeUndefined();
		expect(replaced).toEqual(['/login?x=1', '/', '/']);
	});

	it('reads the link before scrubbing a live location', () => {
		const location = { hash: '#token=9', pathname: '/', search: '' };
		expect(takeEmailLink(location, () => (location.hash = ''))).toEqual({ token: '9' });
	});

	it('asks before use, naming the server and what continuing replaces', () => {
		const link = { token: '1' };
		const here = emailLinkPrompt(link, { url: 'wss://chat.example/', signedInAs: 'Bob (@bob)' });
		expect(here.title).toBe('Sign in to chat.example with this email link?');
		expect(here.switchesServer).toBe(false);
		expect(here.lines.join(' ')).toMatch(/signed in here as Bob \(@bob\).*signs you out/);
		expect(here.lines.join(' ')).toMatch(/their account/);
		const elsewhere = emailLinkPrompt({ ...link, server: 'wss://other.example/' }, { url: 'wss://chat.example/', label: 'Chat' });
		expect(elsewhere.title).toBe('Sign in to other.example with this email link?');
		expect(elsewhere.switchesServer).toBe(true);
		expect(elsewhere.lines[0]).toMatch(/not Chat/);
		// A kept session that hasn't resumed yet is still named.
		expect(emailLinkPrompt(link, { url: 'wss://chat.example/', keptSession: true }).lines[0]).toMatch(/saved session here/);
	});

	function fakeClient(url: string, outcome: 'ok' | 'refused'): EmailLinkClient & { calls: string[] } {
		const calls: string[] = [];
		let current = url;
		return {
			get url() { return current; },
			calls,
			async signInWithEmailLink(token: string, server: string, beforeSwitch?: () => void) {
				calls.push(`signIn ${token} on ${server}`);
				if (outcome === 'refused') throw new Error('Invalid or expired token');
				beforeSwitch?.();
				current = server;
			}
		};
	}

	it('uses a confirmed link on its own server, and remembers the switch only once signed in', async () => {
		const chat = fakeClient('wss://home.example/', 'ok');
		const events: string[] = [];
		await runEmailLink({ token: '9', server: 'wss://other.example/' }, chat, {
			beforeSwitch: (switched) => events.push(`leave ${switched}`),
			onSignedIn: (server, switched) => events.push(`signed in ${server} ${switched}`),
			onFailed: () => events.push('failed')
		});
		expect(chat.calls).toEqual(['signIn 9 on wss://other.example/']);
		expect(events).toEqual(['leave true', 'signed in wss://other.example/ true']);
	});

	it('reports a refused link, changing nothing', async () => {
		const chat = fakeClient('wss://home.example/', 'refused');
		const events: string[] = [];
		await runEmailLink({ token: '9', server: 'wss://other.example/' }, chat, {
			beforeSwitch: () => events.push('leave'),
			onSignedIn: () => events.push('signed in'),
			onFailed: (error, server) => events.push(`${error} ${server}`)
		});
		expect(chat.url).toBe('wss://home.example/');
		expect(events).toEqual(['Invalid or expired token wss://other.example/']);
	});

	it('keeps a connect-screen code only for the server that sent it', () => {
		const sent = { email: 'a@b', url: 'wss://a.example/' };
		expect(codeStillFor(sent, 'wss://a.example/')).toBe(sent);
		expect(codeStillFor(sent, 'wss://b.example/')).toBeUndefined();
		expect(codeStillFor(undefined, 'wss://a.example/')).toBeUndefined();
	});
});
