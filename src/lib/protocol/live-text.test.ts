import { afterEach, describe, expect, it, vi } from 'vitest';
import { canWriteLiveText, editLiveText, followLiveText, liveTextDecoder, readLiveText, setLiveFetch, writeLiveText, type LiveTextSink } from './live-text';

const bytes = (text: string) => new TextEncoder().encode(text);

/** A response whose body is written by the test: `push` some bytes, `end` it, or `fail` it as a dropped connection would. */
function streamed() {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
	return {
		response: new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
		push: (text: string) => controller.enqueue(bytes(text)),
		end: () => controller.close(),
		fail: () => controller.error(new TypeError('network error'))
	};
}

/** What a sink was told, in order: `start`, the text of each chunk, `end`. */
function recorder(): LiveTextSink & { calls: string[] } {
	const calls: string[] = [];
	const decoder = new TextDecoder();
	return { calls, start: () => calls.push('start'), chunk: (chunk) => calls.push(decoder.decode(chunk)), end: () => calls.push('end') };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => setLiveFetch());

describe('live text (§4.8.3)', () => {
	it('reads one response: start, each chunk as it arrives, then end, asking for it uncached and without credentials', async () => {
		const live = streamed();
		const fetcher = vi.fn(async () => live.response);
		setLiveFetch(fetcher);
		const sink = recorder();
		const done = readLiveText('https://chat.example/t/1', sink);
		await settle();
		live.push('$ make\n');
		await settle();
		expect(sink.calls).toEqual(['start', '$ make\n']);
		live.push('ok\n');
		live.end();
		await done;
		expect(sink.calls).toEqual(['start', '$ make\n', 'ok\n', 'end']);
		expect(fetcher).toHaveBeenCalledWith('https://chat.example/t/1', expect.objectContaining({ cache: 'no-store', credentials: 'omit' }));
	});

	it('fails on a status other than OK, before telling the sink anything', async () => {
		setLiveFetch(async () => new Response('gone', { status: 404 }));
		const sink = recorder();
		await expect(readLiveText('https://chat.example/t/1', sink)).rejects.toThrow('404');
		expect(sink.calls).toEqual([]);
	});

	it('tries again after a drop or a failure, waiting longer each time, and a new response starts over', async () => {
		const first = streamed();
		const second = streamed();
		const responses = [async () => first.response, async () => new Response(null, { status: 503 }), async () => second.response];
		const fetcher = vi.fn(() => responses.shift()!());
		setLiveFetch(fetcher);
		const sink = recorder();
		const done = followLiveText('https://chat.example/a/1', sink, new AbortController().signal, [1, 5]);
		await settle();
		first.push('Here is ');
		await settle();
		first.fail();
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
		await settle();
		second.push('Here is the plan');
		second.end();
		await done;
		// What showed stays through the drop; the reconnect's `start` replaces it with the new response from the top.
		expect(sink.calls).toEqual(['start', 'Here is ', 'start', 'Here is the plan', 'end']);
	});

	it.each([403, 404, 410])('stops at a definitive %i, as at the end of the text, without trying again', async (status) => {
		const first = streamed();
		const responses = [async () => first.response, async () => new Response('no', { status })];
		const fetcher = vi.fn(() => responses.shift()!());
		setLiveFetch(fetcher);
		const sink = recorder();
		const done = followLiveText('https://chat.example/t/1', sink, new AbortController().signal, [1]);
		await settle();
		first.push('so far');
		await settle();
		first.fail();
		await done;
		// What showed stays, and `end` tells the reader it is no longer live, while the snapshot that ends the text is on its way.
		expect(sink.calls).toEqual(['start', 'so far', 'end']);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('ends at once when the first GET is refused, telling the sink nothing else', async () => {
		const fetcher = vi.fn(async () => new Response('Too many readers', { status: 403 }));
		setLiveFetch(fetcher);
		const sink = recorder();
		await followLiveText('https://chat.example/t/1', sink, new AbortController().signal, [1]);
		expect(sink.calls).toEqual(['end']);
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it.each([408, 429, 500, 503])('tries again after a %i, as after a network error', async (status) => {
		const live = streamed();
		const responses = [async () => new Response(null, { status }), async () => Promise.reject(new TypeError('network error')), async () => live.response];
		const fetcher = vi.fn(() => responses.shift()!());
		setLiveFetch(fetcher);
		const sink = recorder();
		const done = followLiveText('https://chat.example/t/1', sink, new AbortController().signal, [1]);
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
		await settle();
		live.push('ok');
		live.end();
		await done;
		expect(sink.calls).toEqual(['start', 'ok', 'end']);
	});

	it('stops when aborted, waiting or reading, without ending', async () => {
		const live = streamed();
		setLiveFetch(async (_url, init) => {
			init.signal?.addEventListener('abort', () => live.fail());
			return live.response;
		});
		const controller = new AbortController();
		const sink = recorder();
		const done = followLiveText('https://chat.example/t/1', sink, controller.signal, [1]);
		await settle();
		live.push('partial');
		await settle();
		controller.abort();
		await done;
		expect(sink.calls).toEqual(['start', 'partial']);
	});

	it('routes through the fetcher it is given, and back to the network without one', async () => {
		const network = vi.fn(async () => new Response('net'));
		vi.stubGlobal('fetch', network);
		try {
			const routed = vi.fn(async () => new Response('routed'));
			setLiveFetch(routed);
			await readLiveText('http://apron-preview.invalid/live/1', recorder());
			expect([routed.mock.calls.length, network.mock.calls.length]).toEqual([1, 0]);
			setLiveFetch();
			await readLiveText('https://chat.example/t/1', recorder());
			expect(network).toHaveBeenCalledOnce();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('liveTextDecoder (§4.8.3)', () => {
	it("decodes as the server converts kept text: WHATWG's UTF-8 decode without BOM, carried across chunks", () => {
		const decoder = liveTextDecoder();
		const parts = [[0xef, 0xbb, 0xbf, 0x24, 0xe2, 0x82], [0xac, 0x20, 0xc0, 0xaf], [0x20, 0xe2]].map((b) => new Uint8Array(b));
		const text = parts.map((part) => decoder.decode(part, { stream: true })).join('') + decoder.decode();
		// The BOM stays, "€" cut between chunks is whole, C0 AF is two U+FFFD, and the cut-off E2 at the end is one.
		expect(text).toBe('\ufeff$\u20ac \ufffd\ufffd \ufffd');
	});
});

describe('editLiveText (§4.8.5)', () => {
	/** A text's chunks, each applied in turn to the text so far, as a reader does. */
	const edited = (...chunks: string[]) => chunks.reduce(editLiveText, '');

	it('removes the code point before each backspace: "é" and an astral emoji are one, a surrogate pair whole', () => {
		expect(edited('Ready.\b!')).toBe('Ready!');
		expect(edited('caf\u00e9\b')).toBe('caf');
		expect(edited('ok 🚀\b')).toBe('ok ');
		expect(edited('ok 🚀\b\b')).toBe('ok');
		// "é" written as e and a combining accent is two code points: one backspace removes the accent.
		expect(edited('cafe\u0301\b')).toBe('cafe');
		// One with nothing before it removes nothing.
		expect(edited('\b\bHi')).toBe('Hi');
	});

	it('clears the text before a form feed, and keeps what follows', () => {
		expect(edited('Looking at the logs…\f')).toBe('');
		expect(edited('Draft one\fDraft two\fThe plan')).toBe('The plan');
		expect(edited('Draft', ' one', '\fThe ', 'plan\bn')).toBe('The plan');
	});

	it('edits split across chunks: a backspace reaches back into the text kept so far', () => {
		expect(edited('Roll back the indx', '\b', 'ex')).toBe('Roll back the index');
		expect(edited('faield', '\b\b\bled')).toBe('failed');
		expect(edited('🚀🚀', '\b')).toBe('🚀');
		expect(edited('ab', '\b\b\b\bc')).toBe('c');
		// A chunk's own text goes first, then the kept text's end.
		expect(edited('abc', 'de\b\b\b')).toBe('ab');
	});

	it('removes a surrogate pair whole when a backspace brought its halves together', () => {
		// Removing "a" puts the pair's halves side by side, so the next backspace removes both.
		expect(edited('x\ud83da\b\ude80\b')).toBe('x');
		expect(edited('x\ud83dab\b\b\ude80\by')).toBe('xy');
		expect(edited('x\ud83da\b\ude80')).toBe('x🚀');
	});

	it('edits a large chunk of backspaces in time linear in its length', () => {
		// Each "aa\b" leaves one "a". Slicing a string at each backspace made this quadratic: 370 ms here, now about 10 ms.
		const chunk = 'aa\b'.repeat(100_000);
		const began = performance.now();
		const text = editLiveText('kept', chunk);
		const took = performance.now() - began;
		expect(text).toBe(`kept${'a'.repeat(100_000)}`);
		// The bound leaves a slow CI machine room.
		expect(took).toBeLessThan(200);
		expect(editLiveText('kept', `${chunk}${'\b'.repeat(100_002)}`)).toBe('ke');
		expect(editLiveText('kept', `${'\b'.repeat(100_000)}${chunk}`)).toBe('a'.repeat(100_000));
	});

	it('leaves text already edited as it is, so a server may serve either', () => {
		const raw = ['Here is the pla', 'm\bn:\fHere is the plan 🚀\b', ': roll back'];
		const once = edited(...raw);
		expect(once).toBe('Here is the plan : roll back');
		expect(edited(once)).toBe(once);
		expect(editLiveText(once, '')).toBe(once);
		// Edited text the server kept, then raw chunks: the same text.
		expect(edited(edited(raw[0], raw[1]), raw[2])).toBe(once);
	});
});

describe('writeLiveText', () => {
	afterEach(() => setLiveFetch());

	it('streams a PUT to the write URL, through the routed fetch', async () => {
		const seen: { url: string; init: RequestInit }[] = [];
		setLiveFetch(async (url, init) => {
			seen.push({ url, init });
			return new Response(await new Response(init.body).text(), { status: 200 });
		});
		expect(canWriteLiveText()).toBe(true);
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
		const done = writeLiveText('https://chat.example/w/1', body);
		controller.enqueue(bytes('hi\b!'));
		controller.close();
		const response = await done;
		expect(await response.text()).toBe('hi\b!');
		expect(seen[0].url).toBe('https://chat.example/w/1');
		expect(seen[0].init).toMatchObject({ method: 'PUT', duplex: 'half' });
	});
});
