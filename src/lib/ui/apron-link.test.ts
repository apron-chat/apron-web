// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderPlain } from '$lib/protocol/markdown';
import { placeLinksIn, readApronLink, writeApronLink } from './apron-link';

describe('Apron links (Appendix A.4)', () => {
	it('reads all three forms, a relative link, and a user or a token', () => {
		const place = { server: 'wss://chat.example/ws', room: 'general', message: '1724803200042' };
		expect(readApronLink('https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042')).toEqual(place);
		expect(readApronLink('apron:?server=wss://chat.example/ws&room=general&message=1724803200042')).toEqual(place);
		expect(readApronLink('web+apron:?server=wss%3A%2F%2Fchat.example%2Fws&room=general&message=1724803200042')).toEqual(place);
		expect(readApronLink('apron:?room=ops')).toEqual({ room: 'ops' });
		expect(readApronLink('https://link.apron.chat/#server=wss://chat.example/ws&room=general&user=ada')).toEqual({ server: 'wss://chat.example/ws', room: 'general', user: 'ada' });
		expect(readApronLink('https://link.apron.chat/#server=wss://chat.example/ws&token=inv_1')).toEqual({ server: 'wss://chat.example/ws', token: 'inv_1' });
		// The first server it can reach: `ws:` only on this device.
		expect(readApronLink('apron:?server=webtransport://chat.example/wt&server=wss://chat.example/ws&room=r')?.server).toBe('wss://chat.example/ws');
		expect(readApronLink('apron:?server=ws://localhost:8080/ws&room=agent')?.server).toBe('ws://localhost:8080/ws');
	});

	it('is no Apron link for other URLs, repeated keys, a message without a room, a token without a server, or a server it can’t reach', () => {
		for (const href of [
			'https://example.com/#server=wss://chat.example/ws', 'https://link.apron.chat/', 'https://link.apron.chat/other#room=r', 'mailto:ada@example.com',
			'apron:?server=wss://h/&room=a&room=b', 'apron:?server=wss://h/&message=1', 'apron:?server=wss://h/&room=r&message=abc', 'apron:?token=t',
			'apron:?server=ws://chat.example/ws&room=r', 'apron:?server=https://chat.example/&room=r', 'apron:?server=wss://ada:pw@chat.example/&room=r'
		]) expect(readApronLink(href), href).toBeUndefined();
	});

	it('writes the https form, readable, and reads back what it writes', () => {
		const written = writeApronLink({ server: 'wss://chat.example/ws', room: '#ops/alerts', message: '1724803200042' });
		expect(written).toBe('https://link.apron.chat/#server=wss://chat.example/ws&room=%23ops/alerts&message=1724803200042');
		expect(readApronLink(written)).toEqual({ server: 'wss://chat.example/ws', room: '#ops/alerts', message: '1724803200042' });
		expect(writeApronLink({ server: 'wss://ada:pw@chat.example/ws', room: 'general' })).toBe('https://link.apron.chat/#server=wss://chat.example/ws&room=general');
	});

	it('finds the distinct links to messages, rooms and threads a rendered body links, in order, and none it leaves unlinked, as in code', () => {
		const source = [
			'See https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042.',
			'[that](apron:?room=ops&message=7) and <web+apron:?room=ops&message=8>, again apron:?room=ops&message=7!',
			'a room apron:?room=ops, a user apron:?room=ops&user=ada, elsewhere https://example.com/#room=r&message=1',
			'`apron:?room=ops&message=9` and ``apron:?room=ops&message=10``',
			'',
			'    apron:?room=ops&message=11',
			'',
			'```\napron:?room=ops&message=12\n```',
			'',
			'<https://link.apron.chat/#room=général&message=13>'
		].join('\n');
		const found = (html: string, max = 10) => placeLinksIn(html, max).map((link) => [link.server, link.room, link.message]);
		const html = renderMarkdown(source);
		// Code, inline, double-backticked, indented or fenced, links nothing; a link percent-encoded reads as written.
		expect(found(html)).toEqual([
			['wss://chat.example/ws', 'general', '1724803200042'], [undefined, 'ops', '7'], [undefined, 'ops', '8'], [undefined, 'ops', undefined], [undefined, 'général', '13']
		]);
		expect(found(html, 2)).toHaveLength(2);
		// A plain body has no code: an indented link is a link.
		expect(found(renderPlain('    apron:?room=ops&message=11'))).toEqual([[undefined, 'ops', '11']]);
		expect(found(renderPlain('apron:?server=wss://h/&token=t&room=r'))).toEqual([]);
	});

});
