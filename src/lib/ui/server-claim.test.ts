import { describe, expect, it, vi } from 'vitest';
import { SERVER_CLAIM_PREFIX, ServerClaim } from './server-claim';

/** Exclusive locks with `steal`, as the browser's are shared by every window of an origin. */
class FakeLocks {
	readonly held = new Map<string, { abort: (cause: unknown) => void }>();

	request(name: string, options: LockOptions, callback: LockGrantedCallback<unknown>): Promise<unknown> {
		const previous = this.held.get(name);
		if (previous && !options.steal) throw new Error('only steal is modelled');
		return new Promise((resolve, reject) => {
			if (previous) {
				this.held.delete(name);
				previous.abort(new DOMException('The lock was stolen', 'AbortError'));
			}
			const holder = { abort: reject };
			this.held.set(name, holder);
			queueMicrotask(() => {
				Promise.resolve(callback({ name, mode: 'exclusive' } as Lock)).then((value) => {
					if (this.held.get(name) === holder) this.held.delete(name);
					resolve(value);
				}, reject);
			});
		});
	}
}

function visibility(state: DocumentVisibilityState = 'visible') {
	const listeners = new Set<() => void>();
	return {
		visibilityState: state,
		addEventListener: (_: string, listener: () => void) => listeners.add(listener),
		removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
		show() {
			this.visibilityState = 'visible';
			for (const listener of listeners) listener();
		}
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const SERVER = 'wss://server.example/';
const OTHER = 'wss://other.example/';

function windowOn(locks: FakeLocks, state: DocumentVisibilityState = 'visible') {
	const lost = vi.fn();
	const document = visibility(state);
	const claim = new ServerClaim({ lost, locks: locks as unknown as LockManager, document: document as unknown as Document });
	return { claim, lost, document };
}

describe('ServerClaim', () => {
	it('takes the server from an older window, which is told', async () => {
		const locks = new FakeLocks();
		const older = windowOn(locks);
		older.claim.want(SERVER);
		await settle();
		expect(locks.held.has(SERVER_CLAIM_PREFIX + SERVER)).toBe(true);

		const newer = windowOn(locks);
		newer.claim.want(SERVER);
		await settle();
		expect(older.lost).toHaveBeenCalledExactlyOnceWith(SERVER);
		expect(older.claim.holds(SERVER)).toBe(false);
		expect(newer.claim.holds(SERVER)).toBe(true);
		expect(newer.lost).not.toHaveBeenCalled();

		// Use here, in the older window: it takes the server back.
		older.claim.want(SERVER);
		await settle();
		expect(newer.lost).toHaveBeenCalledExactlyOnceWith(SERVER);
		expect(older.claim.holds(SERVER)).toBe(true);
	});

	it('leaves windows on other servers alone, and lets go of a server it moves away from', async () => {
		const locks = new FakeLocks();
		const one = windowOn(locks);
		const two = windowOn(locks);
		one.claim.want(SERVER);
		two.claim.want(OTHER);
		await settle();
		expect(one.lost).not.toHaveBeenCalled();
		expect(two.lost).not.toHaveBeenCalled();

		one.claim.want(OTHER);
		await settle();
		expect(locks.held.has(SERVER_CLAIM_PREFIX + SERVER)).toBe(false);
		expect(two.lost).toHaveBeenCalledExactlyOnceWith(OTHER);
		// Letting go of its own is no loss.
		expect(one.lost).not.toHaveBeenCalled();
	});

	it('takes nothing while hidden, so a tab restored in the background leaves the one in front connected', async () => {
		const locks = new FakeLocks();
		const front = windowOn(locks);
		front.claim.want(SERVER);
		await settle();

		const background = windowOn(locks, 'hidden');
		background.claim.want(SERVER);
		await settle();
		expect(front.lost).not.toHaveBeenCalled();
		expect(background.claim.holds(SERVER)).toBe(false);

		background.document.show();
		await settle();
		expect(front.lost).toHaveBeenCalledExactlyOnceWith(SERVER);
		expect(background.claim.holds(SERVER)).toBe(true);
	});

	it('lets go when the client stops, or the page goes, even before the lock is granted', async () => {
		const locks = new FakeLocks();
		const window = windowOn(locks);
		window.claim.want(SERVER);
		window.claim.want(undefined);
		await settle();
		expect(locks.held.size).toBe(0);

		window.claim.want(SERVER);
		await settle();
		window.claim.dispose();
		await settle();
		expect(locks.held.size).toBe(0);
		expect(window.lost).not.toHaveBeenCalled();
	});

	it('does nothing where the browser has no Web Locks', () => {
		const lost = vi.fn();
		const claim = new ServerClaim({ lost, locks: undefined, document: visibility() as unknown as Document });
		claim.want(SERVER);
		expect(claim.holds(SERVER)).toBe(false);
	});
});
