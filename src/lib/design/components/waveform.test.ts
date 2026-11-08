import { afterEach, describe, expect, it, vi } from 'vitest';
import { bucketPeaks, MAX_BYTES, resample, wavePath, waveOf } from './waveform';

describe('bucketPeaks', () => {
	it('gives each slice its loudness (RMS), the loudest scaled to 1', () => {
		const samples = new Float32Array([0.5, -0.5, 0.25, -0.25, 0, 0]);
		expect(bucketPeaks(samples, 3)).toEqual([1, 0.5, 0]);
	});

	it('spreads uneven slices over the clip, and gives silence all zeros', () => {
		expect(bucketPeaks(new Float32Array(10).fill(0.1), 4).map((p) => Math.round(p * 100) / 100)).toEqual([1, 1, 1, 1]);
		expect(bucketPeaks(new Float32Array(8), 4)).toEqual([0, 0, 0, 0]);
	});
});

describe('resample', () => {
	it('folds slices into fewer bars by their combined loudness, the loudest scaled to 1', () => {
		expect(resample([1, 1, 0.5, 0.5], 2)).toEqual([1, 0.5]);
		expect(resample([0, 0, 0.6, 0.8], 2).map((p) => Math.round(p * 1000) / 1000)).toEqual([0, 1]);
	});

	it('spreads slices that don\'t divide evenly, and keeps them as they are for as many bars or more', () => {
		expect(resample([1, 0, 0, 0, 1], 2)).toHaveLength(2);
		expect(resample([0.2, 1], 2)).toEqual([0.2, 1]);
		expect(resample([0.2, 1], 5)).toEqual([0.2, 1]);
	});
});

describe('wavePath', () => {
	it('draws a bar per peak, centered on the line, 2 units apart, the quietest still a dot', () => {
		expect(wavePath([1, 0])).toBe('M1 0.100V1.900M3 0.920V1.080');
	});
});

describe('waveOf', () => {
	let n = 0;
	/** A URL no other test has asked for, as waves are remembered by URL. */
	const fresh = () => `blob:clip-${++n}`;

	/** Decodes any bytes as a second of a steady tone. */
	function decoder(): void {
		vi.stubGlobal('OfflineAudioContext', class {
			decodeAudioData = async () => ({ duration: 1, getChannelData: () => new Float32Array(8).fill(0.5) });
		});
	}

	/** A body sent in `chunks` chunks of `size` bytes, with no length header, and how many were read. */
	function streamed(chunks: number, size: number): { response: Response; read: () => number } {
		let sent = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sent === chunks) return controller.close();
				sent++;
				controller.enqueue(new Uint8Array(size));
			}
		});
		return { response: new Response(stream), read: () => sent };
	}

	afterEach(() => vi.unstubAllGlobals());

	it('decodes a clip into bars and its length, and fetches it once', async () => {
		decoder();
		const fetch = vi.fn(async () => new Response(new Uint8Array(16)));
		vi.stubGlobal('fetch', fetch);
		const src = fresh();
		expect(await waveOf(src, 4)).toEqual({ peaks: [1, 1, 1, 1], duration: 1 });
		await waveOf(src, 4);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('stops downloading a clip without a length once it passes the cap, and keeps the plain bar for it', async () => {
		decoder();
		const body = streamed(100, 1024 * 1024);
		const fetch = vi.fn(async () => body.response);
		vi.stubGlobal('fetch', fetch);
		const src = fresh();
		expect(await waveOf(src, 4)).toBeUndefined();
		expect(body.read()).toBeLessThanOrEqual(MAX_BYTES / (1024 * 1024) + 2);
		await waveOf(src, 4);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('doesn\'t download a clip whose length says it is past the cap', async () => {
		decoder();
		const body = streamed(1, 16);
		vi.stubGlobal('fetch', async () => new Response(body.response.body, { headers: { 'content-length': String(MAX_BYTES + 1) } }));
		expect(await waveOf(fresh(), 4)).toBeUndefined();
	});

	it('tries again next time after a failure', async () => {
		decoder();
		const fetch = vi.fn(async () => new Response('', { status: 503 }));
		vi.stubGlobal('fetch', fetch);
		const src = fresh();
		expect(await waveOf(src, 4)).toBeUndefined();
		fetch.mockImplementation(async () => new Response(new Uint8Array(16)));
		expect(await waveOf(src, 4)).toEqual({ peaks: [1, 1, 1, 1], duration: 1 });
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
