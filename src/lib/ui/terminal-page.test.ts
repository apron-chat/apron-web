import { describe, expect, it } from 'vitest';
import { terminalPageUrl } from './terminal-page';

describe('terminalPageUrl', () => {
	it('puts the stream, and its title, after the # of terminal.apron.chat', () => {
		expect(terminalPageUrl('https://chat.example/live/1')).toBe('https://terminal.apron.chat/#stream=https://chat.example/live/1');
		expect(terminalPageUrl('https://chat.example/live/1', 'make test')).toBe('https://terminal.apron.chat/#stream=https://chat.example/live/1&title=make%20test');
	});

	it('encodes what would end a key, and drops the stream’s own fragment', () => {
		const link = terminalPageUrl('https://chat.example/live?id=1&key=a+b%2F#x', 'a & b #1');
		expect(link).toBe('https://terminal.apron.chat/#stream=https://chat.example/live%3Fid%3D1%26key%3Da%2Bb%252F&title=a%20%26%20b%20%231');
		const keys = new URLSearchParams(new URL(link!).hash.slice(1));
		expect([keys.get('stream'), keys.get('title')]).toEqual(['https://chat.example/live?id=1&key=a+b%2F', 'a & b #1']);
	});

	it('has none for a stream the page would not read', () => {
		for (const stream of [undefined, '', 'not a url', 'http://chat.example/live/1', 'http://localhost:8080/live/1', 'https://ada:pw@chat.example/live/1', 'data:text/plain,hi']) {
			expect(terminalPageUrl(stream)).toBeUndefined();
		}
	});
});
