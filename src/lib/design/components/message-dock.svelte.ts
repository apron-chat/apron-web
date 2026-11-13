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
	/** Its element, `.ap-msg-actions`, out of the document until a row takes it. */
	readonly host: HTMLElement;

	constructor() {
		this.host = document.createElement('div');
		this.host.className = 'ap-msg-actions';
		// Mounted now, empty, not when a row first asks: Svelte makes even a root a child of the effect running as it's
		// mounted, so one mounted from a row (its slot, or a focus an effect moved) would go with that row, frozen.
		mount(DockedActions, { target: this.host, props: { dock: this } });
		if (typeof IntersectionObserver !== 'undefined') new IntersectionObserver(this.#clipped, { threshold: 1 }).observe(this.host);
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
	 * Where its toolbar goes over the row that now holds it: just above the row, clear of its words, so a link on its
	 * first line can still be clicked; over the row's top edge for touch's menu, whose long press is on the row already.
	 * Nothing is measured here, as the pointer arrives with the page's styles not yet worked out: the observer moves it
	 * below the row where what scrolls it cuts it off above (`#clipped`).
	 */
	place(touch: boolean): void {
		this.host.classList.toggle('ap-msg-actions-above', !touch);
		this.host.classList.remove('ap-msg-actions-below');
	}

	/**
	 * The toolbar cut off by what scrolls its row: at the top, it goes below the row; cut off below the row too (a row
	 * as tall as the view), over the row's top edge, where it was before. Its rects come with the entry, laid out
	 * already, so this forces no layout; it runs only as the toolbar comes into or out of full view.
	 */
	#clipped = (entries: IntersectionObserverEntry[]): void => {
		const entry = entries[entries.length - 1];
		if (!entry || entry.intersectionRatio >= 1 || !this.host.isConnected) return;
		const cut = entry.intersectionRect.top > entry.boundingClientRect.top;
		const classes = this.host.classList;
		if (classes.contains('ap-msg-actions-above') && cut) {
			classes.remove('ap-msg-actions-above');
			classes.add('ap-msg-actions-below');
		} else if (classes.contains('ap-msg-actions-below') && !cut && entry.intersectionRect.height > 0) {
			classes.remove('ap-msg-actions-below');
		}
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
