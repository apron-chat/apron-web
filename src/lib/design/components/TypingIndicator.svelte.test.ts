// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import TypingIndicator from './TypingIndicator.svelte';
import * as dom from '$lib/test/dom';

function line(props: Record<string, unknown>): HTMLElement {
	dom.render(TypingIndicator, props);
	return document.querySelector<HTMLElement>('.ap-typing')!;
}

describe('TypingIndicator', () => {
	it('names one or two people and counts past that, after its dots, in a polite live region', () => {
		const say = (names: string[]) => {
			const shown = line({ names });
			const words = [shown.textContent, shown.querySelector('.ap-typing-dots') !== null, shown.getAttribute('aria-live')];
			dom.unmount();
			return words;
		};
		expect(say(['Ada'])).toEqual(['Ada is typing…', true, 'polite']);
		expect(say(['Ada', 'Bo'])).toEqual(['Ada and Bo are typing…', true, 'polite']);
		expect(say(['Ada', 'Bo', 'Cy'])).toEqual(['Several people are typing…', true, 'polite']);
	});

	it('stays, empty, while no one is typing, so the line keeps its place; its class joins its own', () => {
		const shown = line({ class: 'ap-shell-typing' });
		expect([shown.textContent, shown.children.length, [...shown.classList]]).toEqual(['', 0, ['ap-typing', 'ap-shell-typing']]);
	});
});
