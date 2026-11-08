/*
 * An audio clip's waveform, for AudioPlayer: the clip fetched and decoded, then reduced to `RESOLUTION` slices, each as
 * loud as its RMS (a slice's loudest sample is near the top in nearly every second of speech). The player draws them in
 * as many bars as its width has room for (`resample`). Decoding also gives the clip's length, which a recording made in
 * the browser doesn't report until it has played through.
 */

export interface Wave {
	/** One per bar, 0 to 1, the loudest bar 1. */
	peaks: number[];
	/** The clip's length in seconds. */
	duration: number;
}

/** The slices a clip is decoded into: as many bars as the widest player draws (480px at 3px a bar). */
export const RESOLUTION = 160;
/** Larger than this isn't decoded for a picture of it: a voice note is a few hundred KB, 4 MB about 15 minutes of Opus. */
export const MAX_BYTES = 4 * 1024 * 1024;
/** Plenty to see a voice's shape by, and a quarter of the memory a CD-rate decode would take. */
const SAMPLE_RATE = 11025;
/** Waves already worked out (or being), by URL and bar count: a clip scrolled away and back isn't fetched again. */
const cache = new Map<string, Promise<Wave | undefined>>();
const CACHE_SIZE = 100;

/** How loud each of `bars` slices of `samples` is (RMS), scaled so the loudest is 1 (all 0 for silence). */
export function bucketPeaks(samples: Float32Array, bars: number): number[] {
	const peaks: number[] = [];
	const step = samples.length / bars;
	let top = 0;
	for (let bar = 0; bar < bars; bar++) {
		const start = Math.floor(bar * step);
		const end = Math.floor((bar + 1) * step);
		let sum = 0;
		for (let i = start; i < end; i++) sum += samples[i] * samples[i];
		const peak = end > start ? Math.sqrt(sum / (end - start)) : 0;
		peaks.push(peak);
		if (peak > top) top = peak;
	}
	return top ? peaks.map((peak) => peak / top) : peaks;
}

/**
 * `peaks` in `bars` bars, each as loud as the slices it takes in together (the RMS of their RMS, as they are of equal
 * length), scaled so the loudest is 1. As many bars as peaks, or more, gives the peaks.
 */
export function resample(peaks: readonly number[], bars: number): number[] {
	const n = peaks.length;
	if (bars >= n) return [...peaks];
	const out: number[] = [];
	let top = 0;
	for (let bar = 0; bar < bars; bar++) {
		const start = Math.floor((bar * n) / bars);
		const end = Math.max(start + 1, Math.floor(((bar + 1) * n) / bars));
		let sum = 0;
		for (let i = start; i < end; i++) sum += peaks[i] * peaks[i];
		const level = Math.sqrt(sum / (end - start));
		out.push(level);
		if (level > top) top = level;
	}
	return top ? out.map((level) => level / top) : out;
}

/**
 * An SVG path of `peaks` as vertical bars centered on a line, in a box 2 units per bar wide and 2 tall, to be drawn
 * stretched to fit (`preserveAspectRatio="none"`) with a stroke that doesn't scale. Quiet parts keep a dot's height.
 */
export function wavePath(peaks: readonly number[]): string {
	return peaks.map((peak, i) => {
		const half = 0.08 + 0.82 * peak;
		return `M${i * 2 + 1} ${(1 - half).toFixed(3)}V${(1 + half).toFixed(3)}`;
	}).join('');
}

/** The response's body, read until it passes `MAX_BYTES`: then the download stops, and undefined. */
async function body(response: Response): Promise<ArrayBuffer | undefined> {
	if (Number(response.headers.get('content-length')) > MAX_BYTES) {
		void response.body?.cancel();
		return undefined;
	}
	if (!response.body) return response.arrayBuffer();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BYTES) {
			void reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return bytes.buffer;
}

/** The clip's wave; undefined when it is too large to draw. Throws when it can't be had now (a failed fetch or decode). */
async function decode(src: string, bars: number): Promise<Wave | undefined> {
	if (typeof OfflineAudioContext !== 'function') return undefined;
	const response = await fetch(src);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const bytes = await body(response);
	if (!bytes) return undefined;
	const audio = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
	return { peaks: bucketPeaks(audio.getChannelData(0), bars), duration: audio.duration };
}

/**
 * The wave of the clip at `src` in `bars` bars; undefined where it can't be had (too large, not readable from here).
 * A clip too large is remembered as such; one that failed (the network, a server error) is tried again next time.
 */
export function waveOf(src: string, bars: number): Promise<Wave | undefined> {
	const key = `${bars} ${src}`;
	let wave = cache.get(key);
	if (!wave) {
		wave = decode(src, bars).catch(() => {
			cache.delete(key);
			return undefined;
		});
		cache.set(key, wave);
		if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
	}
	return wave;
}
