/**
 * The open pane's timeline as a viewport (`TimelineViewport`): where its list is scrolled and why. It follows the
 * latest while pinned there, keeps the reader's place as older items land above, opens a pane at its New divider,
 * says whether the latest message is on screen and what arrived since, and loads older pages reading back. The page
 * makes one, binds the list to `messageScroll`, and calls its `watch*` methods from its init, each where its effects
 * belong among the page's own: effects run in the order they were made, and some of these must come before others there.
 */
import { tick, untrack } from 'svelte';
import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
import { compareLogIds } from '$lib/protocol/reducer';
import type { Identity, MessageRecord } from '$lib/protocol/types';
import { FloatingDay } from './floating-day.svelte';
import type { MentionTracker } from './mentions.svelte';
import { ProgressiveReveal } from './reveal.svelte';
import { newDividerBefore, type TimelineItem } from './timeline';

/** How near the top of a thread reading back starts loading its older replies. */
const OLDER_REPLIES_MARGIN_PX = 240;

/** How long a jump waits for its target to render (a thread's history may still be loading). */
export const JUMP_WAIT_MS = 4000;
/** Room left above the New divider when a pane opens at it, clear of the floating day. */
const LAND_MARGIN_PX = 48;
/** Items rendered above the New divider when a pane opens at it, so there is something to scroll up to. */
const LAND_CONTEXT_ITEMS = 10;
/**
 * Opening a room renders its newest items first, enough to fill the pane,
 * and the older ones a chunk per frame after that paints, so switching
 * rooms shows the room without waiting for its whole history to render.
 */
const FIRST_PAINT_ITEMS = 40;
const REVEAL_CHUNK_ITEMS = 60;
/**
 * A pane opened before its messages came (the page's first, or a room not loaded yet) renders this many of its newest
 * items when they do, then as many more as fill it (`fillPane`), before the frame paints; the rest follow it.
 */
const ARRIVAL_ITEMS = 6;
/** How far the first item rendered must sit above the pane's top at its latest: past any shadow from a row above. */
const FILL_SLACK_PX = 16;
/**
 * How far back a pane opening at its New divider loads to reach it, in pages of history: a client choice, so that
 * opening a room read long ago asks for a few pages, not its whole backlog. Further back, it opens at the latest.
 */
const DIVIDER_PAGES = 3;
/** How long a side panel takes to slide open or shut: --duration-slide in tokens.css. */
const SLIDE_MS = 240;

/** What the viewport reads of the page, as it changes. */
export interface TimelineViewportHost {
	/** The client, which loads older pages. */
	readonly client: Pick<ChatClient, 'loadOlder'> | undefined;
	/** The room the pane shows and the composer posts to: the open thread (itself a room), else the room. */
	readonly paneRoom: RoomSnapshot | undefined;
	/** The live thread or room whose older pages load as the reader scrolls back: not a copy held from before. */
	readonly olderSource: RoomSnapshot | undefined;
	/** The pane's items, all of them: `reveal` says how many of the oldest are still to render. */
	readonly timeline: TimelineItem[];
	/** The pane's messages, oldest first. */
	readonly messages: MessageRecord[];
	readonly you: Identity | undefined;
	/** Nothing held to show while the room's threads are listed: placeholders. */
	readonly paneHeldBack: boolean;
	/** The open pane is catching up: its history is recovering or loading, or it shows a copy held from before. */
	readonly paneCatchingUp: boolean;
	/** The page is in view. */
	readonly visible: boolean;
	readonly mentions: Pick<MentionTracker, 'clearUnseen'>;
	/** Your read position in `room`, fresh, as it is when the pane opens: the New divider goes after it. */
	readThrough(room: RoomSnapshot): string | undefined;
}

/** Where the New divider sits on a visit to a pane, and how far the pane has got opening at it. */
interface Divider {
	/** The pane visited: a visit lasts until the pane shows another room or thread. */
	readonly pane: string;
	/** Your read position as the pane loaded, from `readThrough`: the divider goes after it. */
	readonly after?: string;
	/**
	 * `waiting` for the pane's history, which the read position is placed against; then `landing` while the pane opens
	 * at the divider (`landAtDivider`); `landed` once it has, or stayed at the latest. Each comes once per visit.
	 */
	readonly phase: 'waiting' | 'landing' | 'landed';
}

