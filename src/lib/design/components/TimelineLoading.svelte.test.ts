// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import TimelineLoading from './TimelineLoading.svelte';
import * as dom from '$lib/test/dom';

describe('TimelineLoading', () => {
	it('says older messages are loading at the top, as a status that takes no space', () => {
		dom.render(TimelineLoading, { label: 'Loading earlier messages…', top: true });
		const status = document.querySelector<HTMLElement>('.ap-tlstatus-top')!;
		expect(status.getAttribute('role')).toBe('status');
		expect(status.textContent).toBe('Loading earlier messages…');
		expect(document.querySelector('.ap-tlstatus-float, .ap-skel-rows')).toBeNull();
	});
});
