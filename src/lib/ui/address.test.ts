import { describe, expect, it } from 'vitest';
import { destinationUrl, readDestination } from './address';

const at = (url: string) => {
	const { search, hash } = new URL(url);
	return readDestination({ search, hash });
};

describe('destination URLs', () => {
	it('read the server, room, thread and message', () => {
		expect(at('https://app.example/')).toEqual({});
		expect(at('https://app.example/?room=general')).toEqual({ room: 'general' });
		expect(at('https://app.example/?server=wss%3A%2F%2Fchat.example.com%2Fws&room=general&thread=thread-123#message=message-456')).toEqual({
			server: 'wss://chat.example.com/ws', room: 'general', thread: 'thread-123', message: 'message-456'
		});
	});

	it('need a room for a thread or a message, and a WebSocket server without credentials', () => {
		expect(at('https://app.example/?thread=t1#message=m1')).toEqual({});
		expect(at('https://app.example/?server=https%3A%2F%2Fchat.example&room=general')).toEqual({ room: 'general' });
		expect(at('https://app.example/?server=wss%3A%2F%2Fada%3Asecret%40chat.example%2Fws&room=general')).toEqual({ room: 'general' });
		expect(at('https://app.example/?server=not%20a%20url')).toEqual({});
		// An emailed sign-in link's fragment is not a message.
		expect(at('https://app.example/?room=general#token=abc')).toEqual({ room: 'general' });
	});

	it('write the destination, leaving out the default server and keeping other parameters', () => {
		const home = 'wss://app.example/ws';
		expect(destinationUrl('https://app.example/?x=1#token=abc', { server: home, room: 'general' }, home)).toBe('https://app.example/?x=1&room=general');
		expect(destinationUrl('https://app.example/?room=old&thread=t0', { server: 'wss://chat.example.com/ws', room: 'general', thread: 'thread-123', message: 'message-456' }, home))
			.toBe('https://app.example/?server=wss%3A%2F%2Fchat.example.com%2Fws&room=general&thread=thread-123#message=message-456');
		expect(destinationUrl('https://app.example/?room=general&thread=t1#message=m1', { server: home }, home)).toBe('https://app.example/');
	});

	it('never write credentials, and read back what they write', () => {
		const written = destinationUrl('https://app.example/', { server: 'wss://ada:secret@chat.example.com/ws', room: 'r 1', thread: 't/2', message: 'm&3' }, 'wss://app.example/ws');
		expect(written).not.toContain('secret');
		expect(at(written)).toEqual({ server: 'wss://chat.example.com/ws', room: 'r 1', thread: 't/2', message: 'm&3' });
	});
});
