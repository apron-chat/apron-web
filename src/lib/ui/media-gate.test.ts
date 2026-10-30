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
