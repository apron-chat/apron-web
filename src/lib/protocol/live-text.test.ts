import { afterEach, describe, expect, it, vi } from 'vitest';
import { followLiveText, liveTextDecoder, readLiveText, setLiveFetch, type LiveTextSink } from './live-text';

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
