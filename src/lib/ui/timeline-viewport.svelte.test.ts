import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomSnapshot } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import { messageRecord, roomSnapshot } from '$lib/test/builders';
import { atLatest, TimelineViewport, type TimelineViewportHost } from './timeline-viewport.svelte';

/** A list as the browser scrolls one: its scroll top held between its top and its end, and each set counted. */
class List {
	sets = 0;
	#top = 0;
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

	querySelectorAll(): never[] {
		return [];
	}
}

const asList = (list: List) => list as unknown as HTMLDivElement;

/** A viewport over the pane `room`, with `messages`, as the page makes one. */
function setup(room: RoomSnapshot, messages: MessageRecord[] = []) {
	const state = $state({ room, messages });
	const loadOlder = vi.fn(async (_roomId: string) => {});
	const readThrough = vi.fn((_room: RoomSnapshot): string | undefined => undefined);
	const viewport = new TimelineViewport({
		client: { loadOlder },
		get paneRoom() { return state.room; },
		get olderSource() { return state.room; },
		timeline: [],
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
		const { state, viewport, readThrough } = setup(roomSnapshot('general', [], { loaded: false }));
		const stop = $effect.root(() => viewport.watchDivider());
		flushSync();
		expect(viewport.newDivider).toEqual({ room: 'general', fixed: false, landed: false });
		readThrough.mockReturnValue('5');
		state.room = roomSnapshot('general');
		flushSync();
		expect(viewport.newDivider).toMatchObject({ room: 'general', after: '5', fixed: true });
		await vi.waitFor(() => expect(viewport.newDivider.landed).toBe(true));
		// Reading on moves your read position, not the divider.
		readThrough.mockReturnValue('9');
		state.room = roomSnapshot('general');
		flushSync();
		expect(viewport.newDivider).toMatchObject({ after: '5', landed: true });
		expect(readThrough).toHaveBeenCalledTimes(1);
		state.room = roomSnapshot('random', [], { loaded: false });
		flushSync();
		expect(viewport.newDivider).toEqual({ room: 'random', fixed: false, landed: false });
		stop();
	});

	it('loads back to the divider a few pages at most, and stops once you send or jump to the latest', async () => {
		const room = roomSnapshot('general', [messageRecord(10)], { olderAvailable: true });
		const { viewport, loadOlder, readThrough } = setup(room);
		readThrough.mockReturnValue('5');
		const stop = $effect.root(() => viewport.watchDivider());
		flushSync();
		await vi.waitFor(() => expect(viewport.newDivider.landed).toBe(true));
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
		await vi.waitFor(() => expect(pinned.viewport.newDivider.landed).toBe(true));
		expect(pinned.loadOlder).toHaveBeenCalledTimes(1);
		stopPinned();
	});
});
