// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import MentionAddPrompt from './MentionAddPrompt.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown> = {}) {
	const handlers = { onadd: vi.fn(), onsend: vi.fn(), oncancel: vi.fn() };
	dom.render(MentionAddPrompt, { names: ['Grace'], place: 'engineering', ...handlers, ...props });
	flushSync();
	return { prompt: document.querySelector<HTMLElement>('[data-testid="mention-add-prompt"]')!, ...handlers };
}

describe('MentionAddPrompt', () => {
	it('asks to add who isn’t here, by name, leaving the focus where it was', () => {
		const { prompt, onadd, onsend } = render();
		expect(prompt.getAttribute('role')).toBe('dialog');
		expect(document.getElementById(prompt.getAttribute('aria-labelledby')!)?.textContent).toBe('Add Grace to engineering?');
		expect(document.getElementById(prompt.getAttribute('aria-describedby')!)?.textContent).toBe('You mentioned them, but they aren’t in this room.');
		expect(document.activeElement).toBe(document.body);
		dom.button('Add and send').click();
		expect(onadd).toHaveBeenCalledOnce();
		dom.button('Send without adding').click();
		expect(onsend).toHaveBeenCalledOnce();
	});

	it('names several, says a thread, waits while adding, and Escape goes back to the draft', () => {
		const { prompt, oncancel } = render({ names: ['Grace', 'Linus', 'Ada', 'Bob'], place: 'Deploy checklist', thread: true });
		expect(prompt.textContent).toContain('Add Grace, Linus, and 2 others to Deploy checklist?');
		expect(prompt.textContent).toContain('aren’t in this thread.');
		dom.press(dom.button('Add and send'), 'Escape');
		expect(oncancel).toHaveBeenCalledOnce();
		dom.unmount();
		const busy = render({ busy: true });
		expect(dom.button('Adding…').disabled).toBe(true);
		expect(dom.button('Send without adding').disabled).toBe(true);
		dom.press(busy.prompt, 'Escape');
		expect(busy.oncancel).not.toHaveBeenCalled();
	});
});
