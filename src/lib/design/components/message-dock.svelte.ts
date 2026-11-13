import { mount } from 'svelte';
import DockedActions from './DockedActions.svelte';
import type { MessageAction } from './types';

/** What a row's toolbar draws: its actions, and whether touch's long press opened it. */
export interface DockedBar {
	quick: MessageAction[];
	items: MessageAction[];
	more?: MessageAction[];
	touch: boolean;
}

/** A row's hold on the dock: what to draw (nothing while it has no toolbar to show), and when it may not be taken. */
export interface DockClaim {
	bar: () => DockedBar | undefined;
	/** It is in use beyond what the dock sees in its own markup, such as touch's menu open on the row. */
	pinned?: () => boolean;
	/** Another row took it: the row draws no slot for it any more. */
	lost: () => void;
}

/**
 * The message toolbar, the only one: built once and moved into whichever row the pointer, focus or a long press
 * reaches (Message claims it), rather than one built in each row the first time it's reached. A toolbar costs some
 * thousands of calls to build, and moving it costs what differs between two rows. A row may not take it while the row
 * that holds it is using it (its picker or menu open, touch's menu), and then shows none until the pointer moves over
 * it once that's done, but a long press may: touch's new menu is the one wanted.
 */
class MessageDock {
	/** The claim that holds it, for its toolbar to draw. */
	owner = $state.raw<DockClaim | undefined>(undefined);
	/**
	 * The same, for its own decisions: a teardown in the flush that follows a claim (the slot of the row that lost it)
	 * reads `owner` as it was when the flush began, and would release the dock from the row that just took it.
	 */
	#holder: DockClaim | undefined;
	/** Watches its toolbar for being cut off (`#clipped`); held, as one nothing holds may be collected with the work it does. */
	readonly #observer: IntersectionObserver | undefined;
	/** Its element, `.ap-msg-actions`, out of the document until a row takes it. */
	readonly host: HTMLElement;

	constructor() {
		this.host = document.createElement('div');
		this.host.className = 'ap-msg-actions';
		// Mounted now, empty, not when a row first asks: Svelte makes even a root a child of the effect running as it's
		// mounted, so one mounted from a row (its slot, or a focus an effect moved) would go with that row, frozen.
		mount(DockedActions, { target: this.host, props: { dock: this } });
		this.#observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(this.#clipped, { threshold: [0, 1] });
		this.#observer?.observe(this.host);
	}

	/**
	 * The row that holds it is using it: a popup of its open (the picker), its menu open (⋯), or touch's menu. Focus on
	 * the row or in the toolbar isn't: it stays there long after the pointer moves on (a click leaves it on the button).
	 */
	#pinned(): boolean {
		const host = this.host;
		if (!this.#holder || !host.isConnected) return false;
		return Boolean(this.#holder.pinned?.() || host.querySelector('[aria-expanded="true"], .ap-actions-menu'));
	}

	/**
	 * Takes it for a row, unless the row that holds it is using it and this isn't `taking` it anyway (a long press,
	 * whose menu is the one wanted now). True when the row now holds it.
	 */
	claim(claim: DockClaim, taking = false): boolean {
		const held = this.#holder;
		if (held === claim) return true;
		if (held && !taking && this.#pinned()) return false;
		// Focus in it goes back to its row, as it would be lost as the toolbar moves: the keyboard keeps its place, and
		// that row's next key brings the toolbar back.
		if (this.host.contains(document.activeElement)) this.host.closest<HTMLElement>('.ap-msg')?.focus({ preventScroll: true });
		this.owner = this.#holder = claim;
		held?.lost();
		return true;
	}

	/**
	 * A row took it: its toolbar goes above the row (apron.css) until the observer sees it cut off there. Nothing is
	 * measured here, as the pointer arrives with the page's styles not yet worked out. The observer calls back only as
	 * the toolbar crosses into or out of view or full view, so where it was last seen cut off, or out of the document,
	 * it's watched afresh, for the next frame to say how it fares over this row.
	 */
	place(): void {
		this.host.classList.remove('ap-msg-actions-below');
		if (!this.#partial || !this.#observer) return;
		this.#observer.unobserve(this.host);
		this.#observer.observe(this.host);
	}

	/** Its toolbar was last seen less than whole: cut off, or out of the document. */
	#partial = true;

	/**
	 * The toolbar cut off at the top by what scrolls its row, or out of view altogether (above the row, it can only have
	 * gone off the top): it goes below the row. Its rects come with the entry, laid out already, so this forces no
	 * layout. Not while the row is using it (its picker or ⋯'s menu open), which would move it from under the pointer.
	 */
	#clipped = (entries: IntersectionObserverEntry[]): void => {
		const entry = entries[entries.length - 1];
		if (!entry) return;
		this.#partial = entry.intersectionRatio < 1;
		if (!this.#partial || !this.host.isConnected || this.#pinned()) return;
		const cut = !entry.isIntersecting || entry.intersectionRect.top > entry.boundingClientRect.top;
		if (cut) this.host.classList.add('ap-msg-actions-below');
	};

	/** A row that holds it goes, or its slot does: the toolbar draws nothing, so a picker its React opened closes. */
	release(claim: DockClaim): void {
		if (this.#holder !== claim) return;
		this.owner = this.#holder = undefined;
		this.host.remove();
	}
}

/** The dock; none where there is no document, as while pages are prerendered, where no row is ever reached. */
export const messageDock = (typeof document === 'undefined' ? undefined : new MessageDock()) as MessageDock;
