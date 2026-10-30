import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inOrder, moveNext, RoomOrder } from './room-order.svelte';
import { loadRoomOrder, saveRoomOrder } from './storage';
import { memoryStorage } from '$lib/test/storage';

const values = new Map<string, string>();
beforeEach(() => vi.stubGlobal('localStorage', memoryStorage(values)));
afterEach(() => {
	values.clear();
	vi.unstubAllGlobals();
});

const rooms = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((room) => room.id);

describe('inOrder', () => {
	it('lists the rooms it places by their place, then the rest as given', () => {
		expect(ids(inOrder(rooms('c', 'new', 'a', 'b', 'other'), ['a', 'b', 'gone', 'c']))).toEqual(['a', 'b', 'c', 'new', 'other']);
		expect(ids(inOrder(rooms('b', 'a'), []))).toEqual(['b', 'a']);
	});
});

describe('moveNext', () => {
	it('moves a room to just before or after another, which stays put', () => {
		expect(moveNext(['a', 'b', 'c', 'd'], 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
		expect(moveNext(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
		expect(moveNext(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
		// Onto itself, or with a room it doesn't have: unchanged.
		expect(moveNext(['a', 'b'], 'a', 'a', 'after')).toEqual(['a', 'b']);
		expect(moveNext(['a', 'b'], 'x', 'a', 'before')).toEqual(['a', 'b']);
	});
});

describe('RoomOrder', () => {
	it('places each room the first time it’s listed, after the others, and keeps the order for the account', () => {
		const order = new RoomOrder();
		order.load('ada');
		order.adopt(['b', 'a']);
		order.adopt(['a', 'c', 'b']);
		expect(order.order).toEqual(['b', 'a', 'c']);
		expect(loadRoomOrder('ada')).toEqual(['b', 'a', 'c']);
		expect(loadRoomOrder('bob')).toEqual([]);
		// A new page takes it up.
		const again = new RoomOrder();
		again.load('ada');
		expect(ids(again.sort(rooms('c', 'a', 'b')))).toEqual(['b', 'a', 'c']);
	});

	it('moves a room by a drop, or a step past the next one shown, which skips the ones a folded section hides', () => {
		saveRoomOrder('ada', ['a', 'b', 'c', 'd']);
		const order = new RoomOrder();
		order.load('ada');
		order.move('d', 'a', 'before');
		expect(order.order).toEqual(['d', 'a', 'b', 'c']);
		// Shown: d, c (a and b hidden). c up goes before d; d down goes after c.
		expect(order.step('c', ['d', 'c'], -1)).toBe(true);
		expect(order.order).toEqual(['c', 'd', 'a', 'b']);
		expect(order.step('d', ['c', 'd'], 1)).toBe(false);
		expect(order.step('c', ['c', 'd'], -1)).toBe(false);
		expect(order.step('c', ['c', 'd'], 1)).toBe(true);
		expect(order.order).toEqual(['d', 'c', 'a', 'b']);
		expect(loadRoomOrder('ada')).toEqual(['d', 'c', 'a', 'b']);
	});

	it('keeps nothing without an account, and lets go of rooms no longer listed once it holds too many', () => {
		const order = new RoomOrder();
		order.load(undefined);
		order.adopt(['a']);
		expect(order.order).toEqual(['a']);
		expect(values.size).toBe(0);
		order.load('ada');
		order.adopt(Array.from({ length: 300 }, (_, i) => `old${i}`));
		order.adopt(['old5', 'new']);
		expect(order.order).toEqual(['old5', 'new']);
	});
});
