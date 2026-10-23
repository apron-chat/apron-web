// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import Mention from './Mention.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	dom.render(Mention, props);
	return document.querySelector('.ap-mention')!;
}

describe('Mention', () => {
	it('shows a room that only reads as text, with no ID to open it by, or as a button that opens it when given onopen', () => {
		const chip = render({ roomId: 'ops', name: 'Ops', hash: true });
		expect(chip.tagName).toBe('SPAN');
		expect(chip.className).toBe('ap-mention ap-mention-room ap-mention-hash-room');
		expect(chip.textContent).toBe('#Ops');
		expect(chip.getAttribute('title')).toBe('#ops');
		expect(chip.hasAttribute('data-room-id')).toBe(false);
		dom.unmount();
		// Given onopen, a button that opens it.
		const button = render({ roomId: 'ops', name: 'Ops', onopen: vi.fn() });
		expect(button.tagName).toBe('BUTTON');
		expect(button.getAttribute('data-room-id')).toBe('ops');
		expect(button.textContent).toBe('Ops');
	});
});
