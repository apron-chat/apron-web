// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import MentionAddLine from './MentionAddLine.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown> = {}) {
	const onchange = vi.fn();
	dom.render(MentionAddLine, { names: ['Grace'], onchange, ...props });
	flushSync();
	const line = document.querySelector<HTMLElement>('[data-testid="mention-outside-hint"]')!;
	const box = document.querySelector<HTMLInputElement>('[data-testid="mention-outside-add"]')!;
	return { line, box, onchange };
}

describe('MentionAddLine', () => {
	it('names who isn’t here, and its checkbox, described by the line, says whether Send adds them', () => {
		const { line, box, onchange } = render({ add: true });
		expect(line.textContent).toContain('Not in this room, add them so they’ll see the mention? Grace');
		expect(box.checked).toBe(true);
		expect(box.closest('label')?.textContent).toBe('Add to room on send');
		expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toContain('Grace');
		expect(document.activeElement).toBe(document.body);
		box.click();
		expect(onchange).toHaveBeenCalledWith(false);
	});

	it('names several, a role’s holders as given, says a thread, and waits while adding with its label kept', () => {
		const { line, box } = render({ names: ['Grace', 'Margaret Hamilton (moderator)', 'Ada', 'Bob'], thread: true, busy: true, add: true });
		expect(line.textContent).toContain('Not in this thread');
		expect(line.textContent).toContain('Grace, Margaret Hamilton (moderator), and 2 others');
		expect(box.disabled).toBe(true);
		expect(box.closest('label')?.textContent).toBe('Add to thread on send');
		expect(line.textContent).toContain('Adding…');
	});
});
