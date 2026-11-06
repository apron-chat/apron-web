// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import { messageRecord, roomSnapshot } from '$lib/test/builders';
import { atLatest, TimelineViewport } from './timeline-viewport.svelte';
import type { TimelineItem } from './timeline';

/** A row in a `List`, `y` from the list's top: on screen where the list is scrolled to. */
class Row {
	constructor(readonly list: List, public y: number) {}

	getBoundingClientRect(): DOMRect {
		return { top: this.y - this.list.scrollTop, bottom: this.y - this.list.scrollTop + 40 } as DOMRect;
	}

	/** Centred, as a jump scrolls a message into view. */
	scrollIntoView(): void {
		this.list.scrollTop = this.y - this.list.clientHeight / 2;
	}
}

/** A list as the browser scrolls one: its scroll top held between its top and its end, and each set counted. */
class List {
	sets = 0;
	#top = 0;
	/** The rows `querySelector` finds, by selector. */
	readonly rows = new Map<string, Row>();
	constructor(public scrollHeight: number, public clientHeight: number, top = 0) {
		this.#top = top;
	}

	get scrollTop(): number {
		return this.#top;
	}

	set scrollTop(top: number) {
		this.sets++;
		this.#top = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight));
	}

	getBoundingClientRect(): DOMRect {
		return { top: 0, bottom: this.clientHeight } as DOMRect;
	}

	querySelector(selector: string): Row | null {
		return this.rows.get(selector) ?? null;
	}

	querySelectorAll(): never[] {
		return [];
	}
}

const asList = (list: List) => list as unknown as HTMLDivElement;

/** Each message as the timeline shows it. */
const itemsOf = (messages: MessageRecord[]): TimelineItem[] => messages.map((event) => ({ kind: 'message', key: event.message_id, event, grouped: false }));

const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => messageRecord(from + index));

/** A viewport over the pane `room`, with `messages`, as the page makes one. */
function setup(room: RoomSnapshot, messages: MessageRecord[] = []) {
	const state = $state({ room, messages });
	const loadOlder = vi.fn(async (_roomId: string) => {});
	const readThrough = vi.fn((_room: RoomSnapshot): string | undefined => undefined);
	const viewport = new TimelineViewport({
		client: { loadOlder },
		get paneRoom() { return state.room; },
		get olderSource() { return state.room; },
		get timeline() { return itemsOf(state.messages); },
		get messages() { return state.messages; },
		you: undefined,
		paneHeldBack: false,
		paneCatchingUp: false,
		visible: true,
		mentions: { clearUnseen: () => undefined },
		readThrough
	});
	return { state, viewport, loadOlder, readThrough };
}

