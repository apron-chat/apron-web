import { describe, expect, it } from 'vitest';
import { ANY_ORIGIN } from '$lib/protocol/embeds';
import { localMedia, mediaGate, NO_MEDIA } from './media-gate';

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

describe('mediaGate', () => {
	it('lets through the server’s own files, the origins trusted, and small inline images, and nothing else', () => {
		const gate = mediaGate('https://chat.example', ['https://media.example']);
		expect(gate.src('https://chat.example/a.png')).toBe('https://chat.example/a.png');
		expect(gate.src('https://media.example/b.png')).toBe('https://media.example/b.png');
		expect(gate.src(PIXEL)).toBe(PIXEL);
		expect(gate.src('https://tracker.example/t.gif')).toBeUndefined();
		expect(gate.src('javascript:alert(1)')).toBeUndefined();
		expect(gate.src(7)).toBeUndefined();
		expect(NO_MEDIA.src('https://chat.example/a.png')).toBeUndefined();
		expect(NO_MEDIA.src(PIXEL)).toBe(PIXEL);
	});

	it('lets through any http(s) file with ANY_ORIGIN, and with httpsElsewhere, any https one and the server’s own', () => {
		expect(mediaGate('https://chat.example', [ANY_ORIGIN]).src('http://tracker.example/t.gif')).toBe('http://tracker.example/t.gif');
		const avatars = mediaGate('http://localhost:8080', [ANY_ORIGIN], { httpsElsewhere: true });
		expect(avatars.src('https://gravatar.example/a.png')).toBe('https://gravatar.example/a.png');
		expect(avatars.src('http://gravatar.example/a.png')).toBeUndefined();
		expect(avatars.src('http://localhost:8080/a.png')).toBe('http://localhost:8080/a.png');
	});

	it('asks for what may not load, where asked to, and lets through what was clicked to load', () => {
		const strict = mediaGate('https://chat.example', ['https://media.example']);
		expect(strict.ask('https://tracker.example/t.gif')).toBeUndefined();
		const asking = mediaGate('https://chat.example', ['https://media.example'], { asks: true, once: ['https://tracker.example/t.gif'] });
		expect(asking.src('https://tracker.example/t.gif')).toBe('https://tracker.example/t.gif');
		expect(asking.ask('https://tracker.example/t.gif')).toBeUndefined();
		expect(asking.ask('https://tracker.example/u.gif')).toEqual({ url: 'https://tracker.example/u.gif', host: 'tracker.example', origin: 'https://tracker.example' });
		// Plain http can load on a click, but its site can't be trusted from now on.
		expect(asking.ask('http://plain.example/u.gif')).toEqual({ url: 'http://plain.example/u.gif', host: 'plain.example' });
		expect(asking.ask('https://media.example/a.png')).toBeUndefined();
		expect(asking.ask('javascript:alert(1)')).toBeUndefined();
		expect(asking.ask(PIXEL)).toBeUndefined();
		expect(asking.key).not.toBe(mediaGate('https://chat.example', ['https://media.example'], { asks: true }).key);
	});

	it('never lets through nor asks for what is blocked, whatever trusts it or was clicked to load, by host', () => {
		const blocked = ['https://tracker.example', 'https://media.example'];
		const gate = mediaGate('https://chat.example', ['https://media.example', ANY_ORIGIN], { asks: true, once: ['https://tracker.example/t.gif'], blocked });
		for (const url of ['https://tracker.example/t.gif', 'http://tracker.example/t.gif', 'https://media.example/b.png', 'https://tracker.example./t.gif', 'https://tracker.example:8443/t.gif', 'http://tracker.example:443/t.gif', 'https://TRACKER.example/t.gif']) {
			expect(gate.src(url), url).toBeUndefined();
			expect(gate.ask(url), url).toBeUndefined();
		}
		expect(gate.src('https://elsewhere.example/a.png')).toBe('https://elsewhere.example/a.png');
		// A block is of that host and every one under it, not those it is under or that merely end alike.
		for (const url of ['https://a.tracker.example/t.gif', 'https://x.y.tracker.example./t.gif']) {
			expect(gate.src(url), url).toBeUndefined();
			expect(gate.ask(url), url).toBeUndefined();
		}
		expect(gate.src('https://eviltracker.example/t.gif')).toBe('https://eviltracker.example/t.gif');
		expect(gate.src('https://example/t.gif')).toBe('https://example/t.gif');
		expect(gate.src('https://chat.example/a.png')).toBe('https://chat.example/a.png');
		expect(gate.src(PIXEL)).toBe(PIXEL);
		expect(gate.key).not.toBe(mediaGate('https://chat.example', ['https://media.example', ANY_ORIGIN], { asks: true, once: ['https://tracker.example/t.gif'] }).key);
	});

	it('keys each gate by what it lets through', () => {
		expect(mediaGate('https://chat.example', []).key).not.toBe(mediaGate('https://chat.example', ['https://media.example']).key);
		expect(mediaGate('https://chat.example', [ANY_ORIGIN]).key).not.toBe(mediaGate('https://chat.example', [ANY_ORIGIN], { httpsElsewhere: true }).key);
		expect(mediaGate('https://chat.example', []).key).toBe(mediaGate('https://chat.example', []).key);
	});
});

describe('localMedia', () => {
	it('takes only an object URL this page made', () => {
		const own = `blob:${globalThis.location?.origin}/0b5e`;
		if (globalThis.location) expect(localMedia(own)).toBe(own);
		expect(localMedia('blob:https://elsewhere.example/0b5e')).toBeUndefined();
		expect(localMedia('https://tracker.example/t.gif')).toBeUndefined();
		expect(localMedia(undefined)).toBeUndefined();
	});
});
