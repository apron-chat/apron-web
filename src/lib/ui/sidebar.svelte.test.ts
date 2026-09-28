import { describe, expect, it } from 'vitest';
import { SidebarLayout } from './sidebar.svelte';

const pageSource = await import('../../routes/+page.svelte?raw').then((module) => module.default as string);

function layoutWith(saved: Partial<{ width: number; collapsed: boolean }>): { layout: SidebarLayout; writes: Array<{ width: number; collapsed: boolean }> } {
	const writes: Array<{ width: number; collapsed: boolean }> = [];
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

describe('sidebar layout preferences', () => {
	it('restores a persisted collapsed sidebar for the phone layout', () => {
		const { layout } = layoutWith({ width: 248, collapsed: true });

		layout.load();

		expect(layout.collapsed).toBe(true);
		expect(layout.width).toBe(248);
	});

	it('does not reserve the hidden toggle space in the phone room header', () => {
		expect(pageSource).toMatch(
			/@media \(min-width: 720px\) \{[\s\S]*?\.side-collapsed :global\(\.ap-roomhead\) \{ padding-left: calc\(var\(--sidebar-toggle-w\) \+ var\(--space-4\)\); \}/
		);
		const phoneStyles = pageSource.match(/@media \(max-width: 719px\) \{([\s\S]*?)\n\t\}/)?.[1];
		expect(phoneStyles).toBeDefined();
		expect(phoneStyles).toContain(".app[data-pane='main'] :global(.ap-shell-side) { display: none; }");
		expect(phoneStyles).toContain(".app[data-pane='rooms'] .ap-shell-main, .app[data-pane='rooms'] :global(.member-list) { display: none; }");
		expect(phoneStyles).toContain('.side-collapsed :global(.ap-shell-side) { opacity: 1; visibility: visible; transition: none; }');
		expect(phoneStyles).toContain('.side-collapsed :global(.ap-roomhead) { padding-left: var(--space-4); }');
	});

	it('disables both sidebar opacity transitions for reduced-motion users', () => {
		expect(pageSource).toContain(
			'@media (prefers-reduced-motion: reduce) { .app, .app.side-collapsed :global(.ap-shell-side), .app:not(.side-collapsed) :global(.ap-shell-side) { transition: none; } }'
		);
	});

	it('persists reopening after a saved collapsed state', () => {
		const { layout, writes } = layoutWith({ width: 248, collapsed: true });

		layout.load();
		layout.toggle();

		expect(writes).toEqual([{ width: 248, collapsed: false }]);
	});
});
