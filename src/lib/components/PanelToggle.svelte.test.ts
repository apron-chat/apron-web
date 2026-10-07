// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PanelToggle from './PanelToggle.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: { side: 'left' | 'right'; panel: string; open: boolean; ontoggle?: () => void }) {
	instance = mount(PanelToggle, { target: document.body, props: { ontoggle: () => {}, ...props } });
	flushSync();
	return document.querySelector<HTMLButtonElement>('button.panel-toggle')!;
}

describe('PanelToggle', () => {
	it('offers to hide its panel while it shows, in its corner', () => {
		const toggle = render({ side: 'left', panel: 'rooms', open: true });
		expect(toggle.getAttribute('aria-label')).toBe('Hide rooms');
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(toggle.classList.contains('left')).toBe(true);
	});

	it('offers to show it once it is shut', () => {
		const toggle = render({ side: 'right', panel: 'member list', open: false });
		expect(toggle.getAttribute('aria-label')).toBe('Show member list');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(toggle.classList.contains('right')).toBe(true);
	});

	it('asks to toggle its panel when pressed', () => {
		const ontoggle = vi.fn();
		render({ side: 'left', panel: 'rooms', open: true, ontoggle }).click();
		expect(ontoggle).toHaveBeenCalledOnce();
	});
});
