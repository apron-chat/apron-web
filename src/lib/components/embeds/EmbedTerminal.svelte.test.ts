// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLiveFetch } from '$lib/protocol/live-text';
import type { Embed as EmbedRecord } from '$lib/protocol/types';
import { render, unmount } from '$lib/test/dom';
import { FakeTerminal } from '$lib/test/fake-xterm';
import { directory } from '$lib/ui/directory.svelte';
import { blankSnapshot } from '$lib/ui/session.svelte';
import { loadXterm } from '$lib/ui/xterm';
import Embed from './Embed.svelte';

vi.mock('$lib/ui/xterm', async () => {
	const { fakeXterm } = await import('$lib/test/fake-xterm');
	return { loadXterm: vi.fn(async () => fakeXterm) };
});

const ESC_C = '\u001bc';
const text = (written: Array<string | Uint8Array>) => written.map((part) => (typeof part === 'string' ? part : new TextDecoder().decode(part)));

/** `GET url`: one response per request, each written by the test. */
function serve() {
	const responses: { push: (text: string) => void; end: () => void; fail: () => void }[] = [];
	const urls: string[] = [];
	setLiveFetch(async (url) => {
		urls.push(url);
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
		responses.push({ push: (chunk) => controller.enqueue(new TextEncoder().encode(chunk)), end: () => controller.close(), fail: () => controller.error(new TypeError('dropped')) });
		return new Response(body);
	});
	return { urls, responses };
}

function show(embed: EmbedRecord): HTMLElement {
	return render(Embed, { embed });
}

beforeEach(() => {
	directory.apply({ ...blankSnapshot(), authenticated: true }, 'https://chat.example', 'wss://chat.example/ws');
});

afterEach(() => {
	setLiveFetch();
	directory.forget();
	FakeTerminal.made = [];
	vi.mocked(loadXterm).mockClear();
});

describe('a terminal embed (§4.8.6)', () => {
	it('loads xterm only once a terminal is shown', async () => {
		show({ kind: 'upload', title: 'a.txt', url: 'https://chat.example/f/1' });
		show({ kind: 'append', url: 'https://chat.example/a/1' });
		expect(loadXterm).not.toHaveBeenCalled();
		show({ kind: 'terminal', title: 'make', output: 'ok\r\n' });
		expect(loadXterm).toHaveBeenCalledOnce();
	});

	it('shows a finished one’s output from a fresh terminal, titled and Finished, fetching nothing', async () => {
		const server = serve();
		const box = show({ kind: 'terminal', title: 'make test', output: '\u001b[32mok\u001b[0m\r\n', url: 'https://chat.example/t/1' });
		await vi.waitFor(() => expect(FakeTerminal.made).toHaveLength(1));
		expect(FakeTerminal.made[0].written).toEqual([ESC_C, '\u001b[32mok\u001b[0m\r\n']);
		expect(box.querySelector('.ap-embed-termtitle')?.textContent).toBe('make test');
		expect(box.querySelector('.ap-embed-detail')?.textContent).toBe('Finished');
		expect(box.querySelector('[data-testid="terminal-embed"]')).not.toBeNull();
		expect(server.urls).toEqual([]);
	});

	it('writes live output as it arrives, and a reconnect starts the screen afresh with the new response', async () => {
		const server = serve();
		const box = show({ kind: 'terminal', url: 'https://chat.example/t/2' });
		expect(box.querySelector('.ap-embed-livebadge')?.textContent).toBe('Live');
		await vi.waitFor(() => expect(server.responses).toHaveLength(1));
		server.responses[0].push('$ make\r\n');
		await vi.waitFor(() => expect(text(FakeTerminal.made[0].written)).toEqual([ESC_C, '$ make\r\n']));
		server.responses[0].fail();
		await vi.waitFor(() => expect(server.responses).toHaveLength(2), { timeout: 3000 });
		server.responses[1].push('$ make\r\nok\r\n');
		server.responses[1].end();
		await vi.waitFor(() => expect(text(FakeTerminal.made[0].written)).toEqual([ESC_C, '$ make\r\n', ESC_C, '$ make\r\nok\r\n']));
		flushSync();
		// It ended: the snapshot with its output is on its way.
		expect(box.querySelector('.ap-embed-livebadge')).toBeNull();
		expect(box.querySelector('.ap-embed-detail')?.textContent).toBe('Ended');
	});

	it('reads live output only from the chat server', async () => {
		const server = serve();
		const box = show({ kind: 'terminal', url: 'https://elsewhere.example/t/3' });
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(server.urls).toEqual([]);
		expect(box.querySelector('.ap-embed-detail')?.textContent).toBe('Unavailable');
		unmount();
	});
});
