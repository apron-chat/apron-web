import { createSubscriber } from 'svelte/reactivity';
import { followLiveText, liveTextDecoder } from '$lib/protocol/live-text';

/**
 * The text of an `append` embed (§4.8.5) while it is live: what `GET url`
 * has streamed so far, decoded as UTF-8 in streaming mode. It is read only
 * while something shows it: the first reader starts the request, and when
 * the last stops reading it is cancelled, to be read afresh (a reconnect
 * replaces what was shown). Readers hear of new text at most once an
 * animation frame.
 */
export class LiveAppend {
	#text = '';
	#live = true;
	readonly #subscribe: () => void;

	constructor(readonly url: string) {
		this.#subscribe = createSubscriber((update) => {
			const controller = new AbortController();
			let frame: number | undefined;
			const changed = () => {
				frame ??= nextFrame(() => {
					frame = undefined;
					update();
				});
			};
			let decoder = liveTextDecoder();
			this.#live = true;
			void followLiveText(url, {
				start: () => {
					decoder = liveTextDecoder();
					this.#text = '';
					this.#live = true;
					changed();
				},
				chunk: (bytes) => {
					this.#text += decoder.decode(bytes, { stream: true });
					changed();
				},
				end: () => {
					this.#text += decoder.decode();
					this.#live = false;
					changed();
				}
			}, controller.signal);
			return () => {
				controller.abort();
				if (frame !== undefined) cancelFrame(frame);
			};
		});
	}

	/** The text streamed so far: kept when the request ends or fails, until a new response replaces it. */
	get text(): string {
		this.#subscribe();
		return this.#text;
	}

	/** Still arriving: false once `GET url` ended, while the snapshot that finishes the message is on its way. */
	get live(): boolean {
		this.#subscribe();
		return this.#live;
	}
}

const nextFrame = (callback: () => void): number =>
	typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : (setTimeout(callback, 16) as unknown as number);
const cancelFrame = (frame: number): void => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(frame) : clearTimeout(frame));

/** How many live texts are kept by `url`, for rows that scroll away and back: the most recently asked for. */
const KEPT = 16;
const kept = new Map<string, LiveAppend>();

/** The live text at `url`, one per url, so every row showing it shares one request. */
export function liveAppend(url: string): LiveAppend {
	let entry = kept.get(url);
	if (entry) kept.delete(url);
	else entry = new LiveAppend(url);
	kept.set(url, entry);
	while (kept.size > KEPT) kept.delete(kept.keys().next().value!);
	return entry;
}
