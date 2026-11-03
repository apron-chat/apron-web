import { describe, expect, it } from 'vitest';
import { startServer } from './start-server';

const location = { protocol: 'https:', host: 'apron.example' } as Location;
const home = 'wss://apron.example/ws';

describe('startServer', () => {
	it('is the server last used here, without a link or with one to it', () => {
		expect(startServer('wss://chat.example/ws', {}, [], location)).toEqual({ server: 'wss://chat.example/ws' });
		expect(startServer('wss://chat.example/ws', { server: 'wss://chat.example/ws', room: 'general' }, [], location)).toEqual({ server: 'wss://chat.example/ws' });
	});

	it('switches to a link’s server used here before, or the page’s own (a link without a server)', () => {
		const recents = [{ url: 'wss://other.example/ws' }];
		expect(startServer('wss://chat.example/ws', { server: 'wss://other.example/ws' }, recents, location)).toEqual({ server: 'wss://other.example/ws' });
		expect(startServer('wss://chat.example/ws', { room: 'general' }, [], location)).toEqual({ server: home });
	});

	it('offers any other, connecting meanwhile as it would have', () => {
		expect(startServer('wss://chat.example/ws', { server: 'wss://new.example/ws' }, [], location)).toEqual({ server: 'wss://chat.example/ws', offered: 'wss://new.example/ws' });
	});
});
