// @vitest-environment jsdom
import { createRawSnippet } from 'svelte';
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

	it('says when they were last seen under an offline status, as a time with its tooltip, and never otherwise (§4.5.2)', () => {
		const seen = { text: 'Last seen 3h ago', datetime: '2024-08-28T00:06:40.000Z', title: 'Last seen 2024-08-27 20:06:40' };
		let box = render({ userId: 'bo', status: 'offline', seen, seenTestid: 'seen' });
		const time = box.querySelector<HTMLTimeElement>('[data-testid="seen"]')!;
		expect([time.tagName, time.textContent, time.getAttribute('datetime'), time.title]).toEqual(['TIME', 'Last seen 3h ago', seen.datetime, seen.title]);
		expect(box.querySelector('.ap-profcard-status')!.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		// A seen kept from before they came back online says nothing now; and none is yours.
		for (const props of [{ status: 'online' }, { status: 'idle' }, { status: 'dnd' }, {}, { status: 'offline', you: true }]) {
			dom.unmount();
			box = render({ userId: 'bo', seen, ...props });
			expect(box.querySelector('.ap-profcard-seen'), JSON.stringify(props)).toBeNull();
		}
	});

	it('shows a bio as plain text, after the warning about a shared name', () => {
		const box = render({ userId: 'ada', bio: 'Counts <b>things</b>.\nhttps://example.com', sharesName: true, bioTestid: 'bio' });
		const bio = box.querySelector<HTMLElement>('[data-testid="bio"]')!;
		expect(bio.textContent).toBe('Counts <b>things</b>.\nhttps://example.com');
		expect(bio.querySelector('b, a')).toBeNull();
		expect(bio.getAttribute('dir')).toBe('auto');
		expect(box.querySelector('.ap-profcard-warn')!.compareDocumentPosition(bio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		dom.unmount();
		expect(render({ userId: 'ada' }).querySelector('.ap-profcard-bio')).toBeNull();
	});

	it('shows the bio as markup you rendered, in place of its text, only with a bio', () => {
		const bioBody = createRawSnippet(() => ({ render: () => '<span>See <a href="https://example.com">https://example.com</a></span>' }));
		const bio = render({ userId: 'ada', bio: 'See https://example.com', bioBody, bioTestid: 'bio' }).querySelector('[data-testid="bio"]')!;
		expect(bio.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
		dom.unmount();
		expect(render({ userId: 'ada', bioBody }).querySelector('.ap-profcard-bio')).toBeNull();
	});

	it('offers Copy @user_id as an icon button beside the @user_id, only when given', () => {
		const oncopyid = vi.fn();
		let box = render({ userId: 'ada', oncopyid });
		const copy = dom.button('Copy @user_id', box);
		expect(copy.closest('.ap-profcard-handleline')?.querySelector('.ap-profcard-handle')?.textContent).toBe('@ada');
		expect(copy.textContent).toBe('');
		expect(box.querySelector('.ap-profcard-actions')).toBeNull();
		copy.click();
		expect(oncopyid).toHaveBeenCalledOnce();
		dom.unmount();
		box = render({ userId: 'ada' });
		expect(box.querySelector('.ap-profcard-handle')?.textContent).toBe('@ada');
		expect(box.querySelector('button')).toBeNull();
	});

	it('offers only the actions it is given, and says Add to room is in flight', () => {
		const noop = () => undefined;
		const box = render({ userId: 'ada', onmention: noop, oncopyid: noop, onaddtoroom: noop, adding: true, note: { text: 'Nope', error: true } });
		expect([...box.querySelectorAll('.ap-profcard-actions button')].map((b) => b.textContent)).toEqual(['Mention', 'Adding…']);
		expect(dom.button('Adding…', box).disabled).toBe(true);
		expect(dom.byRole('alert', undefined, box).textContent).toBe('Nope');
	});

	it('leads with Message, the primary action, which says when it is opening', () => {
		const noop = () => undefined;
		let box = render({ userId: 'bob', onmessage: noop, onmention: noop, oncopyid: noop });
		expect([...box.querySelectorAll('.ap-profcard-actions button')].map((b) => b.textContent)).toEqual(['Message', 'Mention']);
		expect(dom.button('Message', box).classList.contains('ap-btn-primary')).toBe(true);
		expect(dom.button('Mention', box).classList.contains('ap-btn-primary')).toBe(false);
		dom.unmount();
		box = render({ userId: 'bob', onmessage: noop, messaging: true });
		expect(dom.button('Opening…', box).disabled).toBe(true);
	});
});
