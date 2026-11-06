// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot } from '$lib/protocol/client';
import type { SessionView } from '$lib/ui/session.svelte';
import { render } from '$lib/test/dom';
import ConnectionNotice from './ConnectionNotice.svelte';

afterEach(() => {
	vi.useRealTimers();
});

/** A session reconnecting with the server's error and its wait (`retry_after`), as the client last emitted it. */
function limited(retryAfterMs: number) {
	const session = $state({
		connection: 'reconnecting',
		reconnectNeedsAttention: true,
		reconnectQuiet: false,
		waitingToReconnect: false,
		starting: false,
		stalled: false,
		snapshot: { status: 'reconnecting', authenticated: false, disconnectedAt: 1, error: 'Too many connections', retryAfterMs } as unknown as ClientSnapshot
	});
	return session;
}

const text = () => document.querySelector('[data-testid="connection-status"] [aria-hidden="true"]')?.textContent ?? document.querySelector('[data-testid="connection-status"]')?.textContent;
const tryAgain = () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Try Again')!;

describe('ConnectionNotice', () => {
	it('counts the server’s wait down while nothing is emitted, and offers Try Again once it is over', () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const session = limited(3_000);
		render(ConnectionNotice, { session: session as unknown as SessionView, onretry: () => undefined });
		expect(text()).toBe('Too many connections. Retrying in 3s…');
		expect(tryAgain().disabled).toBe(true);
		vi.advanceTimersByTime(1_000);
		flushSync();
		expect(text()).toBe('Too many connections. Retrying in 2s…');
		// A screen reader hears the wait as it came, not every second of it.
		expect(document.querySelector('[data-testid="connection-status"] .ap-sr')?.textContent).toBe('Too many connections. Retrying in 3s…');
		vi.advanceTimersByTime(2_000);
		flushSync();
		expect(text()).toBe('Too many connections');
		expect(tryAgain().disabled).toBe(false);
		// Nothing ticks once it's over.
		expect(vi.getTimerCount()).toBe(0);
	});

	it('counts from when the wait ends, as each snapshot says it', () => {
		vi.useFakeTimers({ now: 1_000_000 });
		const session = limited(90_000);
		render(ConnectionNotice, { session: session as unknown as SessionView, onretry: () => undefined });
		expect(text()).toBe('Too many connections. Retrying in 2m…');
		vi.advanceTimersByTime(40_000);
		flushSync();
		expect(text()).toBe('Too many connections. Retrying in 50s…');
		// Another emit meanwhile says what is left then.
		session.snapshot = { ...session.snapshot, retryAfterMs: 50_000 };
		flushSync();
		expect(text()).toBe('Too many connections. Retrying in 50s…');
	});
});
