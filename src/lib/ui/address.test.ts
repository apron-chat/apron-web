import { describe, expect, it } from 'vitest';
import { destinationUrl, readDestination } from './address';

const at = (url: string) => readDestination({ hash: new URL(url).hash });

describe('destination URLs', () => {
	it('read the server, room, thread, message and user from the fragment, needing a room for the rest, and a WebSocket server without credentials', () => {
		expect(at('https://app.example/')).toEqual({});
		expect(at('https://app.example/#room=general')).toEqual({ room: 'general' });
		expect(at('https://app.example/#server=wss://chat.example.com/ws&room=general&thread=thread-123&message=message-456')).toEqual({
			server: 'wss://chat.example.com/ws', room: 'general', thread: 'thread-123', message: 'message-456'
		});
		expect(at('https://app.example/#room=general&user=ada')).toEqual({ room: 'general', user: 'ada' });
		// The query is the host's, not a place.
		expect(at('https://app.example/?room=general')).toEqual({});
		// Only with a room for a thread, a message or a user, and a WebSocket server without credentials.
		expect(at('https://app.example/#thread=t1&message=m1&user=ada')).toEqual({});
		expect(at('https://app.example/#server=https%3A%2F%2Fchat.example&room=general')).toEqual({ room: 'general' });
		expect(at('https://app.example/#server=wss%3A%2F%2Fada%3Asecret%40chat.example%2Fws&room=general')).toEqual({ room: 'general' });
		expect(at('https://app.example/#server=not%20a%20url')).toEqual({});
		// A sign-in link's token is not a place.
		expect(at('https://app.example/#room=general&token=abc')).toEqual({ room: 'general' });
	});

	it('write the destination, leaving out the default server and credentials and keeping the query and other keys, and read back what they write', () => {
		const home = 'wss://app.example/ws';
		expect(destinationUrl('https://app.example/?x=1#push=1', { server: home, room: 'general' }, home)).toBe('https://app.example/?x=1#room=general&push=1');
		expect(destinationUrl('https://app.example/#room=old&thread=t0', { server: 'wss://chat.example.com/ws', room: 'general', thread: 'thread-123', message: 'message-456' }, home))
			.toBe('https://app.example/#server=wss://chat.example.com/ws&room=general&thread=thread-123&message=message-456');
		expect(destinationUrl('https://app.example/#room=general&thread=t1&message=m1&user=ada', { server: home }, home)).toBe('https://app.example/');
		// Never credentials; and they read back what they write.
		const written = destinationUrl('https://app.example/', { server: 'wss://ada:secret@chat.example.com/ws', room: 'r 1', thread: 't/2', message: 'm&3', user: 'a#4' }, home);
		expect(written).not.toContain('secret');
		expect(at(written)).toEqual({ server: 'wss://chat.example.com/ws', room: 'r 1', thread: 't/2', message: 'm&3', user: 'a#4' });
	});
});
