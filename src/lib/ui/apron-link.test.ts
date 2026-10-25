import { describe, expect, it } from 'vitest';
import { readApronLink, writeApronLink } from './apron-link';

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
});
