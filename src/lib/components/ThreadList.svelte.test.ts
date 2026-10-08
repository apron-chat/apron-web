// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomListing } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';
import type { ThreadEntry } from '$lib/ui/timeline';
import ThreadList from './ThreadList.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	localStorage.clear();
});

const joined = (id: string, title: string): ThreadEntry => ({ id, parentRoomId: 'general', title, loaded: false, participants: [], lastReply: '', joined: true });
const listed = (id: string, title: string): RoomListing => ({ id, title, parentRoomId: 'general', record: { room_id: id, title, parent_room_id: 'general' }, members: [], joined: false } as RoomListing);

function render(props: Record<string, unknown> = {}) {
	const handlers = { onthread: vi.fn(), onopen: vi.fn(), onjoin: vi.fn(), onleave: vi.fn() };
	instance = mount(ThreadList, {
		target: document.body,
		props: {
			roomId: 'general', roomTitle: 'General',
			threads: [joined('deploy', 'Deploy'), joined('cert', 'Expired cert')],
			others: [listed('offsite', 'Offsite'), listed('logo', 'Logo')],
			mentions: {}, unread: {}, canJoin: true,
			...handlers, ...props
		}
	});
	flushSync();
	return handlers;
}

const one = <T extends Element = HTMLButtonElement>(selector: string) => document.querySelector<T>(selector);
const titles = (selector: string) => [...document.querySelectorAll(selector)].map((row) => row.querySelector('.ap-room-name')?.textContent);