/**
 * Where the reader was, noted before older items land above them (`keepPlace`): the list, its scroll top and height,
 * and the pane it showed, so that a page or chunk that lands after the pane went elsewhere moves nothing.
 */
interface Place {
	readonly pane: string | undefined;
	readonly scroller: HTMLElement;
	readonly top: number;
	readonly height: number;
}

/** Whether the list is scrolled to (near enough) its end. */
export function atLatest(scroller: HTMLElement): boolean {
	return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
}

/** Waits, a frame at a time, until `ready` holds or `ms` pass. */
export async function until(ready: () => boolean, ms: number): Promise<void> {
	const started = performance.now();
	while (!ready() && performance.now() - started < ms) await new Promise((resolve) => requestAnimationFrame(resolve));
}

/** The timeline's last row, looked for from its end: each row is one of its children, or (a thread card) inside one. */
function lastRow(scroll: HTMLElement): HTMLElement | undefined {
	for (let child = scroll.lastElementChild; child; child = child.previousElementSibling) {
		const row = child.hasAttribute('data-timeline-item') ? child : child.querySelector('[data-timeline-item]');
		if (row instanceof HTMLElement) return row;
	}
	return undefined;
}

/**
 * Its state is kept in private fields and read as they are within: through the public accessors, each read would be
 * a call more, on paths that run with every scroll and frame.
 */
