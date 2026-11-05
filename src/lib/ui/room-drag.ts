import { tick } from 'svelte';

/**
 * Dragging a room to another place in its section's list (`Sidebar`'s `reorderable`): by its row, with a mouse once it
 * has moved `slopPx` with its button down, or held still on a touch screen for `holdMs`, when it lifts; a touch that
 * moves first scrolls, and a shorter one picks it. The room's copy follows the pointer up and down its section's
 * column, over the part of it in view, and the others make way for it; it lands where it's seen as it's let go.
 *
 * The list is the sidebar's: each child a room's block (its row, a `button[data-room]`, with its threads after it, in
 * `.ap-threads`), in a sidebar that scrolls (`.ap-shell-sidebody`). Its owner keeps the order: `onlift` folds every
 * room's threads away, `onmove` lists the rooms as the carried one would land, and `ondrop` puts it there.
 */

/** The carried room's copy, while one is carried (the browser tests find it by this). */
export const CARRIED_ID = 'ap-room-carried';
/** A room's row, which a press lifts it by: its threads, its + and its … keep their presses. */
const ROW = 'button[data-room]';
/**
 * How far a finger moves before its hold is up for the touch to be a scroll: past a still finger's drift, and short of
 * where a browser starts scrolling (Android's 8dp).
 */
const TOUCH_SLOP = 6;
/** How near the sidebar's top or bottom the pointer brings more of the section into view, at most. */
const EDGE = 30;

export interface DragRoomsOptions {
	/** How long a finger is held still on a row before its room lifts. */
	holdMs: number;
	/** How far the mouse moves with its button down before a room lifts: further than a click drifts. */
	slopPx: number;
	/** How long a room let go takes to slide into its place, and the gap above the list to close; 0 for none. */
	settleMs: number;
	/** A room lifted: every room's threads fold away until it's dropped. */
	onlift: (id: string) => void;
	/** The section's rooms (their ids) as the carried one would land, each time that changes. */
	onmove: (ids: string[]) => void;
	/** Let go, with the rooms as it landed; none for a drag that ended without a drop (or a list that went away). */
	ondrop: (id: string, ids: string[] | undefined) => void;
}

/** One of the other rooms in the carried one's section, by its middle on the page. */
export interface Slot {
	id: string;
	middle: number;
}

/**
 * Where the carried room lands among `others` (the section's other rooms in order), from `from` (its place among them
 * as they're laid out) with its copy between `top` and `bottom`: past each one above whose middle its top has gone up
 * past, and each one below whose middle its bottom has gone down past. Half a row either way, then, and never back and
 * forth between two rows of different heights.
 */
export function landing(others: readonly Slot[], from: number, top: number, bottom: number): number {
	let at = 0;
	others.forEach((other, index) => {
		if (index < from ? top >= other.middle : bottom > other.middle) at++;
	});
	return at;
}

type Pressed = { row: HTMLElement; block: HTMLElement };
type Listener = [type: string, listener: (event: never) => void, options?: AddEventListenerOptions];

function listen(listeners: Listener[]): () => void {
	for (const [type, listener, options] of listeners) addEventListener(type, listener as EventListener, options);
	return () => {
		for (const [type, listener, options] of listeners) removeEventListener(type, listener as EventListener, options);
	};
}

/** Drops the click the browser may send after a release (it comes in the same turn): letting a room go isn't a pick. */
function swallowClick(): void {
	const swallow = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
	};
	addEventListener('click', swallow, { capture: true, once: true });
	setTimeout(() => removeEventListener('click', swallow, { capture: true }));
}

