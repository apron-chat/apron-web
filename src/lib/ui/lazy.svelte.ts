/**
 * Code the page renders only on demand (a dialog, an editor), loaded apart from the page's own. Reading `component`
 * asks for it: undefined until it has loaded, then the component, which stays, so later opens render at once (render
 * it as `{#if open && lazy.component}`). Each one is also fetched shortly after the page settles (`prefetchLazy`), so
 * the first open rarely waits on the network, and a tab opened before a deploy already holds it. A failed load is
 * forgotten, so the next read tries again.
 */
export class Lazy<T> {
	#component = $state<T>();
	#loading?: Promise<T>;
	#load: () => Promise<T>;

	/** `load` imports the code, once asked: `() => import('./on-demand').then((m) => m.Dialog)`. */
	constructor(load: () => Promise<T>) {
		this.#load = load;
		registered.push(this);
	}

	get component(): T | undefined {
		if (this.#component === undefined) this.load().catch(() => undefined);
		return this.#component;
	}

	load(): Promise<T> {
		this.#loading ??= this.#load().then(
			(component) => (this.#component = component),
			(error) => {
				this.#loading = undefined;
				throw error;
			}
		);
		return this.#loading;
	}
}

const registered: Lazy<unknown>[] = [];
let prefetching = false;

/** How long after the page asks to prefetch it waits, so the fetches stay clear of its start. */
const PREFETCH_AFTER_MS = 2000;

/** Fetches every lazy component in the background once the page is idle; once per page. */
export function prefetchLazy(): void {
	if (prefetching || typeof window === 'undefined') return;
	prefetching = true;
	const idle = (run: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(run, { timeout: 5000 }) : setTimeout(run, 0));
	setTimeout(() => idle(() => {
		for (const lazy of registered) lazy.load().catch(() => undefined);
	}), PREFETCH_AFTER_MS);
}
