// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import PanelToggle from './PanelToggle.svelte';
import * as dom from '$lib/test/dom';

function render(props: { side: 'left' | 'right'; panel: string; open: boolean; ontoggle?: () => void }) {
	dom.render(PanelToggle, { ontoggle: () => {}, ...props });
	return document.querySelector<HTMLButtonElement>('button.ap-shell-toggle')!;
}

describe('PanelToggle', () => {
	it('offers to hide its panel while it shows, and to show it once it is shut, on its side, asking to toggle it when pressed', () => {
		const toggle = render({ side: 'left', panel: 'rooms', open: true });
		expect(toggle.getAttribute('aria-label')).toBe('Hide rooms');
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.classList.contains('ap-shell-toggle-left')).toBe(true);
		dom.unmount();
		const ontoggle = vi.fn();
		const shut = render({ side: 'right', panel: 'member list', open: false, ontoggle });
		expect(shut.getAttribute('aria-label')).toBe('Show member list');
		expect(shut.getAttribute('aria-expanded')).toBe('false');
		expect(shut.classList.contains('ap-shell-toggle-right')).toBe(true);
		shut.click();
		expect(ontoggle).toHaveBeenCalledOnce();
	});
});
