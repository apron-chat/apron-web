// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomListing } from '$lib/protocol/client';
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

	it('offers no Leave on a thread open without joining', () => {
		render({ threads: [joined('deploy', 'Deploy'), { ...joined('peek', 'Peek'), joined: false }], activeThread: 'peek' });
		expect(one('button[data-thread="peek"]')!.getAttribute('aria-current')).toBe('page');
		expect(one('[data-leave="peek"]')).toBeNull();
		expect(one('[data-leave="deploy"]')).not.toBeNull();
	});
});
