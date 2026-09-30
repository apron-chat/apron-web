import { describe, expect, it } from 'vitest';
import { codeStillFor, emailLinkPrompt, parseEmailLink, runEmailLink, takeEmailLink, type EmailLinkClient } from './email-link';

describe('emailed sign-in links (§4.10)', () => {
	it('reads the address, token, and optional server from the fragment', () => {
		expect(parseEmailLink('#email=ada%40example.com&token=418092')).toEqual({ email: 'ada@example.com', token: '418092' });
		expect(parseEmailLink('#token=418092&email=ada@example.com&x=1')).toEqual({ email: 'ada@example.com', token: '418092' });
		expect(parseEmailLink('#email=ada%40example.com&token=1&server=wss%3A%2F%2Fchat.example%2Fws')).toEqual({ email: 'ada@example.com', token: '1', server: 'wss://chat.example/ws' });
	});

	it('refuses fragments that are not a complete link, or name a server that isn’t a WebSocket URL', () => {
		expect(parseEmailLink('')).toBeUndefined();
		expect(parseEmailLink('#')).toBeUndefined();
		expect(parseEmailLink('#email=ada%40example.com')).toBeUndefined();
		expect(parseEmailLink('#token=1&email=')).toBeUndefined();
		expect(parseEmailLink('#room')).toBeUndefined();
		expect(parseEmailLink('#email=a%40b&token=1&server=https%3A%2F%2Fevil.example')).toBeUndefined();
		expect(parseEmailLink('#email=a%40b&token=1&server=')).toBeUndefined();
	});

	it('scrubs any sign-in fragment from the URL, keeping its path and query', () => {
		const replaced: string[] = [];
		const link = takeEmailLink({ hash: '#email=ada%40example.com&token=418092', pathname: '/login', search: '?x=1' }, (url) => replaced.push(url));
		expect(link).toEqual({ email: 'ada@example.com', token: '418092' });
		expect(replaced).toEqual(['/login?x=1']);
		// An unusable one is scrubbed too; anything else in the fragment is left alone.
		expect(takeEmailLink({ hash: '#token=1&server=javascript%3Aalert(1)', pathname: '/', search: '' }, (url) => replaced.push(url))).toBeUndefined();
		expect(takeEmailLink({ hash: '#section', pathname: '/', search: '' }, (url) => replaced.push(url))).toBeUndefined();
		expect(replaced).toEqual(['/login?x=1', '/']);
	});

	it('reads the link before scrubbing a live location', () => {
		const location = { hash: '#email=a%40b&token=9', pathname: '/', search: '' };
		expect(takeEmailLink(location, () => (location.hash = ''))).toEqual({ email: 'a@b', token: '9' });
	});

	it('asks before use, naming the server and the address, and what continuing replaces', () => {
		const link = { email: 'ada@example.com', token: '1' };
		const here = emailLinkPrompt(link, { url: 'wss://chat.example/', signedInAs: 'Bob (@bob)' });
		expect(here.title).toBe('Sign in to chat.example as ada@example.com?');
		expect(here.switchesServer).toBe(false);
		expect(here.lines.join(' ')).toMatch(/signed in here as Bob \(@bob\).*signs you out/);
		expect(here.lines.join(' ')).toMatch(/their account/);
		const elsewhere = emailLinkPrompt({ ...link, server: 'wss://other.example/' }, { url: 'wss://chat.example/', label: 'Chat' });
		expect(elsewhere.title).toBe('Sign in to other.example as ada@example.com?');
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
			setUrl(next: string) { calls.push(`setUrl ${next}`); current = next; },
			async signInWithEmail(email: string, token: string) {
				calls.push(`signIn ${email} ${token} on ${current}`);
				if (outcome === 'refused') throw new Error('Invalid or expired code');
			}
		};
	}

	it('uses a confirmed link on its own server, and remembers the switch only once signed in', async () => {
		const chat = fakeClient('wss://home.example/', 'ok');
		const events: string[] = [];
		await runEmailLink({ email: 'a@b', token: '9', server: 'wss://other.example/' }, chat, {
			beforeSwitch: () => events.push('leave'),
			onSignedIn: (server, switched) => events.push(`signed in ${server} ${switched}`),
			onFailed: () => events.push('failed')
		});
		expect(chat.calls).toEqual(['setUrl wss://other.example/', 'signIn a@b 9 on wss://other.example/']);
		expect(events).toEqual(['leave', 'signed in wss://other.example/ true']);
	});

	it('reports a refused link without remembering its server', async () => {
		const chat = fakeClient('wss://home.example/', 'refused');
		const events: string[] = [];
		await runEmailLink({ email: 'a@b', token: '9' }, chat, {
			onSignedIn: () => events.push('signed in'),
			onFailed: (error, server, switched) => events.push(`${error} ${server} ${switched}`)
		});
		expect(chat.calls).toEqual(['signIn a@b 9 on wss://home.example/']);
		expect(events).toEqual(['Invalid or expired code wss://home.example/ false']);
	});

	it('keeps a connect-screen code only for the server that sent it', () => {
		const sent = { email: 'a@b', url: 'wss://a.example/' };
		expect(codeStillFor(sent, 'wss://a.example/', 'wss://a.example/')).toBe(sent);
		expect(codeStillFor(sent, 'wss://b.example/', 'wss://a.example/')).toBeUndefined();
		expect(codeStillFor(sent, 'wss://a.example/', 'wss://b.example/')).toBeUndefined();
		expect(codeStillFor(undefined, 'wss://a.example/', 'wss://a.example/')).toBeUndefined();
	});
});
