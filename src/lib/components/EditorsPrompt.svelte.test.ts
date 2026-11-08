// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import EditorsPrompt from './EditorsPrompt.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown> = {}) {
	const handlers = { onshare: vi.fn(), onsend: vi.fn(), oncancel: vi.fn() };
	dom.render(EditorsPrompt, { names: ['Grace'], ...handlers, ...props });
	flushSync();
	return { prompt: document.querySelector<HTMLElement>('[data-testid="editors-prompt"]')!, ...handlers };
}

describe('EditorsPrompt', () => {
	it('asks whether who it mentions may edit it, leaving the focus where it was', () => {
		const { prompt, onshare, onsend } = render();
		expect(prompt.getAttribute('role')).toBe('dialog');
		expect(document.getElementById(prompt.getAttribute('aria-labelledby')!)?.textContent).toBe('Let Grace edit this message?');
		expect(document.getElementById(prompt.getAttribute('aria-describedby')!)?.textContent).toBe('They could tick its checklist and change its text.');
		expect(document.activeElement).toBe(document.body);
		dom.button('Let them edit').click();
		expect(onshare).toHaveBeenCalledOnce();
		dom.button('Only I can edit').click();
		expect(onsend).toHaveBeenCalledOnce();
	});

	it('names several, and Escape goes back to the draft', () => {
		const { prompt, oncancel } = render({ names: ['Grace', 'Linus'] });
		expect(prompt.textContent).toContain('Let Grace and Linus edit this message?');
		expect(prompt.textContent).toContain('Each of them could tick');
		dom.press(dom.button('Let them edit'), 'Escape');
		expect(oncancel).toHaveBeenCalledOnce();
	});
});
