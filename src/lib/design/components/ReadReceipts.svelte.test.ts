// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import ReadReceipts from './ReadReceipts.svelte';
import * as dom from '$lib/test/dom';

describe('ReadReceipts', () => {
	it('names who has read here, shows three faces and counts the rest', () => {
		dom.render(ReadReceipts, { people: [{ user_id: 'bob', name: 'Bob' }, { user_id: 'cy' }], testid: 'seen' });
		const row = document.querySelector('[data-testid="seen"]')!;
		expect(row.getAttribute('aria-label')).toBe('Seen by Bob and cy');
		expect(row.getAttribute('title')).toBe('Seen by Bob and cy');
		expect(row.querySelectorAll('.ap-avatar')).toHaveLength(2);
		dom.cleanup();
		dom.render(ReadReceipts, { people: ['a', 'b', 'c', 'd', 'e'].map((user_id) => ({ user_id })), testid: 'seen' });
		const many = document.querySelector('[data-testid="seen"]')!;
		expect(many.getAttribute('aria-label')).toBe('Seen by a, b, c and 2 more');
		expect(many.querySelectorAll('.ap-avatar')).toHaveLength(3);
		expect(many.textContent).toContain('+2');
	});

	it('draws nothing for nobody', () => {
		dom.render(ReadReceipts, { people: [] });
		expect(document.querySelector('.ap-receipts')).toBeNull();
	});
});
