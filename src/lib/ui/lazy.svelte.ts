import { onDemand } from './on-demand';

/**
 * Code the page renders only on demand (a dialog, an editor), loaded apart from the page's own. Reading `component`
 * asks for it: undefined until it has loaded, then the component, which stays, so later opens render at once (render
 * it as `{#if open && lazy.component}`). Each one is also fetched shortly after the page settles (`prefetchLazy`), so
 * the first open rarely waits on the network, and a tab opened before a deploy already holds it. A failed load is
 * forgotten, so the next read tries again.
 */
export class Lazy<T> {
	#component = $state<T>();
	#load: () => Promise<T>;
	#arrived: Promise<T>;

	/** `load` imports the code, once asked: `() => import('./on-demand').then((m) => m.Dialog)`. */
	constructor(load: () => Promise<T>) {
		let arrive!: (component: T) => void;
		this.#arrived = new Promise((settle) => (arrive = settle));
		this.#load = onDemand(() => load().then((component) => (arrive(component), (this.#component = component))));
		registered.push(this);
	}

	get component(): T | undefined {
		if (this.#component === undefined) this.load().catch(() => undefined);
		return this.#component;
	}

	#asked = false;
	/** Ends listening for a press elsewhere or Escape while an ask waits on the code (`once`'s `cancel`). */
	#waiting?: () => void;

	/**
	 * For a host that draws nothing until its state asks it to (a popover, a viewer), which an eager page would keep
	 * mounted throughout: undefined until `asked` has been true once, which asks for the code, then the component
	 * (`component`) from then on, so it stays mounted once it has been. Its state stays eager, so an ask before the code
	 * arrives is drawn as it lands, unless the viewer moves on first: while it waits, a press anywhere or Escape calls
	 * `cancel` (`cancelWhileWaiting`), as they would once it shows. Render it as
	 * `{#if lazy.once(Boolean(state.current), () => state.close(), state.current?.anchor)}`: it is read only as the ask
	 * or the code changes, so the page's other updates don't visit it. A press on `anchor` doesn't cancel it, as one
	 * doesn't close it once shown: the anchor's own click toggles it.
	 */
	once(asked: boolean, cancel?: () => void, anchor?: HTMLElement): T | undefined {
		if (asked) this.#asked = true;
		const component = this.#asked ? this.component : undefined;
		if (asked && cancel && component === undefined) this.#waiting ??= cancelWhileWaiting(true, cancel, anchor);
		else {
			this.#waiting?.();
			this.#waiting = undefined;
		}
		return component;
	}

	/**
	 * Settles once the code has loaded, whoever asked for it (`prefetchLazy`, say), without asking for it itself: for
	 * what can wait to be asked for, and should hold nothing up meanwhile.
	 */
	whenLoaded(): Promise<T> {
		return this.#arrived;
	}

	load(): Promise<T> {
		return this.#load();
	}
}

/**
 * Several lazy parts from one chunk, loaded in one request: the first part asked for loads them all, and every part is
 * then here, so what waits on one without asking (`whenLoaded`) learns of it whichever part was asked for. A failed
 * load is forgotten, so the next ask fetches again. Gives what makes a part: `part((m) => m.Dialog)`.
 */
export function lazyChunk<M>(load: () => Promise<M>): <T>(pick: (loaded: M) => T) => Lazy<T> {
	const parts: Lazy<unknown>[] = [];
	const loadChunk = onDemand(() => load().then((loaded) => {
		for (const part of parts) part.load().catch(() => undefined);
		return loaded;
	}));
	return (pick) => {
		const lazy = new Lazy(() => loadChunk().then(pick));
		parts.push(lazy);
		return lazy;
	};
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

/**
 * While `waiting` (a popover asked for before its code has come, so nothing of it shows yet), Escape or a press anywhere
 * calls `cancel`, as they would once it shows: an ask the viewer has moved on from doesn't open late, on an anchor that
 * may be gone by then. One left alone opens as its code lands. A press on `anchor` (what asked for it) doesn't
 * cancel it, as one doesn't close it once shown: the anchor's own click toggles it. `Lazy.once` uses it.
 */
export function cancelWhileWaiting(waiting: boolean, cancel: () => void, anchor?: HTMLElement): (() => void) | undefined {
	if (!waiting || typeof document === 'undefined') return;
	// What asked for it, as the popovers count it once shown: a press there is the anchor's to toggle with its click,
	// and a row that presses its anchor (`data-presses-anchor`, a member's) counts as the anchor.
	const trigger = anchor?.closest<HTMLElement>('[data-presses-anchor]') ?? anchor;
	const press = (event: Event) => {
		if (trigger && event.composedPath().includes(trigger)) return;
		cancel();
	};
	const key = (event: KeyboardEvent) => {
		if (event.key !== 'Escape') return;
		// The popover's Escape, as it would be shown: what lies under it (a dialog, an overlay) stays open.
		event.stopPropagation();
		cancel();
	};
	document.addEventListener('keydown', key, true);
	document.addEventListener('pointerdown', press, true);
	return () => {
		document.removeEventListener('keydown', key, true);
		document.removeEventListener('pointerdown', press, true);
	};
}
