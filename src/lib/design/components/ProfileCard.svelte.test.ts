// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileCard from './ProfileCard.svelte';
import * as dom from '$lib/test/dom';
import { queryByText } from '$lib/test/queries';

// jsdom has no ResizeObserver, which the popover's `bind:offsetHeight` uses.
beforeEach(() => {
	dom.stubResizeObserver();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function render(props: Record<string, unknown>): HTMLElement {
	dom.render(ProfileCard, props as never);
	return dom.byRole('dialog', /^Profile of /);
}

describe('ProfileCard', () => {
	it('is labeled by the name, else the user_id, and marks you', () => {
		expect(render({ userId: 'bo', name: 'Bo' }).getAttribute('aria-label')).toBe('Profile of Bo');
		dom.unmount();
		const box = render({ userId: 'ada', you: true });
		expect(box.getAttribute('aria-label')).toBe('Profile of ada');
		expect(queryByText('(you)', box)).not.toBeNull();
	});

	it('says an unknown status with its value as written, your status in the words given, and none without one (§4.5)', () => {
		let box = render({ userId: 'eve', status: 'in a meeting' });
		expect(queryByText('Unknown status: in a meeting', box)?.querySelector('code')?.textContent).toBe('in a meeting');
		dom.unmount();
		box = render({ userId: 'ada', you: true, status: 'invisible', statusLabel: 'Invisible · others see you as offline' });
		expect(queryByText('Invisible · others see you as offline', box)).not.toBeNull();
		dom.unmount();
		box = render({ userId: 'cy' });
		expect(box.querySelector('.ap-profcard-status')).toBeNull();
	});

	it('offers only the actions it is given, and says Add to room is in flight', () => {
		const noop = () => undefined;
		let box = render({ userId: 'ada', oncopyid: noop });
		expect([...box.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Copy @user_id']);
		dom.unmount();
		box = render({ userId: 'ada', onmention: noop, oncopyid: noop, onaddtoroom: noop, adding: true, note: { text: 'Nope', error: true } });
		expect([...box.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Mention', 'Copy @user_id', 'Adding…']);
		expect(dom.button('Adding…', box).disabled).toBe(true);
		expect(dom.byRole('alert', undefined, box).textContent).toBe('Nope');
	});
});
