import { loadRoomOrder, saveRoomOrder } from './storage';

/** Past this many kept places, the rooms no longer listed are let go. */
const KEPT_MAX = 300;

/**
 * `rooms` in `order`: those it places by their place, then the rest in the order given (rooms it hasn't seen yet go
 * last, so nothing you arranged moves).
 */
export function inOrder<T extends { id: string }>(rooms: readonly T[], order: readonly string[]): T[] {
	const place = new Map(order.map((id, index) => [id, index]));
	const placed = rooms.filter((room) => place.has(room.id)).sort((a, b) => place.get(a.id)! - place.get(b.id)!);
	return [...placed, ...rooms.filter((room) => !place.has(room.id))];
}

/** `order` with `id` moved to just before or after `target` (which stays put); unchanged if either isn't in it. */
export function moveNext(order: readonly string[], id: string, target: string, side: 'before' | 'after'): string[] {
	if (id === target || !order.includes(id) || !order.includes(target)) return [...order];
	const rest = order.filter((other) => other !== id);
	const at = rest.indexOf(target) + (side === 'after' ? 1 : 0);
	return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * The order of the sidebar's top-level rooms, kept on this device per account (`notifyAccount`), so it doesn't change
 * with the order a server happens to send them in. A room is placed the first time it's listed, after the others;
 * dragging one (or Alt+↑/↓) moves it. Rooms and Private share the one order,
 * each section listing its own rooms in it.
 */
export class RoomOrder {
	order = $state<string[]>([]);
	private account: string | undefined;

	/** Takes `account`'s kept order; without one, the order lasts for this page only. */
	load(account: string | undefined): void {
		this.account = account;
		this.order = account === undefined ? [] : loadRoomOrder(account);
	}

	sort<T extends { id: string }>(rooms: readonly T[]): T[] {
		return inOrder(rooms, this.order);
	}

	/** Places the `listed` rooms it hasn't placed yet, after the others. */
	adopt(listed: readonly string[]): void {
		const known = new Set(this.order);
		const added = listed.filter((id) => !known.has(id));
		if (added.length === 0) return;
		let next = [...this.order, ...added];
		if (next.length > KEPT_MAX) {
			const shown = new Set(listed);
			next = next.filter((id) => shown.has(id));
		}
		this.keep(next);
	}

	/** Moves `id` to just before or after `target`. */
	move(id: string, target: string, side: 'before' | 'after'): void {
		const next = moveNext(this.order, id, target, side);
		if (next.some((other, index) => other !== this.order[index])) this.keep(next);
	}

	/**
	 * Moves `id` one place up or down among `shown`, the rooms listed with it in its order: past the next one shown, so
	 * rooms a folded section hides keep their places. Whether it moved.
	 */
	step(id: string, shown: readonly string[], by: -1 | 1): boolean {
		const at = shown.indexOf(id);
		const target = shown[at + by];
		if (at < 0 || target === undefined) return false;
		this.move(id, target, by < 0 ? 'before' : 'after');
		return true;
	}

	private keep(order: string[]): void {
		this.order = order;
		if (this.account !== undefined) saveRoomOrder(this.account, order);
	}
}
