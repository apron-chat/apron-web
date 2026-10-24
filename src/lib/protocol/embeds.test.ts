import { describe, expect, it } from 'vitest';
import { embedMedia, parseOrigins, safeAvatar, safeLink, sameOriginMedia, serverOrigin } from './embeds';

describe('embed URL policy', () => {
	it('loads media only from the chat server and links only over http(s)', () => {
		const origin = serverOrigin('wss://chat.example/ws');
		expect(origin).toBe('https://chat.example');
		expect(serverOrigin('ws://localhost:5173/ws')).toBe('http://localhost:5173');
		expect(sameOriginMedia('https://chat.example/files/embed_1/s', origin)).toBe('https://chat.example/files/embed_1/s');
		expect(sameOriginMedia('https://elsewhere.example/x.png', origin)).toBeUndefined();
		expect(sameOriginMedia('data:image/png;base64,iVBORw0KGgo=', origin)).toBe('data:image/png;base64,iVBORw0KGgo=');
		expect(sameOriginMedia('data:text/html;base64,PGI+', origin)).toBeUndefined();
		expect(safeLink('javascript:alert(1)')).toBeUndefined();
		expect(safeLink('https://example.com/a')).toBe('https://example.com/a');
		expect(safeAvatar('https://gravatar.example/a.png', origin)).toBe('https://gravatar.example/a.png');
		expect(safeAvatar('http://elsewhere.example/a.png', origin)).toBeUndefined();
	});

	it('loads embed media from the origins the server names as well as from the server', () => {
		const trusted = parseOrigins(['https://media.apron.chat', 'http://localhost:9000', 'http://[::1]:9000', 'http://media.example', 'https://cdn.example/path', 'https://cdn.example/', 'https://CDN.example', 7, 'nonsense']);
		expect(trusted).toEqual(['https://media.apron.chat', 'http://localhost:9000', 'http://[::1]:9000']);
		expect(parseOrigins('https://media.apron.chat')).toEqual([]);
		expect(embedMedia('https://media.apron.chat/f/abc', 'https://server.apron.chat', trusted)).toBe('https://media.apron.chat/f/abc');
		expect(embedMedia('https://server.apron.chat/files/x', 'https://server.apron.chat', trusted)).toBe('https://server.apron.chat/files/x');
		expect(embedMedia('https://tracker.example/pixel.gif', 'https://server.apron.chat', trusted)).toBeUndefined();
		// Streams stay on the chat server.
		expect(sameOriginMedia('https://media.apron.chat/f/abc', 'https://server.apron.chat')).toBeUndefined();
	});
});
