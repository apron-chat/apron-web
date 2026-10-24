// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import TimelineDivider from './TimelineDivider.svelte';
import * as dom from '$lib/test/dom';

function divider(props: Record<string, unknown>): HTMLElement {
	dom.render(TimelineDivider, props);
	return document.querySelector<HTMLElement>('.ap-divider')!;
}

const classes = (element: HTMLElement) => [...element.classList];

describe('TimelineDivider', () => {
	it('is a separator named by its words: a day, New, or a gap in the history', () => {
		let line = divider({ label: 'Today', sticky: false });
		expect([line.getAttribute('role'), line.getAttribute('aria-label'), line.textContent, classes(line)]).toEqual(['separator', 'Today', 'Today', ['ap-divider', 'ap-divider-date']]);
		dom.unmount();
		line = divider({ kind: 'new' });
		expect([line.textContent, classes(line)]).toEqual(['New', ['ap-divider', 'ap-divider-new']]);
		dom.unmount();
		line = divider({ kind: 'gap' });
		expect([line.textContent, classes(line)]).toEqual(['Reconnected · earlier messages aren’t available', ['ap-divider', 'ap-divider-gap']]);
	});

	it('sticks a day by default, hidden (its space kept) until the timeline scrolls', () => {
		let line = divider({ label: 'Today' });
		expect([classes(line), line.getAttribute('aria-hidden')]).toEqual([['ap-divider', 'ap-divider-date', 'ap-divider-sticky', 'ap-divider-idle'], 'true']);
		dom.unmount();
		line = divider({ label: 'Today', scrolling: true });
		expect([classes(line), line.getAttribute('aria-hidden')]).toEqual([['ap-divider', 'ap-divider-date', 'ap-divider-sticky'], null]);
	});
});
