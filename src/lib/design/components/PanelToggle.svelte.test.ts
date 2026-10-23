// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import PanelToggle from './PanelToggle.svelte';
import * as dom from '$lib/test/dom';

function render(props: { side: 'left' | 'right'; panel: string; open: boolean; ontoggle?: () => void }) {
	dom.render(PanelToggle, { ontoggle: () => {}, ...props });
	return document.querySelector<HTMLButtonElement>('button.ap-shell-toggle')!;
}

describe('PanelToggle', () => {
	it('offers to hide its panel while it shows, in its corner', () => {
		const toggle = render({ side: 'left', panel: 'rooms', open: true });
		expect(toggle.getAttribute('aria-label')).toBe('Hide rooms');
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.classList.contains('ap-shell-toggle-left')).toBe(true);
	});

	it('offers to show it once it is shut', () => {
		const toggle = render({ side: 'right', panel: 'member list', open: false });
		expect(toggle.getAttribute('aria-label')).toBe('Show member list');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(toggle.classList.contains('ap-shell-toggle-right')).toBe(true);
	});

	it('asks to toggle its panel when pressed', () => {
		const ontoggle = vi.fn();
		render({ side: 'left', panel: 'rooms', open: true, ontoggle }).click();
		expect(ontoggle).toHaveBeenCalledOnce();
	});
});
