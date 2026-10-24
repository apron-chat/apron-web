import { describe, expect, it } from 'vitest';
import { SidebarLayout } from './sidebar.svelte';
import type { SidebarPrefs } from './storage';

function layoutWith(saved: Partial<SidebarPrefs>): { layout: SidebarLayout; writes: SidebarPrefs[] } {
	const writes: SidebarPrefs[] = [];
	const layout = new SidebarLayout({
		side: 'left',
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
