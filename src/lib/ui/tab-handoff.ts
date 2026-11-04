/**
 * One tab, not two, when a sign-in link opens (PROTOCOL.md §4.11.2). An
 * emailed link opens a new tab, while the tab that asked for it is still
 * open, waiting: the new tab is where the viewer is looking, so it takes
 * over, and the old one goes dormant ("Apron is open in another tab").
 *
 * The old tab still approves: a code works only on the connection that
 * proposed, and a guest's registration only on that guest's connection
 * (§4.11.3), so the link's token goes back to it. Over a
 * `BroadcastChannel`, which reaches only this origin's tabs in this browser:
 *
 * 1. The new tab offers the link: `{ kind: 'link', id, state, token }`.
 * 2. The tab holding that `state`'s open proposal answers `taken` at once,
 *    approves with the token on its connection, which saves the session
 *    for the server (shared storage), and answers `done`: with the room it
 *    had open, or with why it failed. Then it goes dormant.
 * 3. The new tab, told `done`, takes up the saved session and opens that
 *    room; or shows why it failed. With no `taken` in a moment, no tab is
 *    waiting, and the new tab uses the link itself.
 *
 * Only a tab holding the `state` acts on a link: it is unguessable, and a
 * link someone else sent carries another, or none.
 */

export const HANDOFF_CHANNEL = 'apron.sign-in-link';

/** How long the new tab waits for a tab to take its link before using it itself. */
export const TAKE_WAIT_MS = 500;
/** How long it then waits for that tab's approval; past it, the approval is taken to have failed. */
export const DONE_WAIT_MS = 30_000;

export type HandoffMessage =
	| { kind: 'link'; id: string; state: string; token: string }
	| { kind: 'taken'; id: string }
	| { kind: 'done'; id: string; error?: string; room?: string; thread?: string; session?: { token: string; userId?: string } };

/** What the tab that asked hands over once it approved: the place it had open, and the session it signed in with. */
export interface HandedOver {
	room?: string;
	thread?: string;
	/**
	 * Saved for the server too, but storage reaches other tabs a moment late, so it comes along. The channel
	 * reaches only this origin's tabs, which can read that storage anyway.
	 */
	session?: { token: string; userId?: string };
}

/** The part of a `BroadcastChannel` used here, so tests can stand in for it. */
export interface HandoffChannel {
	postMessage(message: HandoffMessage): void;
	addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
	removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

/** This origin's hand-off channel, or none where the browser has no `BroadcastChannel`. */
export function openHandoffChannel(): (HandoffChannel & { close(): void }) | undefined {
	try {
		return typeof BroadcastChannel === 'function' ? new BroadcastChannel(HANDOFF_CHANNEL) as HandoffChannel & { close(): void } : undefined;
	} catch {
		return undefined;
	}
}

/** What came of offering a link: no tab took it (`unclaimed`), or the tab that asked approved it (`signedIn`) or couldn't (`error`). */
export type OfferOutcome =
	| { kind: 'unclaimed' }
	| ({ kind: 'signedIn' } & HandedOver)
	| { kind: 'error'; error: string };

/**
 * Offers a link with `state` to the tab that asked for it (step 1), and
 * resolves with what came of it.
 */
export function offerLink(
	channel: HandoffChannel, link: { state: string; token: string },
	options: { takeWaitMs?: number; doneWaitMs?: number; id?: string } = {}
): Promise<OfferOutcome> {
	const id = options.id ?? randomId();
	return new Promise((resolve) => {
		let timer: ReturnType<typeof setTimeout>;
		const finish = (outcome: OfferOutcome) => {
			clearTimeout(timer);
			channel.removeEventListener('message', listener);
			resolve(outcome);
		};
		const listener = (event: { data: unknown }) => {
			const message = readMessage(event.data);
			if (!message || message.id !== id) return;
			if (message.kind === 'taken') {
				clearTimeout(timer);
				timer = setTimeout(() => finish({ kind: 'error', error: 'The other tab didn’t finish signing in' }), options.doneWaitMs ?? DONE_WAIT_MS);
			} else if (message.kind === 'done') {
				finish(message.error !== undefined
					? { kind: 'error', error: message.error }
					: { kind: 'signedIn', ...handedOver(message) });
			}
		};
		channel.addEventListener('message', listener);
		timer = setTimeout(() => finish({ kind: 'unclaimed' }), options.takeWaitMs ?? TAKE_WAIT_MS);
		channel.postMessage({ kind: 'link', id, state: link.state, token: link.token });
	});
}

/**
 * Answers links offered by other tabs (step 2). `take` is asked of each:
 * undefined when this tab holds no open proposal with its `state`, else the
 * approval, resolving with the place this tab had open, or rejecting with
 * why it failed. `taken` goes out before the approval starts, `done` after.
 * Returns a function that stops answering.
 */
export function answerLinks(
	channel: HandoffChannel,
	take: (state: string, token: string) => Promise<HandedOver> | undefined,
	onDone?: (outcome: { ok: boolean }) => void
): () => void {
	const listener = (event: { data: unknown }) => {
		const message = readMessage(event.data);
		if (message?.kind !== 'link') return;
		const approval = take(message.state, message.token);
		if (!approval) return;
		channel.postMessage({ kind: 'taken', id: message.id });
		approval.then(
			(place) => {
				channel.postMessage({ kind: 'done', id: message.id, ...handedOver(place) });
				onDone?.({ ok: true });
			},
			(cause: unknown) => {
				channel.postMessage({ kind: 'done', id: message.id, error: cause instanceof Error && cause.message ? cause.message : 'unknown error' });
				onDone?.({ ok: false });
			}
		);
	};
	channel.addEventListener('message', listener);
	return () => channel.removeEventListener('message', listener);
}

function handedOver(from: HandedOver): HandedOver {
	return {
		...(from.room ? { room: from.room } : {}),
		...(from.thread ? { thread: from.thread } : {}),
		...(from.session?.token ? { session: { token: from.session.token, ...(from.session.userId ? { userId: from.session.userId } : {}) } } : {})
	};
}

function readMessage(data: unknown): HandoffMessage | undefined {
	if (typeof data !== 'object' || data === null) return undefined;
	const message = data as Record<string, unknown>;
	if (typeof message.id !== 'string') return undefined;
	if (message.kind === 'link') return typeof message.state === 'string' && typeof message.token === 'string' ? message as HandoffMessage : undefined;
	if (message.kind === 'taken') return message as HandoffMessage;
	if (message.kind === 'done') {
		const optional = (key: string) => message[key] === undefined || typeof message[key] === 'string';
		const session = message.session as Record<string, unknown> | undefined;
		const sessionOk = session === undefined || (typeof session === 'object' && session !== null && typeof session.token === 'string' && (session.userId === undefined || typeof session.userId === 'string'));
		return optional('error') && optional('room') && optional('thread') && sessionOk ? message as HandoffMessage : undefined;
	}
	return undefined;
}

function randomId(): string {
	const bytes = new Uint8Array(12);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
