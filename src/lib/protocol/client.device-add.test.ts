import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect } from '$lib/test/client';

/** A token for another device (`ext:device_add`, EXT.md §9): asked for only where offered, by an account. */
beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const account = { auth: ['webauthn', 'token', 'guest'], token: 'session-1', you: { user_id: 'ada', name: 'Ada' } };

describe('addDevice', () => {
	it('sends ext:device_add with no params and resolves with the token and its origin', async () => {
		const { client, socket } = await connect(['ext:device_add'], account);
		const added = client.addDevice();
		await vi.advanceTimersByTimeAsync(0);
		expect(socket.request('ext:device_add').params).toEqual({});
		await socket.reply('ext:device_add', { token: 'device-1', origin: 'https://web.example' });
		await expect(added).resolves.toEqual({ token: 'device-1', origin: 'https://web.example' });
	});

	it('rejects with the server\'s words, and without a token in the result', async () => {
		const { client, socket } = await connect(['ext:device_add'], account);
		const refused = client.addDevice();
		await vi.advanceTimersByTimeAsync(0);
		socket.receive({ id: socket.request('ext:device_add').id, error: { code: -32001, message: 'Sign in with a passkey or email before adding a device' } });
		await expect(refused).rejects.toThrow('Sign in with a passkey or email before adding a device');
		const empty = client.addDevice();
		await vi.advanceTimersByTimeAsync(0);
		await socket.reply('ext:device_add', { origin: '' });
		await expect(empty).rejects.toThrow('The server sent no token');
	});

	it('asks nothing of a server without the capability, or as a guest', async () => {
		const { client, socket } = await connect([], account);
		await expect(client.addDevice()).rejects.toThrow('This server doesn’t add devices');
		expect(socket.sent.some((frame) => frame.method === 'ext:device_add')).toBe(false);
		client.stop();

		const guest = await connect(['ext:device_add']);
		await expect(guest.client.addDevice()).rejects.toThrow('Sign in to add a device');
		expect(guest.socket.sent.some((frame) => frame.method === 'ext:device_add')).toBe(false);
	});
});
