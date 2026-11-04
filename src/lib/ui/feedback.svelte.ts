import { RateLimitError, type OperationHandle } from '$lib/protocol/client-types';

export type Feedback = { kind: 'pending' | 'error'; text: string };

/** How long a request may take before the toast admits it is still pending. */
const QUIET_MS = 600;

/** The one toast at the foot of the pane: a pending line for slow requests, an error until the next one. */
export class FeedbackState {
	current = $state<Feedback | undefined>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	/**
	 * Moves on with every change of toast: a request `track` follows changes the toast only while its turn
	 * lasts, so one that settles late leaves whatever replaced its toast (a newer request's, another's error).
	 */
	private turn = 0;

	pending(text: string): void {
		this.next();
		this.current = { kind: 'pending', text };
	}

	/**
	 * Shows an error, returned for `dismiss`. A wait (`RateLimitError.scope`) on a `history` or `message` request isn't
	 * one: the page shows those where they apply, counting down, and nothing is toasted. Another request a wait holds
	 * back, such as a reaction during a `write` wait, is toasted as any error, with how long the wait is.
	 */
	error(cause: unknown, fallback = 'Something went wrong'): Feedback | undefined {
		this.next();
		if (cause instanceof RateLimitError && cause.scope && (cause.method === 'history' || cause.method === 'message')) {
			if (this.current?.kind === 'pending') this.current = undefined;
			return undefined;
		}
		this.current = { kind: 'error', text: cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : fallback };
		return this.current;
	}

	clear(): void {
		this.next();
		this.current = undefined;
	}

	/** Clears `shown` if it is still the toast: one that no longer applies, not whatever replaced it. */
	dismiss(shown: Feedback | undefined): void {
		if (shown && this.current === shown) this.clear();
	}

	/**
	 * Shows the pending copy only when a request takes noticeably long, and its error until the next request:
	 * while the toast is still this request's. `onError` runs on a failure either way.
	 */
	track(handle: OperationHandle, pendingText: string, onError?: () => void): void {
		this.clear();
		const turn = this.turn;
		this.timer = setTimeout(() => (this.current = { kind: 'pending', text: pendingText }), QUIET_MS);
		handle.promise.then(
			() => {
				if (this.turn === turn) this.clear();
			},
			(cause: unknown) => {
				if (this.turn === turn) this.error(cause);
				onError?.();
			}
		);
	}

	dispose(): void {
		this.stopTimer();
	}

	/** The toast changes: what came before, and its timer, are done with. */
	private next(): void {
		this.stopTimer();
		this.turn += 1;
	}

	private stopTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}
}
