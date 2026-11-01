// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLiveFetch } from '$lib/protocol/live-text';
import { LiveAppend } from './live-append.svelte';

const bytes = (text: string) => new TextEncoder().encode(text);

/** `GET url`'s responses, each written by the test as bytes: `push` to the latest, `drop` it as a network would. */
function serve() {
	const responses: ReadableStreamDefaultController<Uint8Array>[] = [];
	setLiveFetch(async () => new Response(new ReadableStream<Uint8Array>({ start: (c) => void responses.push(c) })));
	const latest = () => responses.at(-1)!;
	return {
		responses,
		push: (...chunks: (string | Uint8Array)[]) => chunks.forEach((chunk) => latest().enqueue(typeof chunk === 'string' ? bytes(chunk) : chunk)),
		end: () => latest().close(),
		drop: () => latest().error(new TypeError('The connection dropped'))
	};
}

/** Reads a new LiveAppend at `url` as a row showing it does, until `stop`. */
function show(url: string): { live: LiveAppend; stop: () => void } {
	const live = new LiveAppend(url);
	const stop = $effect.root(() => {
		$effect(() => {
			void live.text;
		});
	});
	flushSync();
	return { live, stop };
}

afterEach(() => {
	setLiveFetch();
	vi.useRealTimers();
});

describe('LiveAppend: an append embed’s text with its edits (§4.8.5)', () => {
	it('applies backspaces as each chunk arrives, by code point: "é" and an astral emoji, bytes and edits cut across chunks', async () => {
		const server = serve();
		const { live, stop } = show('https://chat.example/a/edits');
		try {
			await vi.waitFor(() => expect(server.responses).toHaveLength(1));
			server.push('Roll back the indx', '\b', 'ex');
			await vi.waitFor(() => expect(live.text).toBe('Roll back the index'));
			// "é" is C3 A9 and 🚀 F0 9F 9A 80, each cut between chunks; a backspace removes each whole.
			const rocket = bytes('🚀');
			server.push(' caf', new Uint8Array([0xc3]), new Uint8Array([0xa9]), '\bé ', rocket.slice(0, 2), rocket.slice(2), '\b');
			await vi.waitFor(() => expect(live.text).toBe('Roll back the index café '));
			server.push('\b\b\b\b\b\b. Done');
			server.end();
			await vi.waitFor(() => expect(live.live).toBe(false));
			expect(live.text).toBe('Roll back the index. Done');
		} finally {
			stop();
		}
	});

	it('clears its text at a form feed, and keeps what follows', async () => {
		const server = serve();
		const { live, stop } = show('https://chat.example/a/feed');
		try {
			await vi.waitFor(() => expect(server.responses).toHaveLength(1));
			server.push('Looking at the logs…');
			await vi.waitFor(() => expect(live.text).toBe('Looking at the logs…'));
			server.push('\f');
			await vi.waitFor(() => expect(live.text).toBe(''));
			server.push('The plan');
			await vi.waitFor(() => expect(live.text).toBe('The plan'));
		} finally {
			stop();
		}
	});

	it('takes text the server already edited as it is, and a reconnect replaces what it showed with the new response', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const server = serve();
		const { live, stop } = show('https://chat.example/a/reconnect');
		try {
			await vi.waitFor(() => expect(server.responses).toHaveLength(1));
			server.push('Draft one\fThe pla', 'm\bn');
			await vi.waitFor(() => expect(live.text).toBe('The plan'));
			server.drop();
			// What it showed stays until the next response, which starts over from the text as the server kept it.
			await vi.advanceTimersByTimeAsync(500);
			expect(live.text).toBe('The plan');
			await vi.waitFor(() => expect(server.responses).toHaveLength(2));
			server.push('The plan', ': roll back');
			await vi.waitFor(() => expect(live.text).toBe('The plan: roll back'));
		} finally {
			stop();
		}
	});
});