/** Lets whatever is under way settle: awaited loads, ticks and the like. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	vi.stubGlobal('requestAnimationFrame', () => 0);
	vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('atLatest', () => {
	it('counts the list at the latest within 96px of its end', () => {
		expect(atLatest(asList(new List(1000, 400, 600)))).toBe(true);
		expect(atLatest(asList(new List(1000, 400, 505)))).toBe(true);
		expect(atLatest(asList(new List(1000, 400, 504)))).toBe(false);
	});
});

describe('TimelineViewport', () => {
	it('keeps the reader’s place as an older page lands above, unless the pane went elsewhere meanwhile', async () => {
		const general = roomSnapshot('general', [messageRecord(10)], { olderAvailable: true });
		const { state, viewport, loadOlder } = setup(general);
		const list = new List(1000, 400, 100);
		viewport.messageScroll = asList(list);
		viewport.stickToBottom = false;
		loadOlder.mockImplementationOnce(async () => {
			list.scrollHeight = 1600;
		});
		await viewport.loadOlderReplies();
		expect(list.scrollTop).toBe(700);

		// Another room opened while the page was on its way: its place isn't the one kept.
		list.scrollTop = 100;
		loadOlder.mockImplementationOnce(async () => {
			list.scrollHeight = 2200;
			state.room = roomSnapshot('random');
		});
		await viewport.loadOlderReplies();
		expect(list.scrollTop).toBe(100);
	});

	it('keeps no place while it follows the latest, nor in a list it no longer shows', async () => {
		const { viewport, loadOlder } = setup(roomSnapshot('general', [messageRecord(10)], { olderAvailable: true }));
		const list = new List(1000, 400, 100);
		viewport.messageScroll = asList(list);
		loadOlder.mockImplementationOnce(async () => {
			list.scrollHeight = 1600;
		});
		await viewport.loadOlderReplies();
		expect(list.scrollTop).toBe(100);

		viewport.stickToBottom = false;
		loadOlder.mockImplementationOnce(async () => {
			list.scrollHeight = 2200;
			viewport.messageScroll = asList(new List(1000, 400, 100));
		});
		await viewport.loadOlderReplies();
		expect(list.scrollTop).toBe(100);
	});

	it('scrolls to the latest only when short of it, so a bounce past the end is left be', () => {
		const { viewport } = setup(roomSnapshot('general'));
		const list = new List(1000, 400, 599.5);
		viewport.messageScroll = asList(list);
		viewport.jumpToLatest();
		expect(list.sets).toBe(0);
		list.scrollTop = 300;
		viewport.jumpToLatest();
		expect(list.scrollTop).toBe(600);
	});

	it('lets go of the latest only when the reader scrolls up, and counts what arrives after', () => {
		const { state, viewport } = setup(roomSnapshot('general'), [messageRecord(1), messageRecord(2)]);
		const list = new List(1000, 400, 600);
		viewport.messageScroll = asList(list);
		viewport.jumpToLatest();
		// Less than a pixel up, as a slow drag moves: still at the latest.
		list.scrollTop = 599.5;
		viewport.trackScroll();
		expect(viewport.stickToBottom).toBe(true);
		list.scrollTop = 500;
		viewport.trackScroll();
		expect(viewport.stickToBottom).toBe(false);
		expect(viewport.unseenCount).toBe(0);
		state.messages = [...state.messages, messageRecord(3), messageRecord(4)];
		flushSync();
		expect(viewport.unseenCount).toBe(2);
	});

	it('places the New divider once per visit, from your read position as the pane loaded, and lands there', async () => {
		const { state, viewport, readThrough } = setup(roomSnapshot('general', [], { loaded: false }), ids(1, 9));
		const list = new List(2000, 400, 1600);
		list.rows.set('.ap-divider-new', new Row(list, 1000));
		viewport.messageScroll = asList(list);
		const stop = $effect.root(() => viewport.watchDivider());
		flushSync();
		// Not before the pane's history has loaded: the read position is placed against it.
		expect(viewport.newDividerAt).toBeUndefined();
		readThrough.mockReturnValue('5');
		state.room = roomSnapshot('general');
		flushSync();
		expect(viewport.newDividerAt).toBe('6');
		await vi.waitFor(() => expect(viewport.readingLatest).toBe(true));
		// Opened with the divider near the top, clear of the floating day, and no longer following the latest.
		expect(list.scrollTop).toBe(952);
		expect(viewport.stickToBottom).toBe(false);

		// Reading on moves your read position, not the divider, and the pane doesn't land again.
		readThrough.mockReturnValue('9');
		list.scrollTop = 1600;
		const sets = list.sets;
		state.room = roomSnapshot('general');
		flushSync();
		await settle();
		expect(viewport.newDividerAt).toBe('6');
		expect(readThrough).toHaveBeenCalledTimes(1);
		expect(list.sets).toBe(sets);

		// Another room is another visit, and nothing measured or landed in this one counts there.
		state.room = roomSnapshot('random', [], { loaded: false });
		flushSync();
		expect(viewport.newDividerAt).toBeUndefined();
		expect(viewport.readingLatest).toBe(false);
		stop();
	});

	it('loads back to the divider a few pages at most, once per visit, and stops once you send or jump to the latest', async () => {
		const room = roomSnapshot('general', [messageRecord(10)], { olderAvailable: true });
		const { state, viewport, loadOlder, readThrough } = setup(room);
		readThrough.mockReturnValue('5');
		// Each page loaded is a new snapshot of the same room: the pane is still on the same visit.
		loadOlder.mockImplementation(async () => {
			state.room = { ...state.room };
		});
		const stop = $effect.root(() => viewport.watchDivider());
		flushSync();
		await vi.waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(3));
		await settle();
		expect(loadOlder).toHaveBeenCalledTimes(3);
		stop();

		const pinned = setup(room);
		pinned.readThrough.mockReturnValue('5');
		let loaded!: () => void;
		pinned.loadOlder.mockImplementation(() => new Promise<void>((resolve) => (loaded = resolve)));
		const stopPinned = $effect.root(() => pinned.viewport.watchDivider());
		flushSync();
		expect(pinned.loadOlder).toHaveBeenCalledTimes(1);
		pinned.viewport.pin();
		loaded();
		await settle();
		expect(pinned.loadOlder).toHaveBeenCalledTimes(1);
		stopPinned();
	});

	it('takes no word on the latest from an observer of a row it no longer watches', () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run));
		const reports: IntersectionObserverCallback[] = [];
		vi.stubGlobal('IntersectionObserver', class {
			constructor(report: IntersectionObserverCallback) {
				reports.push(report);
			}

			observe(): void {}
			disconnect(): void {}
		});
		const paint = () => {
			for (const run of frames.splice(0)) run(0);
		};
		const report = (index: number, isIntersecting: boolean) => reports[index]([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
		/** A row of its own comes last in `list`. */
		const rowIn = (list: HTMLElement) => {
			const item = document.createElement('div');
			item.setAttribute('data-timeline-item', '');
			list.replaceChildren(item);
		};

		const { state, viewport } = setup(roomSnapshot('general'), [messageRecord(1)]);
		const list = document.createElement('div');
		rowIn(list);
		viewport.messageScroll = list as HTMLDivElement;
		const stop = $effect.root(() => viewport.watchLatest());
		flushSync();
		paint();
		expect(reports).toHaveLength(1);

		// Another room's row comes last; what the first observer had queued about the last one arrives after.
		state.room = roomSnapshot('random');
		state.messages = [messageRecord(2, 'random')];
		rowIn(list);
		flushSync();
		report(0, false);
		expect(viewport.latestVisible).toBe(true);

		// The row watched now says so.
		paint();
		expect(reports).toHaveLength(2);
		report(1, false);
		expect(viewport.latestVisible).toBe(false);
		stop();
	});
});
