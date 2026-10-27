// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderPlain } from '$lib/protocol/markdown';
import { placeLinksIn, readApronLink, readPlaceLink, writeApronLink } from './apron-link';

describe('Apron links (Appendix A.4)', () => {
	it('reads both forms, a relative link, and a user or a token', () => {
		const place = { server: 'wss://chat.example/ws', room: 'general', message: '1724803200042' };
		expect(readApronLink('https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042')).toEqual(place);
		expect(readApronLink('apron:?server=wss://chat.example/ws&room=general&message=1724803200042')).toEqual(place);
		expect(readApronLink('apron:?server=wss%3A%2F%2Fchat.example%2Fws&room=general&message=1724803200042')).toEqual(place);
		expect(readApronLink('APRON:?server=wss://chat.example/ws&room=general&message=1724803200042')).toEqual(place);
		expect(readApronLink('apron:?room=ops')).toEqual({ room: 'ops' });
		expect(readApronLink('https://link.apron.chat/#server=wss://chat.example/ws&room=general&user=ada')).toEqual({ server: 'wss://chat.example/ws', room: 'general', user: 'ada' });
		expect(readApronLink('https://link.apron.chat/#server=wss://chat.example/ws&token=inv_1')).toEqual({ server: 'wss://chat.example/ws', token: 'inv_1' });
		// `ws:` only on this device.
		expect(readApronLink('apron:?server=ws://localhost:8080/ws&room=agent')?.server).toBe('ws://localhost:8080/ws');
		// Keys it doesn't know are ignored.
		expect(readApronLink('https://link.apron.chat/#server=wss://chat.example/ws&room=general&utm_source=x')).toEqual({ server: 'wss://chat.example/ws', room: 'general' });
	});

	it('reads the first value of a repeated key: a key appended to a link cannot replace one before it (§5.4)', () => {
		expect(readApronLink('apron:?server=wss://chat.example/ws&room=general&room=ops')).toEqual({ server: 'wss://chat.example/ws', room: 'general' });
		expect(readApronLink('https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=12&message=13&user=ada&user=eve')).toEqual({
			server: 'wss://chat.example/ws', room: 'general', message: '12', user: 'ada'
		});
		expect(readApronLink('https://link.apron.chat/#server=wss://chat.example/ws&token=inv_1&state=s1&token=inv_2&state=s2')).toEqual({ server: 'wss://chat.example/ws', token: 'inv_1', state: 's1' });
		expect(readApronLink('apron:?server=wss://chat.example/ws&server=wss://evil.example/ws&room=general')).toEqual({ server: 'wss://chat.example/ws', room: 'general' });
		// An empty first value is still the first: the key reads as absent, not as the next one.
		expect(readApronLink('apron:?server=wss://chat.example/ws&room=&room=ops')).toEqual({ server: 'wss://chat.example/ws' });
		// A repeat that makes no sense alone doesn't matter either: the first message is the one, with a room.
		expect(readApronLink('apron:?room=r&message=7&message=abc')).toEqual({ room: 'r', message: '7' });
	});

	it('refuses a link whose first server it can’t reach, rather than open a later one appended to it', () => {
		// On this device a `ws:` to another host isn't usable: the evil.example appended after it must not open instead.
		for (const href of [
			'https://link.apron.chat/#server=ws://chat.example/ws&room=general&server=wss://evil.example/ws',
			'apron:?server=webtransport://chat.example/wt&server=wss://chat.example/ws&room=r',
			'apron:?server=&server=wss://evil.example/ws&room=r',
			'apron:?server=wss://ada:pw@chat.example/ws&server=wss://evil.example/ws&room=r'
		]) expect(readApronLink(href), href).toBeUndefined();
	});

	it('reads no other form: not web+apron:', () => {
		for (const href of ['web+apron:?server=wss%3A%2F%2Fchat.example%2Fws&room=general&message=1724803200042', 'web+apron:?room=ops', 'WEB+APRON:?room=ops']) {
			expect(readApronLink(href), href).toBeUndefined();
			expect(readPlaceLink(href), href).toBeUndefined();
		}
	});

	it('is no Apron link for other URLs, a message without a room, a token without a server, or a server it can’t reach', () => {
		for (const href of [
			'https://example.com/#server=wss://chat.example/ws', 'https://link.apron.chat/', 'https://link.apron.chat/other#room=r', 'mailto:ada@example.com',
			'apron:?server=wss://h/&message=1', 'apron:?server=wss://h/&room=r&message=abc', 'apron:?token=t',
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
			'[that](apron:?room=ops&message=7) and <apron:?room=ops&message=8>, again apron:?room=ops&message=7!',
			'not web+apron:?room=ops&message=14, nor <web+apron:?room=ops&message=15> or [this](web+apron:?room=ops&message=16)',
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


	it('reads a link to a place strictly: the shapes Appendix A.4 lists, every key known and once, every value of its type', () => {
		expect(readPlaceLink('https://link.apron.chat/#server=wss://chat.example/ws&room=general&message=1724803200042')).toEqual({ server: 'wss://chat.example/ws', room: 'general', message: '1724803200042' });
		expect(readPlaceLink('apron:?room=ops')).toEqual({ room: 'ops' });
		expect(readPlaceLink('apron:?server=wss%3A%2F%2Fchat.example%2Fws&room=%23ops/alerts&user=ada')).toEqual({ server: 'wss://chat.example/ws', room: '#ops/alerts', user: 'ada' });
		expect(readPlaceLink('https://link.apron.chat/#room=g%C3%A9n%C3%A9ral')).toEqual({ room: 'général' });
		expect(readPlaceLink('apron:?server=ws://localhost:8080/ws&room=agent')?.server).toBe('ws://localhost:8080/ws');
		// What it writes, it reads.
		expect(readPlaceLink(writeApronLink({ server: 'wss://chat.example/ws', room: 'a&b=c', message: '7' }))).toEqual({ server: 'wss://chat.example/ws', room: 'a&b=c', message: '7' });
	});

	it('reads no place from a link with a key it doesn’t know, a token, an empty or malformed part, or a value not of its type', () => {
		const rejected = [
			// Keys it doesn't know, and a token or a sign-in's state: never a place.
			'apron:?room=ops&foo=1', 'https://link.apron.chat/#server=wss://h/&room=ops&utm_source=x', 'apron:?server=wss://h/&room=ops&token=t', 'apron:?room=ops&state=s',
			// Empty or malformed parts, a key twice, anything around the keys.
			'apron:?room=', 'apron:?room=ops&message=', 'apron:?room=ops&', 'apron:?&room=ops', 'apron:?room', 'apron:?room=ops&&message=1', 'apron:?=ops',
			'apron:?room=%E0%A4%A', 'apron:?room=ops&room=ops', 'apron:?room=ops#x', 'https://link.apron.chat/?x=1#room=ops', 'https://link.apron.chat/other#room=ops',
			// IDs (§2.4): no whitespace, control or bidi characters; a message_id is a log_id.
			'apron:?room=a%20b', 'apron:?room=a+b', 'apron:?room=a%0Ab', 'apron:?room=%E2%80%AEevil', 'apron:?room=ops&user=%09ada',
			'apron:?room=ops&message=01', 'apron:?room=ops&message=1e3', 'apron:?room=ops&message=-1',
			// Shapes Appendix A.4 doesn't list: no room, or a message and a user.
			'apron:?server=wss://h/', 'apron:?message=1', 'apron:?room=ops&message=1&user=ada',
			// One server, and one it can reach.
			'apron:?server=webtransport://h/wt&server=wss://h/&room=r', 'apron:?server=ws://chat.example/ws&room=r', 'apron:?server=https://h/&room=r', 'apron:?server=wss://ada:pw@h/&room=r', 'apron:?server=nope&room=r'
		];
		for (const href of rejected) expect(readPlaceLink(href), href).toBeUndefined();
		// The lenient reader, which opens links, still takes some of them: drawing one as a place is what needs all of it right.
		expect(readApronLink('apron:?room=ops&foo=1')).toEqual({ room: 'ops' });
		expect(readApronLink('apron:?room=ops&room=other')).toEqual({ room: 'ops' });
	});
});
