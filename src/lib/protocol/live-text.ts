/**
 * Reading live text (PROTOCOL.md §4.8.3): the `url` of an `append` or
 * `terminal` embed while it is live. `GET url` returns the text the server
 * kept, from its start, then more as it arrives, and ends when the text ends.
 * A reader that reconnects replaces what it showed with the new response.
 */

/** How a reader fetches: `fetch`, unless something routes its own URLs, as `/__preview` does to its in-memory server. */
export type LiveFetch = (url: string, init: RequestInit) => Promise<Response>;

const networkFetch: LiveFetch = (url, init) => fetch(url, init);
let liveFetch: LiveFetch = networkFetch;

/** Routes live text through `fetcher` (`/__preview`'s in-memory server); without one, back to the network. */
export function setLiveFetch(fetcher?: LiveFetch): void {
	liveFetch = fetcher ?? networkFetch;
}

/** What a reader of live text is told, in order: `start`, then `chunk`s; after a drop `start` again; `end` once. */
export interface LiveTextSink {
	/** A response began: it replaces whatever was shown, from the start of the text. */
	start(): void;
	/** The next bytes of the text, as they arrived: UTF-8, not cut at a character. */
	chunk(bytes: Uint8Array): void;
	/** The response ended, so the text did, or the text can no longer be read (`followLiveText`): keep what is shown until a snapshot finishes the embed. */
	end(): void;
}

/**
 * A decoder for live text's bytes, as the server converts the text it keeps
 * (§4.8.3): WHATWG's UTF-8 decode without BOM, so each invalid sequence reads
 * as one U+FFFD and a leading BOM stays. Decode each response with
 * `{stream: true}`, which carries a character cut between chunks, and call
 * `decode()` at its end, so that what was shown matches the finished text.
 */
export function liveTextDecoder(): TextDecoder {
	return new TextDecoder('utf-8', { ignoreBOM: true });
}

/**
 * An `append` embed's text (§4.8.5) with `added`, its next decoded text, applied to `kept`, the text so far after
 * its edits: U+0008 (backspace) removes the code point before it, U+000C (form feed) all the text before it. The
 * edits reach only the live text, never `body.text`, which the caller keeps apart. Text already edited has neither,
 * so it is unchanged, and a server may serve either. The cost is `added`'s length and what it removes, not `kept`'s.
 * Not for `terminal` embeds, where both are the terminal's own.
 */
export function editLiveText(kept: string, added: string): string {
	const feed = added.lastIndexOf('\f');
	if (feed !== -1) {
		kept = '';
		added = added.slice(feed + 1);
	}
	if (!added.includes('\b')) return kept + added;
	// Each backspace removes from what this chunk wrote before it, and once that is gone, from the end of `kept`.
	// What this chunk wrote and kept is runs of `added`, from `starts[i]` to `ends[i]`, joined once at the end:
	// a string built up and sliced at each backspace would be copied each time, so a chunk would cost its length squared.
	const starts: number[] = [];
	const ends: number[] = [];
	let fromKept = 0;
	let start = 0;
	for (let at = added.indexOf('\b'); at !== -1; at = added.indexOf('\b', start)) {
		if (at > start) {
			starts.push(start);
			ends.push(at);
		}
		start = at + 1;
		if (!ends.length) {
			fromKept++;
			continue;
		}
		// Remove the last code unit; when it ends a surrogate pair, the unit before it too, even in the run before.
		const unit = added.charCodeAt(--ends[ends.length - 1]);
		dropEmpty(starts, ends);
		if (ends.length && isLow(unit) && isHigh(added.charCodeAt(ends[ends.length - 1] - 1))) {
			ends[ends.length - 1]--;
			dropEmpty(starts, ends);
		}
	}
	const written = starts.map((from, i) => added.slice(from, ends[i]));
	written.push(added.slice(start));
	let end = kept.length;
	for (; fromKept > 0 && end > 0; fromKept--) end = lastCodePoint(kept, end);
	return (end === kept.length ? kept : kept.slice(0, end)) + written.join('');
}

/** Drops the last run when a backspace emptied it. */
function dropEmpty(starts: number[], ends: number[]): void {
	if (ends[ends.length - 1] !== starts[starts.length - 1]) return;
	starts.pop();
	ends.pop();
}

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** Where the code point that ends at `end` in `text` starts: a surrogate pair is one. */
export function lastCodePoint(text: string, end = text.length): number {
	return isLow(text.charCodeAt(end - 1)) && isHigh(text.charCodeAt(end - 2)) ? end - 2 : end - 1;
}

/** The pauses before trying again after a failure or a drop, the last repeated: a live text's url may not serve yet, or its connection may drop. */
export const LIVE_RETRY_MS = [1000, 2000, 4000, 8000, 15000] as const;

/** A `GET url` the server answered with a status other than OK. */
export class LiveTextStatusError extends Error {
	constructor(readonly status: number) {
		super(`The live text is not available (${status})`);
	}
}

/**
 * A server's answer that trying again would not change: a 4xx other than 408
 * (Request Timeout) and 429 (Too Many Requests), such as a reader cap's 403 or
 * an ended text's 404 or 410. Each try may count against the server's limits
 * on connecting, so a reader that kept trying could lock itself out.
 */
function definitive(cause: unknown): boolean {
	if (!(cause instanceof LiveTextStatusError)) return false;
	const { status } = cause;
	return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** One `GET url`: resolves when the text ends, rejects when it fails or drops (with `LiveTextStatusError` for a status other than OK). */
export async function readLiveText(url: string, sink: LiveTextSink, signal?: AbortSignal): Promise<void> {
	const response = await liveFetch(url, { cache: 'no-store', credentials: 'omit', ...(signal ? { signal } : {}) });
	if (!response.ok || !response.body) throw new LiveTextStatusError(response.status);
	const reader = response.body.getReader();
	sink.start();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value?.byteLength) sink.chunk(value);
		}
	} finally {
		reader.releaseLock();
	}
	sink.end();
}

/**
 * Follows live text until it ends or `signal` aborts (the embed finished, or
 * nothing shows it any more): after a failure or a drop it tries again,
 * waiting longer each time (`LIVE_RETRY_MS`), and the new response replaces
 * what was shown. What was shown stays meanwhile. A definitive 4xx (not 408
 * or 429) stops it as the text's end does, with `end`: what was shown stays
 * until the snapshot that ends the text (§4.8.5).
 */
export async function followLiveText(url: string, sink: LiveTextSink, signal: AbortSignal, retryMs: readonly number[] = LIVE_RETRY_MS): Promise<void> {
	let failures = 0;
	while (!signal.aborted) {
		let started = false;
		try {
			const counted: LiveTextSink = {
				start: () => {
					started = true;
					sink.start();
				},
				chunk: (bytes) => sink.chunk(bytes),
				end: () => sink.end()
			};
			await readLiveText(url, counted, signal);
			return;
		} catch (cause) {
			if (signal.aborted) return;
			if (definitive(cause)) {
				sink.end();
				return;
			}
			failures = started ? 1 : failures + 1;
			await pause(retryMs[Math.min(failures, retryMs.length) - 1] ?? 0, signal);
		}
	}
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);
		signal.addEventListener('abort', done, { once: true });
		function done(): void {
			clearTimeout(timer);
			signal.removeEventListener('abort', done);
			resolve();
		}
	});
}

/** The fetch that `setLiveFetch` routes live text through, as `/__preview` does; undefined for the network. */
export function routedLiveFetch(): LiveFetch | undefined {
	return liveFetch === networkFetch ? undefined : liveFetch;
}