export class TimelineViewport {
	readonly #host: TimelineViewportHost;
	#messageScroll = $state<HTMLDivElement | undefined>();
	/**
	 * The pane follows the latest: it scrolls there as more comes in, and counts nothing as unseen. Only the viewport
	 * sets it: opening a pane, sending (`pin`) and jumping to the latest pin it, each scroll event says whether the
	 * reader is at the latest, and a jump to a message or a landing at the divider says so where it leaves the list
	 * (`settle`).
	 */
	#stickToBottom = $state(true);
	/** Whether the pane's latest row was on screen, as last measured, and the pane it was measured in (`measured`). */
	#latestVisible = $state(true);
	#latestVisibleIn = $state<string | undefined>();
	/** The newest message you had on screen in the pane, for counting what arrived since. */
	#seenThrough = $state<string | undefined>();
	/** Where the last scroll event, or automatic scroll to the latest item, left the list. */
	#lastScrollTop: number | undefined;
	/**
	 * Where the New divider sits in the open pane: after your read position
	 * (`ReadPositions`) as it was when the pane opened. It stays put while you
	 * read. Replaced whole, never changed in place: each visit is its own.
	 */
	#divider = $state.raw<Divider>({ pane: '', phase: 'waiting' });
	/** The divider the pane is opening at, until it has: sending or jumping to the latest (`pin`) stops it there. */
	#landing: Divider | undefined;
	/** The open pane has no messages yet: its first items with them render newest first (`ARRIVAL_ITEMS`). */
	#arriving = $state(false);
	/**
	 * The pane and the count of items last measured for filling it (`watchFill`), while they still stand: the room is
	 * another with each reaction, edit or receipt in it, which needs no measuring again. Not state, only a memo.
	 */
	#fillMeasured: string | undefined;
	/**
	 * The observer watching the pane's last row, kept while that row stays last: a reaction, an edit or a receipt
	 * makes the timeline anew, and watching the same row again would look through every row to find it.
	 */
	#latestWatch: { observer: IntersectionObserver; row: HTMLElement; pane: string | undefined } | undefined;
	/** The timeline held at its width while a side panel slides (`prepareSlide`). */
	#heldTimeline: { scroller: HTMLElement; width: number; release: () => void } | undefined;
	/** Long timelines paint newest-first; each chunk revealed above keeps the reader's place. */
	readonly reveal = new ProgressiveReveal(REVEAL_CHUNK_ITEMS, () => this.#place(), (place) => this.#keepPlace(place));
	/** While you scroll back, the day you're reading floats at the top of the timeline. */
	readonly floatingDay = new FloatingDay();
	/** The first message after your read position, unless you wrote it or older unread ones are still to load: the New divider goes above it. */
	readonly newDividerAt: string | undefined;
	/** Messages after the newest you had on screen, by `message_id`, so older ones loading above don't count. */
	readonly unseenCount: number;
	/** What `watchLatest` follows of the pane: its count of messages and its id. */
	readonly #paneCount: number;
	readonly #paneId: string | undefined;

	/** Made as the page starts, which binds the list to `messageScroll`. */
	constructor(host: TimelineViewportHost) {
		this.#host = host;
		this.#paneCount = $derived(host.messages.length);
		this.#paneId = $derived(host.paneRoom?.id);
		this.newDividerAt = $derived(this.#divider.pane === this.#paneId && this.#divider.after !== undefined
			? newDividerBefore(host.timeline, this.#divider.after, host.you, Boolean(host.paneRoom?.olderAvailable))
			: undefined);
		this.unseenCount = $derived.by(() => {
			const seen = this.#seenThrough;
			if (this.#stickToBottom || seen === undefined) return 0;
			const messages = host.messages;
			let count = 0;
			for (let index = messages.length - 1; index >= 0 && compareLogIds(messages[index].message_id, seen) > 0; index--) count++;
			return count;
		});
	}

	/** The timeline's scrolling list (`bind:this`), the same element from pane to pane. */
	get messageScroll(): HTMLDivElement | undefined {
		return this.#messageScroll;
	}

	set messageScroll(scroller: HTMLDivElement | undefined) {
		this.#messageScroll = scroller;
	}

	/** The pane follows the latest. */
	get stickToBottom(): boolean {
		return this.#stickToBottom;
	}

	/** The pane's latest row was on screen when last measured: in this pane, or until it is measured here, the last. */
	get latestVisible(): boolean {
		return this.#latestVisible;
	}

	/**
	 * You are reading the pane's latest message, as far as the list can say: it is on screen, as measured in this
	 * pane, and the pane has opened at its divider. Worked out on each read: the page keeps it in a `$derived` of its
	 * own, and one here as well would be a layer more to update as it changes.
	 */
	get readingLatest(): boolean {
		return this.#latestVisible && this.#latestVisibleIn === this.#paneId && this.#divider.pane === this.#paneId && this.#divider.phase === 'landed';
	}

	/** The pane went to another room or thread: it opens at the latest, its newest items first. */
	openPane(): void {
		this.floatingDay.hide();
		this.#stickToBottom = true;
		this.reveal.from(this.#host.timeline.length - FIRST_PAINT_ITEMS);
		this.#arriving = this.#host.messages.length === 0;
	}

	/** You sent, or started a live message: the pane follows the latest, and stops opening at its divider. */
	pin(): void {
		this.#stickToBottom = true;
		this.#landing = undefined;
	}

	/**
	 * A pane opened before its messages came: before they render (once the pane shows items, not its placeholders, as
	 * the timeline decides), only the newest of them, then as many more as fill the pane (`fillPane`). A pane that has
	 * caught up with none is left as it is.
	 */
	watchArrival(): void {
		const host = this.#host;
		$effect.pre(() => {
			if (!this.#arriving || ((host.messages.length === 0 || host.paneHeldBack) && host.paneCatchingUp)) return;
			this.#arriving = false;
			if (host.messages.length === 0) return;
			untrack(() => {
				this.reveal.from(host.timeline.length - ARRIVAL_ITEMS);
				void this.#fillPane(host.paneRoom?.id);
			});
		});
	}

	/**
	 * The New divider, placed once per visit from your read position (kept on this device, the server's cursor, or your
	 * newest message) once the pane's history has loaded, and the pane opening at it then: the one place a landing
	 * starts, so there is one per visit.
	 */
	watchDivider(): void {
		const host = this.#host;
		$effect(() => {
			const room = host.paneRoom;
			if (!room) return;
			if (this.#divider.pane !== room.id) this.#divider = { pane: room.id, phase: 'waiting' };
			else if (this.#divider.phase === 'waiting' && room.loaded) {
				untrack(() => {
					const divider: Divider = { pane: room.id, after: host.readThrough(room), phase: 'landing' };
					this.#divider = divider;
					void this.#landAtDivider(divider);
				});
			}
		});
	}

	/**
	 * Back in view: whatever arrived while the page was hidden drew no frame, so the observer of the latest (which
	 * reports after one) hasn't said whether the latest is still on screen. Unless the pane follows the latest, the
	 * latest row is measured once now, before reading it marks anything read: the page makes this before its read.
	 */
	watchReturn(): void {
		const host = this.#host;
		$effect.pre(() => {
			if (!host.visible) return;
			untrack(() => {
				const scroll = this.#messageScroll;
				const latest = scroll && !this.#stickToBottom ? lastRow(scroll) : undefined;
				if (!scroll || !latest) return;
				const at = latest.getBoundingClientRect();
				const box = scroll.getBoundingClientRect();
				this.#measured(at.bottom > box.top && at.top < box.bottom, host.paneRoom?.id);
			});
		});
	}

	/**
	 * A thread's or a room's first page may not fill the pane, leaving nothing to
	 * scroll back with: load older pages until it does or there are none. Not while
	 * some of what it has are still to render (`reveal`): they may fill it. Measuring
	 * lays the page out, so only once for each room and count of items.
	 */
	watchFill(): void {
		const host = this.#host;
		$effect(() => {
			const room = host.olderSource;
			const length = host.timeline.length;
			const scroller = this.#messageScroll;
			if (!room?.loaded || !room.olderAvailable || room.loadingOlder || !scroller || this.reveal.hidden > 0) {
				this.#fillMeasured = undefined;
				return;
			}
			const measure = `${room.id} ${length}`;
			if (measure === this.#fillMeasured) return;
			untrack(() => {
				tick().then(() => {
					// Not while the pane isn't laid out (a phone showing the rooms list): it would never fill, and load every page.
					if (!this.#shows(room.id, scroller) || !scroller.clientHeight) return;
					this.#fillMeasured = measure;
					if (scroller.scrollHeight <= scroller.clientHeight + OLDER_REPLIES_MARGIN_PX) void this.#loadOlder();
				});
			});
		});
	}

	/** Keeps the pane at the latest while pinned there, anchored at its bottom edge, and watches whether the latest shows. */
	watchLatest(): void {
		const host = this.#host;
		// At the latest as soon as the pane's items are in, before the frame paints, and again once it has laid out.
		// Not only after the frame: the list is the same element from pane to pane, kept where the last pane left it, and the
		// browser's scroll anchoring can move it on the swap (to a day divider both panes have). That scroll's event
		// comes before the frame, and against the last pane's position it would read as the reader scrolling up.
		// By the count and the room's id, not the list and the room themselves, which are new with every snapshot (each
		// room listed as the page loads, say): each time it scrolls it lays the page out, and what else changes in the
		// pane is followed below.
		$effect(() => {
			void this.#paneCount;
			void this.#paneId;
			if (!this.#stickToBottom || !this.#messageScroll) return;
			this.#scrollToLatest();
			requestAnimationFrame(() => {
				if (this.#stickToBottom) this.#scrollToLatest();
			});
		});

		// The timeline is anchored at its bottom edge, as chat apps are: when something in the pane takes more or less
		// room below it (the composer growing a line, a reply bar, staged files, the typing row), what sat just above the
		// composer stays there, pushed up rather than covered: at the latest message it stays there, and scrolled back,
		// the view moves with the edge. Before the frame paints. The window resizing (the pane's own height) is left be,
		// but not an on-screen keyboard coming up or going down (trackKeyboard), which takes room as the composer does.
		$effect(() => {
			const scroll = this.#messageScroll;
			const pane = scroll?.closest<HTMLElement>('.ap-shell-main');
			if (!scroll || !pane) return;
			const root = document.documentElement;
			let height = scroll.clientHeight;
			let paneHeight = pane.clientHeight;
			let keyboardHeight = root.style.getPropertyValue('--app-height');
			const observer = new ResizeObserver(() => {
				const next = scroll.clientHeight;
				const change = height - next;
				const paneChanged = pane.clientHeight !== paneHeight;
				const keyboardChanged = root.style.getPropertyValue('--app-height') !== keyboardHeight;
				height = next;
				paneHeight = pane.clientHeight;
				keyboardHeight = root.style.getPropertyValue('--app-height');
				if (!change || (paneChanged && !keyboardChanged)) return;
				if (this.#stickToBottom) this.#scrollToLatest();
				else scroll.scrollTop += change;
				// A message being edited stays in view over the keyboard.
				const active = document.activeElement;
				if (keyboardChanged && active instanceof HTMLElement && scroll.contains(active)) active.scrollIntoView({ block: 'nearest' });
			});
			observer.observe(scroll);
			observer.observe(pane);
			return () => observer.disconnect();
		});

		// Stay pinned to the latest item while the pane fills in: a room's history, its threads'
		// cards and descriptions land over several updates, not all of which change what the effect
		// above tracks. Follow the rendered content instead.
		$effect(() => {
			const scroll = this.#messageScroll;
			if (!scroll) return;
			let frame = 0;
			const observer = new MutationObserver(() => {
				if (!this.#stickToBottom || frame) return;
				frame = requestAnimationFrame(() => {
					frame = 0;
					if (this.#stickToBottom) this.#scrollToLatest();
				});
			});
			observer.observe(scroll, { childList: true, subtree: true, characterData: true });
			return () => {
				observer.disconnect();
				cancelAnimationFrame(frame);
			};
		});

		$effect(() => () => this.#unwatchLatest());

		$effect(() => {
			const scroll = this.#messageScroll;
			const items = host.timeline;
			const pane = host.paneRoom?.id;
			// The same row still last, in the same pane: it is watched already. Another, and the one watched says nothing more.
			if (scroll && this.#latestWatch && this.#latestWatch.row === lastRow(scroll) && this.#latestWatch.pane === pane) return;
			this.#unwatchLatest();
			if (!scroll) return;
			const frame = requestAnimationFrame(() => {
				const latest = lastRow(scroll);
				if (!items.length || !latest) {
					this.#measured(true, pane);
					return;
				}
				const observer = new IntersectionObserver((entries) => {
					// Entries queued before the row stopped being watched (another came last, or the pane went elsewhere)
					// are about a row the pane has moved on from: they say nothing of its latest now.
					if (this.#latestWatch?.observer !== observer) return;
					// An entry says where the latest was at a frame since gone: on a busy main thread several frames'
					// entries arrive together, and the pane may have been pinned again before this runs. Out of view is
					// checked against now.
					let visible = entries[entries.length - 1].isIntersecting;
					if (!visible) {
						const at = latest.getBoundingClientRect();
						const box = scroll.getBoundingClientRect();
						visible = at.bottom > box.top && at.top < box.bottom;
					}
					// Pinned, and pushed down by something laying out above it without a mutation or a scroll (an image's
					// size arriving): it follows the latest, as the pane does while it fills in, rather than offering a jump.
					if (!visible && this.#stickToBottom && !atLatest(scroll)) {
						this.#scrollToLatest();
						return;
					}
					this.#measured(visible, pane);
					if (visible) {
						const messages = host.messages;
						this.#seenThrough = messages[messages.length - 1]?.message_id;
						host.mentions.clearUnseen();
					}
				}, { root: scroll });
				observer.observe(latest);
				this.#latestWatch = { observer, row: latest, pane };
			});
			return () => cancelAnimationFrame(frame);
		});
	}

	#unwatchLatest(): void {
		this.#latestWatch?.observer.disconnect();
		this.#latestWatch = undefined;
	}

	/** The latest row was measured on screen or off it, in the pane `pane`: the one write of what `latestVisible` says. */
	#measured(visible: boolean, pane: string | undefined): void {
		this.#latestVisible = visible;
		this.#latestVisibleIn = pane;
	}

	/**
	 * Scrolls the list to the message `id`, centred, once it has rendered (all of the pane's items render for it, and it
	 * waits a while, `JUMP_WAIT_MS`, for a thread's history to load), and returns its row. A jump that `opened` the pane
	 * lets go of the latest at once, so that meanwhile the pane neither follows the latest nor opens at its divider.
	 */
	async jumpTo(id: string, opened: boolean): Promise<HTMLElement | undefined> {
		if (opened) this.#stickToBottom = false;
		this.reveal.from(0);
		await tick();
		const find = () => this.#messageScroll?.querySelector<HTMLElement>(`article[data-message-id="${CSS.escape(id)}"]`) ?? undefined;
		await until(() => Boolean(find()), JUMP_WAIT_MS);
		const scroller = this.#messageScroll;
		const row = find();
		if (!scroller || !row) return undefined;
		row.scrollIntoView({ block: 'center' });
		this.#settle(scroller);
		return row;
	}

	/**
	 * Settles whether the pane follows the latest from where a jump or a landing left `scroller`, rather than by the next
	 * scroll event: a jump to the latest, the pane already there, scrolls nothing, so no event would pin it again to
	 * follow what comes next, and until one came the pane would read as at its latest wherever it was.
	 */
	#settle(scroller: HTMLElement): void {
		this.#lastScrollTop = scroller.scrollTop;
		this.#stickToBottom = atLatest(scroller);
	}

	/**
	 * Opens the pane at its New divider, near the top with what is new below
	 * it, as long as it still shows the latest: a jump, the reader, or sending
	 * may have moved it first. A pane opened on its newest page first loads its
	 * older messages back to the divider (as a linked message's do, but only
	 * DIVIDER_PAGES of them), so the divider doesn't move up out of view as they
	 * load. Not back to it by then, it shows no divider (`newDividerBefore`)
	 * and stays at the latest. Either way the pane has landed after.
	 */
	async #landAtDivider(divider: Divider): Promise<void> {
		const host = this.#host;
		const pane = divider.pane;
		this.#landing = divider;
		const still = () => this.#landing === divider && this.#divider === divider && host.paneRoom?.id === pane && this.#stickToBottom;
		try {
			const after = divider.after;
			for (let page = 0; page < DIVIDER_PAGES && host.client && after !== undefined && still(); page++) {
				const oldest = host.paneRoom?.timeline.order[0];
				if (!host.paneRoom?.olderAvailable || oldest === undefined || compareLogIds(oldest, after) <= 0) break;
				try {
					await host.client.loadOlder(pane);
				} catch {
					break;
				}
			}
			// Still short of your read position: no divider, and the pane opens at the latest.
			const before = this.newDividerAt;
			if (before === undefined || !still()) return;
			const index = host.timeline.findIndex((item) => item.kind === 'message' && item.event.message_id === before);
			if (index >= 0 && index - LAND_CONTEXT_ITEMS < this.reveal.hidden) this.reveal.from(index - LAND_CONTEXT_ITEMS);
			await tick();
			const line = () => this.#messageScroll?.querySelector<HTMLElement>('.ap-divider-new') ?? undefined;
			await until(() => Boolean(line()) || !still(), JUMP_WAIT_MS);
			const node = line();
			const scroller = this.#messageScroll;
			if (!node || !scroller || !still()) return;
			scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - LAND_MARGIN_PX;
			// Settled here, not by the next scroll event or intersection, so nothing reads the pane as at its latest meanwhile.
			this.#settle(scroller);
			const items = scroller.querySelectorAll<HTMLElement>('[data-timeline-item]');
			const latest = items[items.length - 1]?.getBoundingClientRect();
			const visible = !latest || latest.top < scroller.getBoundingClientRect().bottom;
			this.#measured(visible, pane);
			if (!visible) this.#seenThrough = after;
		} finally {
			if (this.#landing === divider) this.#landing = undefined;
			if (this.#divider === divider) this.#divider = { ...divider, phase: 'landed' };
		}
	}

	/** The jump bar's: the pane goes to its latest and follows it, and the mentions that came meanwhile count as seen. */
	jumpToLatest(): void {
		this.pin();
		this.floatingDay.hide();
		this.#host.mentions.clearUnseen();
		this.#scrollToLatest();
	}

	#scrollToLatest(): void {
		if (!this.#messageScroll) return;
		// Not when already at the end, or past it in iOS's rubber band: pulling past the latest scrolls down, which
		// pins again, and setting the scroll top there would snap the bounce back under the finger every frame.
		const end = this.#messageScroll.scrollHeight - this.#messageScroll.clientHeight;
		if (this.#messageScroll.scrollTop < end - 1) this.#messageScroll.scrollTop = this.#messageScroll.scrollHeight;
		// Held at the end, not wherever within a pixel of it the list sits: what a slow drag moved
		// it short of the end so far still counts toward letting go (trackScroll).
		this.#lastScrollTop = end;
	}

	/** The list's scroll handler, bound to the viewport so the page can hand it to `onscroll` as it is, unwrapped. */
	readonly trackScroll = (): void => {
		const scroller = this.#messageScroll;
		if (!scroller) return;
		const pinned = this.#stickToBottom;
		const top = scroller.scrollTop;
		let scrolledUp = true;
		// While pinned, only the reader scrolling up lets go. The pane grows under us as a room's
		// history, its threads' cards and long messages lay out; our own scroll's event can land
		// after that, and scroll anchoring moves the list down, before the next frame catches up.
		// Up is measured from where the pane was last held, not from the last event: a slow drag
		// (on iOS, a third of a pixel at a time) moves less than a pixel between events, each step
		// too small to count, and pinning back after each would hold it until the drag gathered
		// speed. Held no further down than the end as it is now, so bouncing back out of iOS's
		// rubber band below the latest isn't read as scrolling up, nor is the list shrinking under it.
		if (pinned && this.#lastScrollTop !== undefined) {
			const end = scroller.scrollHeight - scroller.clientHeight;
			const held = Math.min(this.#lastScrollTop, end);
			scrolledUp = top < held - 1;
			this.#lastScrollTop = Math.min(Math.max(top, held), end);
		} else this.#lastScrollTop = top;
		if (pinned && !scrolledUp) {
			// Unless the reader has gone on up by then: a drag can move the list again before this frame.
			requestAnimationFrame(() => {
				if (this.#stickToBottom && this.#messageScroll && this.#lastScrollTop !== undefined && this.#messageScroll.scrollTop >= this.#lastScrollTop - 1) this.#scrollToLatest();
			});
			return;
		}
		const atBottom = atLatest(scroller);
		if (top < OLDER_REPLIES_MARGIN_PX) void this.#loadOlder();
		if (!atBottom && pinned) {
			const messages = this.#host.messages;
			this.#seenThrough = messages[messages.length - 1]?.message_id;
		}
		this.#stickToBottom = atBottom;
		this.floatingDay.update(scroller, atBottom);
	};

	/**
	 * A thread, or a room on its first visit, opens on its newest page; reading
	 * back near the top loads the page before it. The reader's place is kept:
	 * whatever was on screen stays put while the older messages land above it.
	 */
	async #loadOlder(): Promise<void> {
		const host = this.#host;
		const room = host.olderSource;
		if (!host.client || !room || !room.olderAvailable || room.loadingOlder) return;
		const place = this.#place();
		if (!place) return;
		try {
			await host.client.loadOlder(room.id);
		} catch {
			return; // The next scroll back tries again.
		}
		await tick();
		this.#keepPlace(place);
	}

	/**
	 * Past the oldest item drawn (the keyboard going on up): the rest of what's loaded draws first, then the page before
	 * it loads, as scrolling back would.
	 */
	async showOlder(): Promise<void> {
		if (this.reveal.hidden > 0) {
			this.reveal.from(0);
			await tick();
		} else await this.#loadOlder();
	}

	/**
	 * Renders more of the open pane's first items, newest first, until the first of them sits above the pane's top
	 * (`FILL_SLACK_PX` above) at its latest, where the pane opens: from there down it shows what it would with all of
	 * them, and nothing more is drawn before the frame paints. Each step comes before that paint (a microtask after the
	 * last update) and lays the page out once to measure; it renders as many more as the rows so far say fill the rest,
	 * up to `ARRIVAL_ITEMS` (more at once costs the rows' first updates more, in Svelte's bookkeeping, than the extra
	 * step's layout). The rest follow after the paint (`reveal`).
	 */
	async #fillPane(pane: string | undefined): Promise<void> {
		for (;;) {
			await tick();
			const scroller = this.#messageScroll;
			if (!scroller || this.#host.paneRoom?.id !== pane || this.reveal.hidden === 0) return;
			// A pane out of sight has no size to fill: its rows follow after the paint, as the rest do.
			if (!scroller.clientHeight) return;
			// The first row (past the floating day, which takes no room), where the content above it would begin.
			let first = scroller.firstElementChild;
			while (first?.classList.contains('ap-dayfloat')) first = first.nextElementSibling;
			if (!first) return;
			const box = scroller.getBoundingClientRect();
			const top = scroller.scrollTop + first.getBoundingClientRect().top - box.top;
			const short = top + FILL_SLACK_PX - (scroller.scrollHeight - scroller.clientHeight);
			if (short <= 0) return;
			// What's missing, by where the rows end (the scroll height is the pane's own while they don't fill it), in rows
			// as tall as the tallest so far: rows differ (a line, a photo), and the taller ones take longest to render, so
			// it errs toward another step rather than rows that wouldn't show.
			let bottom = top;
			let tallest = 1;
			for (let row: Element | null = first; row; row = row.nextElementSibling) {
				const rect = row.getBoundingClientRect();
				tallest = Math.max(tallest, rect.height);
				bottom = Math.max(bottom, scroller.scrollTop + rect.bottom - box.top);
			}
			const missing = top + FILL_SLACK_PX + scroller.clientHeight - bottom;
			this.reveal.more(Math.min(ARRIVAL_ITEMS, Math.ceil(Math.max(short, missing) / tallest)));
		}
	}

	/** Where the reader is in the open pane, before older items land above: `keepPlace` keeps them there after. */
	#place(): Place | undefined {
		const scroller = this.#messageScroll;
		return scroller && { pane: this.#paneId, scroller, top: scroller.scrollTop, height: scroller.scrollHeight };
	}

	/**
	 * Older items landed above: keeps what was on screen in place, from where `place` noted it, unless the pane follows
	 * the latest. Where the browser anchored the view itself this is already the position. Only in the list and the
	 * pane it was noted in: the list is the same element from pane to pane, and a page that lands after the pane went
	 * on to another room or thread would otherwise move that one.
	 */
	#keepPlace(place: Place | undefined): void {
		if (!place || !this.#shows(place.pane, place.scroller) || this.#stickToBottom) return;
		const { scroller } = place;
		scroller.scrollTop = place.top + (scroller.scrollHeight - place.height);
		this.#lastScrollTop = scroller.scrollTop;
	}

	/** The list is still `scroller`, showing the pane `pane`: what was measured or begun there still applies. */
	#shows(pane: string | undefined, scroller: HTMLElement): boolean {
		return this.#messageScroll === scroller && this.#paneId === pane;
	}

	/**
	 * While a side panel slides, the conversation's width changes every frame. The timeline takes the width it will
	 * end at from the start instead, so its messages are laid out once, not re-wrapped on every frame, and the pane
	 * clips it meanwhile, on a compositor layer of its own (only then: it would hold fixed-position children). It
	 * lets go when the grid's slide ends, which a slow first frame (that one layout) can put well after the tap.
	 * `change` is how much wider the conversation is about to be.
	 */
	prepareSlide(change: number): void {
		const scroller = this.#messageScroll;
		const pane = scroller?.closest<HTMLElement>('.ap-shell-main');
		const app = pane?.parentElement;
		if (!scroller || !pane || !app || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const from = this.#heldTimeline?.scroller === scroller ? this.#heldTimeline.width : scroller.getBoundingClientRect().width;
		this.#heldTimeline?.release();
		const width = from + change;
		scroller.style.width = `${width}px`;
		pane.style.overflow = 'clip';
		pane.style.willChange = 'transform';
		// Re-wrapped at its new width, the history is taller or shorter: still at the latest message if it was.
		if (this.#stickToBottom) requestAnimationFrame(() => { if (this.#stickToBottom) this.#scrollToLatest(); });
		const ended = (event: TransitionEvent) => { if (event.target === app && event.propertyName === 'grid-template-columns') release(); };
		// Should the slide not run (or its end be missed), letting go later changes nothing: the width is the final one.
		const fallback = setTimeout(() => release(), SLIDE_MS * 4 + 1000);
		const release = () => {
			app.removeEventListener('transitionend', ended);
			clearTimeout(fallback);
			if (this.#heldTimeline?.release !== release) return;
			this.#heldTimeline = undefined;
			scroller.style.width = '';
			pane.style.overflow = '';
			pane.style.willChange = '';
		};
		app.addEventListener('transitionend', ended);
		this.#heldTimeline = { scroller, width, release };
	}

	dispose(): void {
		this.reveal.stop();
		this.floatingDay.dispose();
		this.#heldTimeline?.release();
	}
}
