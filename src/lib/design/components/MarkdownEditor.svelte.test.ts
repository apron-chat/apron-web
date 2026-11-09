// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import MarkdownEditor from './MarkdownEditor.svelte';
import * as dom from '$lib/test/dom';

describe('MarkdownEditor', () => {
	it('is a named textarea in a box, with no head unless given formatting or a preview', () => {
		dom.render(MarkdownEditor, { label: 'Room description', value: 'Deploys', placeholder: 'What this room is for.' });
		const field = dom.byRole<HTMLTextAreaElement>('textbox', 'Room description');
		expect(field.value).toBe('Deploys');
		expect(field.placeholder).toBe('What this room is for.');
		expect(document.querySelector('.ap-mdhead')).toBeNull();
		expect(dom.queryByRole('radiogroup', 'View')).toBeNull();
	});

	it('switches Write and Preview, keeping the field (and its text) under the preview', () => {
		dom.render(MarkdownEditor, { label: 'Room description', value: '**Deploys**', toolbar: dom.html('<div role="toolbar" aria-label="Formatting">B</div>'), rendered: dom.html('<strong>Deploys</strong>') });
		const box = document.querySelector('.ap-mdedit')!;
		expect(dom.queryByRole('toolbar', 'Formatting')).not.toBeNull();
		expect(dom.byRole('radio', 'Write').getAttribute('aria-checked')).toBe('true');
		dom.byRole('radio', 'Preview').click();
		flushSync();
		expect(box.classList.contains('ap-mdedit-previewing')).toBe(true);
		expect(box.querySelector('.ap-mdedit-rendered strong')?.textContent).toBe('Deploys');
		// The formatting goes while previewing; the field stays, hidden, with its text.
		expect(dom.queryByRole('toolbar', 'Formatting')).toBeNull();
		expect(box.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('**Deploys**');
		dom.byRole('radio', 'Write').click();
		flushSync();
		expect(box.classList.contains('ap-mdedit-previewing')).toBe(false);
		expect(box.querySelector('.ap-mdedit-rendered')).toBeNull();
	});
});
