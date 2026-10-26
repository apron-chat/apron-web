// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import PrivateIntro from './PrivateIntro.svelte';
import AddedBanner from './AddedBanner.svelte';
import * as dom from '$lib/test/dom';
import { queryByText } from '$lib/test/queries';

describe('PrivateIntro', () => {
	it('says who the room is with and what private means', () => {
		dom.render(PrivateIntro, { name: 'Bob', faces: [{ user_id: 'bob', name: 'Bob' }], detail: '@bob · Docs', testid: 'intro' });
		const intro = dom.byRole('heading', 'Bob').closest('section')!;
		expect([intro.dataset.testid, intro.getAttribute('aria-label')]).toEqual(['intro', 'About this private room']);
		expect(queryByText('@bob · Docs', intro)).not.toBeNull();
		expect(intro.querySelector('.ap-dmintro-text')?.textContent).toBe('Private room. Only members and the server host can read messages here. Only members can add others.');
	});
});

describe('AddedBanner', () => {
	it('says you were added, with Mute, Leave and a dismiss', () => {
		const props = { onmute: vi.fn(), onleave: vi.fn(), ondismiss: vi.fn(), testid: 'added' };
		dom.render(AddedBanner, props);
		expect(dom.byRole('status').textContent).toContain('You were added to this private room.');
		for (const [name, handler] of [['Mute', props.onmute], ['Leave', props.onleave], ['Dismiss', props.ondismiss]] as const) {
			dom.button(name).click();
			expect(handler).toHaveBeenCalledOnce();
		}
		dom.unmount();
		// Once muted, Unmute; a refused change says why.
		dom.render(AddedBanner, { muted: true, onunmute: vi.fn(), ondismiss: vi.fn(), error: 'Too Many Requests' });
		expect(dom.queryByRole('button', 'Mute')).toBeNull();
		expect(dom.button('Unmute')).toBeTruthy();
		expect(dom.byRole('alert').textContent).toBe('Too Many Requests');
	});
});