describe('ThreadList', () => {
	it('shows a thread’s summary and its latest message under its title, each marked by an icon', () => {
		const latest = { message_id: 'm1', room_id: 'deploy', from: { user_id: 'grace', name: 'Grace' }, body: { text: 'Flags are\nflipped' } } as unknown as MessageRecord;
		render({ threads: [
			{ ...joined('deploy', 'Deploy'), description: 'What to check:\n**flags**, rollback', latestMessage: latest },
			{ ...joined('cert', 'Expired cert'), latestMessage: latest },
			{ ...joined('roadmap', 'Roadmap'), description: 'Ship threads, then search' }
		] });
		const lines = (id: string) => [...one(`button[data-thread="${id}"]`)!.querySelectorAll('.ap-room-line')]
			.map((line) => [line.querySelector('svg')?.getAttribute('aria-label'), line.textContent]);
		expect(lines('deploy')).toEqual([['Summary', 'What to check: flags, rollback'], ['Latest message', 'Grace Flags are flipped']]);
		expect(lines('cert')).toEqual([['Latest message', 'Grace Flags are flipped']]);
		expect(lines('roadmap')).toEqual([['Summary', 'Ship threads, then search']]);
		expect(one('button[data-thread="cert"] .ap-room-sender')?.textContent).toBe('Grace');
	});

	it('lists joined threads, each with Leave, then the others under a heading that folds, each with Join', () => {
		const { onthread, onleave, onopen, onjoin } = render();
		expect(titles('button[data-thread]')).toEqual(['Deploy', 'Expired cert']);
		expect(titles('button[data-other-thread]')).toEqual(['Offsite', 'Logo']);
		const heading = one('[data-testid="other-threads"]')!;
		expect(heading.textContent).toContain('Other threads');
		expect(heading.textContent).toContain('2');
		expect(heading.getAttribute('aria-expanded')).toBe('true');

		one('button[data-thread="deploy"]')!.click();
		expect(onthread).toHaveBeenCalledWith('deploy');
		one('button[data-leave="cert"]')!.click();
		expect(onleave).toHaveBeenCalledWith('cert');
		// Picking one you haven't joined reads it; Join is its own button.
		one('button[data-other-thread="offsite"]')!.click();
		expect(onopen).toHaveBeenCalledWith('offsite');
		expect(onjoin).not.toHaveBeenCalled();
		one('button[data-join="logo"]')!.click();
		expect(onjoin).toHaveBeenCalledWith('logo');
	});

	it('shows each other thread’s summary and when it was last active, with Join as a door in', () => {
		const offsite = { ...listed('offsite', 'Offsite'), latestLogId: String(Date.now() - 2 * 60 * 60 * 1000), record: { room_id: 'offsite', title: 'Offsite', parent_room_id: 'general', description: 'Dates, *venue*,\nand travel' } } as RoomListing;
		render({ others: [offsite, listed('logo', 'Logo')] });
		const row = (id: string) => one(`button[data-other-thread="${id}"]`)!;
		expect(row('offsite').querySelector('[data-testid="other-thread-summary"]')?.textContent).toBe('Dates, venue, and travel');
		expect(row('offsite').querySelector('[data-testid="other-thread-summary"] svg')?.getAttribute('aria-label')).toBe('Summary');
		expect(row('offsite').querySelector('[data-testid="other-thread-ago"]')?.textContent).toBe('2h');
		expect(row('offsite').querySelector('time')?.getAttribute('datetime')).toBe(new Date(Number(offsite.latestLogId)).toISOString());
		// Nothing listed, nothing shown.
		expect(row('logo').querySelector('.ap-room-line, [data-testid="other-thread-ago"]')).toBeNull();
		const join = one('button[data-join="offsite"]')!;
		expect(join.getAttribute('aria-label')).toBe('Join Offsite');
		expect(join.title).toBe('Join thread');
		expect(join.querySelector('svg')).not.toBeNull();
	});

	it('keeps the last-active times current, a minute at a time', () => {
		vi.useFakeTimers();
		try {
			const offsite = { ...listed('offsite', 'Offsite'), latestLogId: String(Date.now() - 4 * 60 * 1000) } as RoomListing;
			render({ others: [offsite] });
			const ago = () => one('[data-testid="other-thread-ago"]')?.textContent;
			expect(ago()).toBe('4m');
			vi.advanceTimersByTime(60_000);
			flushSync();
			expect(ago()).toBe('5m');
		} finally {
			vi.useRealTimers();
		}
	});

	it('shows the three most active others, and the rest on "N more…"', () => {
		render({ others: ['a', 'b', 'c', 'd', 'e'].map((id) => listed(id, id.toUpperCase())) });
		expect(titles('button[data-other-thread]')).toEqual(['A', 'B', 'C']);
		const more = one('[data-testid="more-threads"]')!;
		expect(more.textContent).toBe('2 more…');
		more.click();
		flushSync();
		expect(titles('button[data-other-thread]')).toEqual(['A', 'B', 'C', 'D', 'E']);
		expect(one('[data-testid="more-threads"]')).toBeNull();
	});

	it('stays folded once folded, also the next time', () => {
		render();
		one('[data-testid="other-threads"]')!.click();
		flushSync();
		expect(one('[data-testid="other-threads"]')!.getAttribute('aria-expanded')).toBe('false');
		expect(one('button[data-other-thread]')).toBeNull();
		unmount(instance!);
		render();
		expect(one('[data-testid="other-threads"]')!.getAttribute('aria-expanded')).toBe('false');
		expect(one('button[data-other-thread]')).toBeNull();
	});

	it('offers no Join or Leave where you only read, and no heading with nothing else to list', () => {
		render({ canJoin: false, others: [] });
		expect(titles('button[data-thread]')).toEqual(['Deploy', 'Expired cert']);
		expect(one('[data-leave]')).toBeNull();
		expect(one('[data-testid="other-threads"]')).toBeNull();
		unmount(instance!);
		render({ canJoin: false });
		expect(titles('button[data-other-thread]')).toEqual(['Offsite', 'Logo']);
		expect(one('[data-join]')).toBeNull();
	});

	it('keeps a thread open without joining among the others, picked out, with Join and no Leave', () => {
		const { onthread, onopen } = render({ threads: [joined('deploy', 'Deploy'), { ...joined('logo', 'Logo'), joined: false, loaded: true, count: 3 }], activeThread: 'logo' });
		expect(titles('.joined button[data-thread]')).toEqual(['Deploy']);
		expect(titles('button[data-other-thread]')).toEqual(['Offsite', 'Logo']);
		const row = one('button[data-other-thread="logo"]')!;
		expect(row.dataset.thread).toBe('logo');
		expect(row.getAttribute('aria-current')).toBe('page');
		expect(one('[data-leave="logo"]')).toBeNull();
		expect(one('[data-join="logo"]')).not.toBeNull();
		// Its history is loaded while it's read, so its count shows; the others have none.
		expect(row.querySelector('small')?.textContent).toBe('3');
		expect(one('button[data-other-thread="offsite"] small')).toBeNull();
		expect(one('button[data-other-thread="offsite"]')!.dataset.thread).toBeUndefined();
		row.click();
		expect(onthread).toHaveBeenCalledWith('logo');
		expect(onopen).not.toHaveBeenCalled();
	});

	it('shows the open one past the first few, while folded, and when the listing left it out', () => {
		const others = ['a', 'b', 'c', 'd', 'e'].map((id) => listed(id, id.toUpperCase()));
		render({ others, threads: [{ ...joined('e', 'E'), joined: false }], activeThread: 'e' });
		expect(titles('button[data-other-thread]')).toEqual(['A', 'B', 'C', 'E']);
		expect(one('[data-testid="more-threads"]')!.textContent).toBe('1 more…');
		one('[data-testid="other-threads"]')!.click();
		flushSync();
		expect(titles('button[data-other-thread]')).toEqual(['E']);
		expect(one('[data-testid="more-threads"]')).toBeNull();
		unmount(instance!);
		localStorage.clear();
		render({ others: [listed('offsite', 'Offsite')], threads: [{ ...joined('linked', 'Linked'), joined: false }], activeThread: 'linked' });
		expect(titles('button[data-other-thread]')).toEqual(['Linked', 'Offsite']);
		expect(one('[data-testid="other-threads"]')!.textContent).toContain('2');
	});
});
