// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import Bold from '@lucide/svelte/icons/bold';
import Smile from '@lucide/svelte/icons/smile';
import * as dom from '$lib/test/dom';

/**
 * Icons are drawn by one shared component (`lucideSharedIcon` in vite.config.ts), which calls lucide's `Icon` as
 * Svelte's compiled code would: drawn, and kept up to date as their props change, as lucide's own wrappers are.
 */
describe('lucide icons', () => {
	it('are the shared component, each drawing its own shape, an old name included', () => {
		expect(Bold.name).not.toBe('Bold');
		dom.render(Smile, { size: 18 } as never);
		flushSync();
		const svg = document.querySelector('svg.lucide-icon')!;
		expect(svg.getAttribute('class')).toContain('lucide-face-slightly-smiling');
		expect(svg.getAttribute('width')).toBe('18');
	});

	it('pass every prop on, and follow them as they change', () => {
		const props = $state<Record<string, unknown>>({ size: 18, 'aria-hidden': 'true', class: 'mine' });
		dom.render(Bold, props as never);
		flushSync();
		const svg = document.querySelector('svg.lucide-bold')!;
		expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/^M6 12h9/);
		expect([svg.getAttribute('width'), svg.getAttribute('aria-hidden')]).toEqual(['18', 'true']);
		expect(svg.classList.contains('mine')).toBe(true);
		props.size = 24;
		flushSync();
		expect(svg.getAttribute('width')).toBe('24');
	});
});
