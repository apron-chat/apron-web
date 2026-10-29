import { describe, expect, it } from 'vitest';
import { growKey, outward, SidebarLayout } from './sidebar.svelte';
import type { SidebarPrefs } from './storage';

function layoutWith(saved: Partial<SidebarPrefs>, side: 'left' | 'right' = 'left'): { layout: SidebarLayout; writes: SidebarPrefs[] } {
	const writes: SidebarPrefs[] = [];
	const layout = new SidebarLayout({
		side,
		defaultWidth: 248,
		minWidth: 160,
		maxWidth: 480,
		load: () => saved,
		save: (prefs) => writes.push(prefs)
	});
	return { layout, writes };
}

describe('SidebarLayout', () => {
	it('restores a saved collapsed sidebar and its width, clamped to the bounds', () => {
		const { layout } = layoutWith({ width: 300, collapsed: true });
		layout.load();
		expect(layout.collapsed).toBe(true);
		expect(layout.width).toBe(300);
		// A saved width out of bounds is clamped.
		const { layout: wide } = layoutWith({ width: 9000 });
		wide.load();
		expect(wide.width).toBe(480);
		expect(wide.collapsed).toBe(false);
	});

	it('saves reopening after a saved collapse, at the width it had', () => {
		const { layout, writes } = layoutWith({ width: 300, collapsed: true });
		layout.load();
		layout.toggle();
		expect(writes).toEqual([{ width: 300, collapsed: false }]);
	});
});

/** A handle to drag: a press on it at `x`, then `moves` to each x and a release, as PointerEvents with capture would. */
function drag(layout: SidebarLayout, rtl: boolean, x: number, ...moves: number[]): void {
	const listeners = new Map<string, (event: PointerEvent) => void>();
	const handle = {
		addEventListener: (type: string, listener: (event: PointerEvent) => void) => listeners.set(type, listener),
		removeEventListener: (type: string) => listeners.delete(type),
		setPointerCapture: () => {},
		releasePointerCapture: () => {}
	};
	const pointer = (clientX: number) => ({ button: 0, clientX, pointerId: 1, currentTarget: handle, preventDefault: () => {} }) as unknown as PointerEvent;
	layout.startResize(pointer(x), rtl);
	for (const move of moves) listeners.get('pointermove')?.(pointer(move));
	listeners.get('pointerup')?.(pointer(moves.at(-1) ?? x));
}

const arrow = (key: string) => ({ key, preventDefault: () => {} }) as unknown as KeyboardEvent;

describe('a panel border, in either direction', () => {
	it('widens toward the conversation: rightward for the left panel, leftward for the right one, mirrored under rtl', () => {
		expect(outward('left', false)).toBe(1);
		expect(outward('right', false)).toBe(-1);
		expect(outward('left', true)).toBe(-1);
		expect(outward('right', true)).toBe(1);
		expect(growKey('left', false)).toBe('ArrowRight');
		expect(growKey('right', false)).toBe('ArrowLeft');
		expect(growKey('left', true)).toBe('ArrowLeft');
		expect(growKey('right', true)).toBe('ArrowRight');
	});

	for (const [side, rtl, toward] of [['left', false, 1], ['right', false, -1], ['left', true, -1], ['right', true, 1]] as const) {
		it(`drags the ${side} panel wider toward the conversation and narrower away from it (${rtl ? 'rtl' : 'ltr'})`, () => {
			const { layout, writes } = layoutWith({ width: 300 }, side);
			layout.load();
			drag(layout, rtl, 500, 500 + 20 * toward, 500 + 40 * toward);
			expect(layout.width).toBe(340);
			drag(layout, rtl, 500, 500 - 30 * toward);
			expect(layout.width).toBe(310);
			expect(writes.at(-1)).toEqual({ width: 310, collapsed: false });
			// Far enough away, it shuts, and reopens at the width it had.
			drag(layout, rtl, 500, 500 - 290 * toward);
			expect(layout.collapsed).toBe(true);
			expect(layout.width).toBe(310);
		});

		it(`moves the ${side} panel's border the way the arrow points (${rtl ? 'rtl' : 'ltr'})`, () => {
			const { layout } = layoutWith({ width: 300 }, side);
			layout.load();
			const [wider, narrower] = toward === 1 ? ['ArrowRight', 'ArrowLeft'] : ['ArrowLeft', 'ArrowRight'];
			layout.handleKey(arrow(wider), rtl);
			expect(layout.width).toBe(316);
			layout.handleKey(arrow(narrower), rtl);
			layout.handleKey(arrow(narrower), rtl);
			expect(layout.width).toBe(284);
		});
	}

	it('keeps a drag under the 4px slop a click, which toggles', () => {
		const { layout } = layoutWith({ width: 300 }, 'right');
		layout.load();
		drag(layout, true, 500, 503);
		expect(layout.collapsed).toBe(true);
		expect(layout.width).toBe(300);
	});
});
