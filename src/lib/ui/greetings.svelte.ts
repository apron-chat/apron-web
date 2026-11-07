import type { ServerParams } from '$lib/protocol/types';

/**
 * A server's greeting as the connect screen knows it: being looked up,
 * known, or why it couldn't be read.
 */
export type Greeting =
	| { status: 'contacting' }
	| { status: 'known'; server: ServerParams }
	| { status: 'failed'; error: string };

/** What reads a greeting: `ChatClient.greet`. */
export interface Greeter {
	greet(url: string, signal?: AbortSignal): Promise<ServerParams>;
}

/**
 * The `server` frames (§3.1) the connect screen looked up, by server
 * address, for as long as the page is open. Nothing is looked up until the
 * viewer asks (Continue): a link or a typed address alone contacts no one.
 * Once known, a greeting is kept: going back to change the server, a sign-in
 * that expired, or opening the connect screen again offers the same schemes
 * without contacting the server again. The connection a sign-in then opens
 * brings the server's current frame, which the client keeps as its own.
 */
export class Greetings {
	/** Replaced whole on each change, so what reads it updates (a plain record: `svelte/reactivity` would load with the app). */
	#entries = $state<Record<string, Greeting>>({});
	readonly #pending = new Map<string, { promise: Promise<Greeting>; abort: AbortController }>();

	/** The greeting for `url`, if it was looked up. */
	get(url: string): Greeting | undefined {
		return this.#entries[url];
	}

	/** The server at `url`, once its greeting is known. */
	server(url: string): ServerParams | undefined {
		const greeting = this.#entries[url];
		return greeting?.status === 'known' ? greeting.server : undefined;
	}

	/**
	 * Looks the greeting for `url` up, unless it is known or being looked up
	 * already. Resolves with how it went; a cancelled lookup leaves nothing behind.
	 */
	look(greeter: Greeter, url: string): Promise<Greeting> {
		const known = this.#entries[url];
		if (known?.status === 'known') return Promise.resolve(known);
		const pending = this.#pending.get(url);
		if (pending) return pending.promise;
		const abort = new AbortController();
		this.#set(url, { status: 'contacting' });
		const promise = greeter.greet(url, abort.signal).then(
			(server): Greeting => ({ status: 'known', server }),
			(cause): Greeting => ({ status: 'failed', error: cause instanceof Error ? cause.message : 'Can’t reach the server.' })
		).then((greeting) => {
			if (this.#pending.get(url)?.abort !== abort) return greeting;
			this.#pending.delete(url);
			this.#set(url, abort.signal.aborted ? undefined : greeting);
			return greeting;
		});
		this.#pending.set(url, { promise, abort });
		return promise;
	}

	/** Gives up every lookup under way, closing its connection. */
	cancel(): void {
		for (const [url, pending] of this.#pending) {
			pending.abort.abort();
			this.#pending.delete(url);
			this.#set(url, undefined);
		}
	}

	#set(url: string, greeting: Greeting | undefined): void {
		const { [url]: _, ...rest } = this.#entries;
		this.#entries = greeting ? { ...rest, [url]: greeting } : rest;
	}
}

/** The page's greetings. */
export const greetings = new Greetings();
