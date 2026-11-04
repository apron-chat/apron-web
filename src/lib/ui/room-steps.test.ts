// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { nextRoomRow } from './room-steps';

afterEach(() => (document.body.innerHTML = ''));

/** A rooms list, its rows by id: `*` the open one, `!` with news, `join:` a room listed to join, `other:` a thread listed to read. */
function list(...rows: string[]): HTMLElement {
	const aside = document.createElement('aside');
	aside.innerHTML = rows.map((row) => {
		const id = row.replace(/[*!]/g, '').replace(/^(join|other):/, '');
		const where = row.startsWith('join:') ? `data-join="${id}"` : row.startsWith('other:') ? `data-other-thread="${id}"` : id.startsWith('t-') ? `data-thread="${id}"` : `data-room="${id}"`;
		return `<button class="ap-room${row.includes('!') ? ' ap-room-unread' : ''}" ${where}${row.includes('*') ? ' aria-current="page"' : ''}>${id}</button>`;
	}).join('');
	document.body.append(aside);
	return aside;
}
const id = (row: HTMLElement | undefined) => row?.textContent;

describe('nextRoomRow', () => {
	it('steps to the row after or before the open one, threads among them, stopping at the ends', () => {
		const rooms = list('general', 'eng*', 't-plan', 'random');
		expect(id(nextRoomRow(rooms, 1))).toBe('t-plan');
		expect(id(nextRoomRow(rooms, -1))).toBe('general');
		expect(nextRoomRow(list('only*'), 1)).toBeUndefined();
		expect(nextRoomRow(list('a*', 'b'), -1)).toBeUndefined();
	});

	it('steps into threads listed to read without joining, as a guest on a server whose threads are all of those', () => {
		const rooms = list('general*', 'other:t-roundup', 'other:t-security', 'join:chefs');
		expect(id(nextRoomRow(rooms, 1))).toBe('t-roundup');
		expect(id(nextRoomRow(list('general', 'other:t-roundup*', 'other:t-security'), 1))).toBe('t-security');
	});

	it('passes over rooms listed to join, but steps from the open one even when it is one of them', () => {
		expect(id(nextRoomRow(list('general*', 'join:lobby', 'random'), 1))).toBe('random');
		const reading = list('general', 'join:lobby*', 'random');
		expect(id(nextRoomRow(reading, 1))).toBe('random');
		expect(id(nextRoomRow(reading, -1))).toBe('general');
	});

	it('with no row open, starts at the first or the last', () => {
		const rooms = list('general', 'random');
		expect(id(nextRoomRow(rooms, 1))).toBe('general');
		expect(id(nextRoomRow(rooms, -1))).toBe('random');
	});

	it('with `unread`, finds the nearest with news that way, going round the end, never the open one', () => {
		const rooms = list('a!', 'b', 'c*', 'd', 'e!');
		expect(id(nextRoomRow(rooms, 1, true))).toBe('e');
		expect(id(nextRoomRow(rooms, -1, true))).toBe('a');
		expect(id(nextRoomRow(list('a', 'b*', 'c!'), -1, true))).toBe('c');
		expect(nextRoomRow(list('a', 'b*!', 'c'), 1, true)).toBeUndefined();
		expect(id(nextRoomRow(list('a', 'b!'), 1, true))).toBe('b');
	});
});
