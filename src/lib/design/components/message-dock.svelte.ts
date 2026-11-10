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
 * The message toolbar, built once and moved into whichever row the pointer, focus or a long press reaches (Message
 * claims it), rather than one built in each row the first time it's reached: a toolbar costs some thousands of calls to
 * build, and moving it costs what differs between two rows. A row may not take it while the row that holds it is using
 * it (its picker or ⋯ open, the keyboard in it, touch's menu): that row builds a toolbar of its own, as before.
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
	}

	/** The row that holds it is using it: a popup of its open (the picker, ⋯), the keyboard in it, or touch's menu. */
	#pinned(): boolean {
		const host = this.host;
		if (!this.#holder || !host.isConnected) return false;
		return Boolean(this.#holder.pinned?.() || host.contains(document.activeElement) || host.querySelector('[aria-expanded="true"]'));
	}

	/** Takes it for a row, unless the row that holds it is using it. True when the row now holds it. */
	claim(claim: DockClaim): boolean {
		const held = this.#holder;
		if (held === claim) return true;
		if (held && this.#pinned()) return false;
		this.owner = this.#holder = claim;
		held?.lost();
		return true;
	}

	/** A row that holds it goes, or its slot does: the toolbar draws nothing, so a picker its React opened closes. */
	release(claim: DockClaim): void {
		if (this.#holder !== claim) return;
		this.owner = this.#holder = undefined;
		this.host.remove();
	}
}

/** The dock; none where there is no document, as while pages are prerendered, where no row is ever reached. */
export const messageDock = (typeof document === 'undefined' ? undefined : new MessageDock()) as MessageDock;