/** Makes `zone`, a section's list of rooms, one its rooms can be dragged in. */
export function dragRooms(zone: HTMLElement, options: DragRoomsOptions): { destroy(): void } {
	/** Ends what's under way, one at a time: a press that may yet lift a room, or a room carried (or settling). */
	let end: (() => void) | undefined;

	/** A child's top in the list as it's laid out, leaving out the others' sliding to make way (`animate:flip`). */
	const offsetIn = (child: HTMLElement) => child.offsetTop - (child.offsetParent === zone ? 0 : zone.offsetTop);
	const roomOf = (block: Element) => block.querySelector<HTMLElement>(ROW)?.dataset.room;

	/** The room a press is on: on its row, in its block. */
	function pressed(target: EventTarget | null): Pressed | undefined {
		const row = target instanceof Element ? target.closest<HTMLElement>(ROW) : null;
		let block = row?.parentElement ?? null;
		while (block && block.parentElement !== zone) block = block.parentElement;
		return row && block && block.querySelector(ROW) === row ? { row, block } : undefined;
	}

	const mousedown = (event: MouseEvent) => {
		const at = end ? undefined : pressed(event.target);
		// Ctrl+click is a Mac's right click: its menu takes the release, so it's no press to carry anything with.
		if (!at || event.button !== 0 || event.ctrlKey) return;
		const { clientX: x, clientY: y } = event;
		const stop = () => {
			unlisten();
			if (end === stop) end = undefined;
		};
		const unlisten = listen([
			['mousemove', (move: MouseEvent) => {
				// The button let go unseen (in another window, say): no drag.
				if (!(move.buttons & 1)) return stop();
				if (Math.hypot(move.clientX - x, move.clientY - y) < options.slopPx) return;
				stop();
				carry(at, y, move.clientY, 'mouse');
			}],
			['mouseup', stop], ['blur', stop], ['contextmenu', stop]
		]);
		end = stop;
	};

	const touchstart = (event: TouchEvent) => {
		const at = end ? undefined : pressed(event.target);
		const touch = event.touches.length === 1 ? event.touches[0] : undefined;
		if (!at || !touch) return;
		const { clientX: x, clientY: y } = touch;
		const timer = setTimeout(() => {
			stop();
			carry(at, y, y, 'touch');
		}, options.holdMs);
		const stop = () => {
			clearTimeout(timer);
			unlisten();
			if (end === stop) end = undefined;
		};
		// Not passive, as the drag's own is: the browser waits on the moves from the start, so once the room lifts they
		// can be kept from scrolling the page.
		const unlisten = listen([
			['touchmove', (move: TouchEvent) => {
				const point = move.touches[0];
				// A move the browser no longer lets be kept from scrolling is one it's already scrolling with, however short.
				if (move.touches.length !== 1 || !move.cancelable || Math.hypot(point.clientX - x, point.clientY - y) >= TOUCH_SLOP) stop();
			}, { passive: false }],
			['touchend', stop], ['touchcancel', stop]
		]);
		end = stop;
	};

	/** The room lifts, pressed at `pressY`, with the pointer now at `pointerY`. */
	function carry({ row, block }: Pressed, pressY: number, pointerY: number, by: 'mouse' | 'touch'): void {
		if (!block.isConnected) return;
		const id = row.dataset.room!;
		const view = zone.closest<HTMLElement>('.ap-shell-sidebody') ?? zone;
		const slotTop = () => (block.isConnected ? zone.getBoundingClientRect().top + offsetIn(block) : undefined);
		const lifted = slotTop();
		const grab = pressY - row.getBoundingClientRect().top;
		// Its copy: the block without its threads, in the sidebar, styled as its rows are, and raised off the list.
		const copy = document.createElement('div');
		copy.id = CARRIED_ID;
		copy.setAttribute('aria-hidden', 'true');
		copy.style.cssText = `position: fixed; top: 0; left: 0; margin: 0; z-index: 9999; width: ${block.getBoundingClientRect().width}px`;
		const face = block.cloneNode(true) as HTMLElement;
		for (const threads of face.querySelectorAll('.ap-threads')) threads.remove();
		for (const named of face.querySelectorAll('[id]')) named.removeAttribute('id');
		face.classList.add('ap-roomblock-lifted');
		copy.append(face);
		(view === zone ? document.body : view).append(copy);
		// Where (0, 0) puts it: the window's corner, unless something around the sidebar holds what's fixed in it.
		const origin = copy.getBoundingClientRect();
		const height = origin.height;
		// Its place in the list stays, empty, for the others to make way around; it keeps the keyboard if it had it.
		block.classList.add('ap-roomblock-carried');
		const refocus = block.contains(document.activeElement);
		// The threads fold away (and come back) around the room in hand, not from under it: the browser's own scroll
		// anchoring is left out of that.
		view.style.overflowAnchor = 'none';

		let pointer = pointerY;
		let x = 0;
		let y = 0;
		/** The sidebar's scroll once the threads have folded away: it may only come nearer the section. */
		let start: number | undefined;
		let frame = 0;
		let done = false;
		let ids = [...zone.children].flatMap((child) => roomOf(child) ?? []);

		/**
		 * Keeps the copy in its section's column, moving only up and down, over the part of its section in view, so it
		 * lands where it's seen; and the sidebar between the scrolls that show the section's top and bottom edges (all of
		 * it if it fits) and where it was, so a wheel can't take the section out of view.
		 */
		const place = () => {
			const shown = view.getBoundingClientRect();
			let list = zone.getBoundingClientRect();
			if (start !== undefined) {
				const top = list.top - shown.top + view.scrollTop;
				const ends = [top, top + list.height - shown.height];
				const scroll = Math.min(Math.max(view.scrollTop, Math.min(start, ...ends)), Math.max(start, ...ends));
				if (Math.abs(scroll - view.scrollTop) >= 1) {
					view.scrollTop = scroll;
					list = zone.getBoundingClientRect();
				}
			}
			const upper = Math.max(list.top, shown.top);
			const lower = Math.min(list.bottom, shown.bottom);
			// The whole room where there's space for it, else its middle.
			const [first, last] = lower - upper >= height ? [upper, lower - height] : [upper - height / 2 + 1, lower - height / 2 - 1];
			y = Math.min(Math.max(pointer - grab, first), Math.max(last, first));
			x = list.left;
			copy.style.transform = `translate3d(${x - origin.left}px, ${y - origin.top}px, 0)`;
		};
		/**
		 * With the pointer near the sidebar's top or bottom, brings more of the section into view, each frame before the
		 * room is placed; never past the section, and nothing scrolls under a pointer away from the edges.
		 */
		const reach = () => {
			if (start === undefined) return;
			const shown = view.getBoundingClientRect();
			const list = zone.getBoundingClientRect();
			const edge = Math.min(EDGE, shown.height / 4);
			const by =
				pointer < shown.top + edge ? Math.max(-Math.ceil((shown.top + edge - pointer) / 3), list.top - shown.top, -view.scrollTop)
				: pointer > shown.bottom - edge ? Math.min(Math.ceil((pointer - shown.bottom + edge) / 3), list.bottom - shown.bottom)
				: 0;
			if ((by < 0 && list.top < shown.top) || (by > 0 && list.bottom > shown.bottom)) {
				view.scrollTop += by;
				start = view.scrollTop;
			}
		};
		/** Tells of the rooms as the copy would land, by where the others are laid out (`landing`), when that changes. */
		const report = () => {
			const top = zone.getBoundingClientRect().top;
			const others: Slot[] = [];
			let from = 0;
			for (const child of zone.children) {
				if (child === block) from = others.length;
				const room = child === block ? undefined : roomOf(child);
				if (room !== undefined && child instanceof HTMLElement) others.push({ id: room, middle: top + offsetIn(child) + child.offsetHeight / 2 });
			}
			const next = others.map((other) => other.id);
			next.splice(landing(others, from, y, y + height), 0, id);
			if (next.length === ids.length && next.every((other, index) => other === ids[index])) return;
			ids = next;
			options.onmove(next);
		};
		const each = () => {
			reach();
			place();
			report();
			frame = requestAnimationFrame(each);
		};

		const follow = (event: MouseEvent | TouchEvent) => {
			if (by === 'touch') {
				if (event.cancelable) event.preventDefault();
				pointer = (event as TouchEvent).touches[0]?.clientY ?? pointer;
				return;
			}
			// The button let go unseen (in another window, say): dropped where it's seen.
			if (!((event as MouseEvent).buttons & 1)) return release(event);
			event.preventDefault();
			pointer = (event as MouseEvent).clientY;
		};
		/** Let go: it lands where it's seen, and slides into its place there, nothing more scrolling meanwhile. */
		const release = (event: Event) => {
			// The browser's own click after it (a touch's, or the mouse's, on whatever's under it) isn't a pick.
			if (event.type === 'touchend') event.preventDefault();
			else swallowClick();
			unfollow();
			cancelAnimationFrame(frame);
			place();
			report();
			const landed = ids;
			void tick().then(() => {
				const to = slotTop();
				if (done || !options.settleMs || to === undefined || Math.abs(to - y) < 1) return finish(landed);
				const from = copy.style.transform;
				copy.style.transform = `translate3d(${x - origin.left}px, ${to - origin.top}px, 0)`;
				const slide = copy.animate([{ transform: from }, { transform: copy.style.transform }], { duration: options.settleMs, easing: 'ease-out' });
				slide.onfinish = slide.oncancel = () => finish(landed);
			});
		};
		const unfollow = listen(by === 'touch'
			? [['touchmove', follow, { passive: false }], ['touchend', release, { passive: false }], ['touchcancel', () => finish(undefined)]]
			: [['mousemove', follow], ['mouseup', release]]);

		function finish(landed: string[] | undefined): void {
			if (done) return;
			done = true;
			if (end === abort) end = undefined;
			unfollow();
			cancelAnimationFrame(frame);
			copy.remove();
			block.classList.remove('ap-roomblock-carried');
			const dropped = slotTop();
			const gap = parseFloat(zone.style.marginTop) || 0;
			options.ondrop(id, landed);
			// The threads come back (on the owner's next update) and the gap goes: the room let go stays where it was, the
			// sidebar scrolling as far as it can for that, and whatever's left of the gap closing up after.
			void tick().then(() => {
				zone.style.marginTop = '';
				const shown = slotTop();
				if (dropped !== undefined && shown !== undefined) view.scrollTop += shown - dropped;
				const left = dropped !== undefined ? Math.min(dropped - (slotTop() ?? dropped), gap) : 0;
				if (left >= 1 && options.settleMs) zone.animate([{ marginTop: `${left}px` }, { marginTop: '0px' }], { duration: options.settleMs, easing: 'ease-out' });
				view.style.overflowAnchor = '';
				// Moving its block in the list can take the keyboard off its row: it goes back.
				const now = document.activeElement;
				if (refocus && (!now || now === document.body)) row.focus({ preventScroll: true });
			});
		}
		const abort = () => finish(undefined);
		end = abort;

		place();
		options.onlift(id);
		void tick().then(() => {
			if (done) return;
			const folded = slotTop();
			if (lifted !== undefined && folded !== undefined && lifted - folded >= 1) {
				// The threads above it folding away took its place (and the rooms around it) up: the sidebar scrolls back
				// as far as it can, and a gap above the section makes up the rest, so its place stays under the pointer.
				const back = Math.min(lifted - folded, view.scrollTop);
				view.scrollTop -= back;
				if (lifted - folded - back >= 1) zone.style.marginTop = `${lifted - folded - back}px`;
			}
			start = view.scrollTop;
			each();
		});
	}

	// A row's images aren't for the browser's own dragging: a press on them drags the room.
	const dragstart = (event: DragEvent) => event.preventDefault();
	zone.addEventListener('mousedown', mousedown);
	zone.addEventListener('touchstart', touchstart, { passive: true });
	zone.addEventListener('dragstart', dragstart);
	return {
		destroy() {
			end?.();
			zone.removeEventListener('mousedown', mousedown);
			zone.removeEventListener('touchstart', touchstart);
			zone.removeEventListener('dragstart', dragstart);
		}
	};
}
