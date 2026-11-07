import { describe, expect, it, vi } from 'vitest';
import { Greetings } from './greetings.svelte';
import type { ServerParams } from '$lib/protocol/types';

const PIPER: ServerParams = { apron: 10, auth: ['guest'], title: 'Pied Piper' };

/** A greeter whose lookups the test answers. */
function greeter() {
	const calls: Array<{ url: string; signal?: AbortSignal; resolve: (server: ServerParams) => void; reject: (cause: Error) => void }> = [];
	const greet = vi.fn((url: string, signal?: AbortSignal) => new Promise<ServerParams>((resolve, reject) => {
		calls.push({ url, signal, resolve, reject });
	}));
	return { greet, calls };
}

describe('Greetings', () => {
	it('contacts a server only when asked, and keeps what it said for the page', async () => {
		const greetings = new Greetings();
		const fake = greeter();
		expect(greetings.get('wss://a.test/')).toBeUndefined();
		const looked = greetings.look(fake, 'wss://a.test/');
		expect(greetings.get('wss://a.test/')).toEqual({ status: 'contacting' });
		fake.calls[0].resolve(PIPER);
		await expect(looked).resolves.toEqual({ status: 'known', server: PIPER });
		expect(greetings.server('wss://a.test/')).toEqual(PIPER);
		// Known: asked again (Change and back, a sign-in that expired), it doesn't contact the server again.
		await expect(greetings.look(fake, 'wss://a.test/')).resolves.toEqual({ status: 'known', server: PIPER });
		expect(fake.greet).toHaveBeenCalledTimes(1);
	});

	it('shares a lookup under way, and says why one failed, trying again when asked', async () => {
		const greetings = new Greetings();
		const fake = greeter();
		const first = greetings.look(fake, 'wss://a.test/');
		const second = greetings.look(fake, 'wss://a.test/');
		expect(fake.greet).toHaveBeenCalledTimes(1);
		fake.calls[0].reject(new Error('Can’t reach the server. Check the address and try again.'));
		const failed = { status: 'failed', error: 'Can’t reach the server. Check the address and try again.' };
		await expect(first).resolves.toEqual(failed);
		await expect(second).resolves.toEqual(failed);
		expect(greetings.get('wss://a.test/')).toEqual(failed);
		void greetings.look(fake, 'wss://a.test/');
		expect(fake.greet).toHaveBeenCalledTimes(2);
	});

	it('cancels lookups under way, leaving nothing behind', async () => {
		const greetings = new Greetings();
		const fake = greeter();
		const looked = greetings.look(fake, 'wss://a.test/');
		greetings.cancel();
		expect(fake.calls[0].signal?.aborted).toBe(true);
		expect(greetings.get('wss://a.test/')).toBeUndefined();
		fake.calls[0].reject(new Error('Cancelled'));
		await looked;
		expect(greetings.get('wss://a.test/')).toBeUndefined();
	});
});
