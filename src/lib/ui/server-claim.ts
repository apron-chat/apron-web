/**
 * One window or tab of this browser connects to a server at a time: the one most recently shown with its client
 * running. It holds a Web Lock named for the server, taken with `steal`, so a newer window takes it from an older one
 * without waiting, even from one frozen in the background (its loss reaches it as it runs again). The browser lets
 * go of a lock as its window closes, crashes or is discarded, so nothing else needs to say a window has gone.
 *
 * A window still hidden takes nothing: tabs restored in the background as the browser starts would otherwise take
 * the server from the one in front. The client waits to connect while hidden anyway; this claims once it is shown.
 * Where the browser has no Web Locks (an insecure origin, an old browser), every window connects, as before.
 */
export const SERVER_CLAIM_PREFIX = 'apron-connection:';

export interface ServerClaimOptions {
	/** Another window took `url`: this one is to stop using it. */
	lost: (url: string) => void;
	/** The browser's (`navigator.locks`) unless given; `undefined` given: none. */
	locks?: LockManager;
	document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}

export class ServerClaim {
	readonly #lost: (url: string) => void;
	readonly #locks: LockManager | undefined;
	readonly #document: ServerClaimOptions['document'];
	/** The server this window would hold, while its client runs and nothing told it to step aside. */
	#wanted: string | undefined;
	/** The claim taken or being taken; `release` lets go of it, even before the lock is granted. */
	#held: { url: string; release: () => void } | undefined;

	readonly #visibilityChanged = (): void => this.#update();

	constructor(options: ServerClaimOptions) {
		this.#lost = options.lost;
		this.#locks = 'locks' in options ? options.locks : (globalThis.navigator as Navigator | undefined)?.locks;
		this.#document = options.document ?? globalThis.document;
		this.#document?.addEventListener('visibilitychange', this.#visibilityChanged);
	}

	/** The server this window should hold, or none: taken at once if shown, else once it is. */
	want(url: string | undefined): void {
		this.#wanted = url;
		this.#update();
	}

	/** Whether this window holds, or is taking, `url`. */
	holds(url: string): boolean {
		return this.#held?.url === url;
	}

	dispose(): void {
		this.#wanted = undefined;
		this.#document?.removeEventListener('visibilitychange', this.#visibilityChanged);
		this.#update();
	}

	#update(): void {
		const wanted = this.#wanted;
		if (this.#held && this.#held.url !== wanted) {
			this.#held.release();
			this.#held = undefined;
		}
		if (!wanted || this.#held || !this.#locks || this.#document?.visibilityState === 'hidden') return;
		this.#take(this.#locks, wanted);
	}

	#take(locks: LockManager, url: string): void {
		let released = false;
		let resolve: (() => void) | undefined;
		const held = {
			url,
			release: () => {
				released = true;
				resolve?.();
			}
		};
		this.#held = held;
		let request: Promise<unknown>;
		try {
			request = locks.request(SERVER_CLAIM_PREFIX + url, { steal: true }, () => released ? undefined : new Promise<void>((done) => { resolve = done; }));
		} catch {
			this.#held = undefined;
			return;
		}
		request.catch((cause: unknown) => {
			if (this.#held !== held) return;
			this.#held = undefined;
			// Taken by another window's `steal`. Anything else (a lock manager gone with the document) is no one's.
			if ((cause as { name?: unknown } | null)?.name === 'AbortError') this.#lost(url);
		});
	}
}
