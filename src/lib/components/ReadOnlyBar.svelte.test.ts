// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as dom from '$lib/test/dom';
import ReadOnlyBar from './ReadOnlyBar.svelte';

describe('ReadOnlyBar', () => {
	it('says a signed-out session can send nothing, and offers Sign in, a guest’s or an account’s', () => {
		for (const guest of [true, false]) {
			const onsignin = vi.fn();
			const root = dom.render(ReadOnlyBar, { signedOut: true, guest, onsignin });
			expect(dom.byRole('note', undefined, root).textContent?.trim()).toMatch(/^You’re signed out, so nothing can be sent here\. Sign in to go on\./);
			dom.button('Sign in', root).click();
			expect(onsignin).toHaveBeenCalledOnce();
			dom.unmount();
		}
	});

	it('offers an account that only reads no Sign in', () => {
		const root = dom.render(ReadOnlyBar, { guest: false, onsignin: vi.fn() });
		expect(dom.byRole('note', undefined, root).textContent).toContain('this server doesn’t let you post');
		expect(root.querySelector('button')).toBeNull();
	});
});
