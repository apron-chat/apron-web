// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CopyButton from './CopyButton.svelte';
import { button, queryByRole, render, unmount } from '$lib/test/dom';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	unmount();
	vi.useRealTimers();
});

describe('CopyButton', () => {
	it('is an icon button named by its label, with the same tooltip, and takes its class and test id', () => {
		render(CopyButton, { label: 'Copy the address', oncopy: () => true, class: 'mine', testid: 'copy' });
		const copy = button('Copy the address');
		expect([copy.type, copy.title, copy.className, copy.dataset.testid]).toEqual(['button', 'Copy the address', 'ap-iconbtn mine', 'copy']);
		expect(copy.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('says Copied for a moment once `oncopy` resolves true, then goes back to Copy', async () => {
		const oncopy = vi.fn(async () => true);
		render(CopyButton, { label: 'Copy the address', copiedLabel: 'Copied the address', oncopy });
		const copy = button('Copy the address');
		const glyph = copy.innerHTML;
		copy.click();
		await vi.advanceTimersByTimeAsync(0);
		expect(oncopy).toHaveBeenCalledOnce();
		expect([copy.getAttribute('aria-label'), copy.title]).toEqual(['Copied the address', 'Copied the address']);
		expect(copy.innerHTML).not.toBe(glyph);
		await vi.advanceTimersByTimeAsync(1000);
		// A second copy starts the moment afresh.
		copy.click();
		await vi.advanceTimersByTimeAsync(1000);
		expect(copy.getAttribute('aria-label')).toBe('Copied the address');
		await vi.advanceTimersByTimeAsync(500);
		expect([copy.getAttribute('aria-label'), copy.innerHTML]).toEqual(['Copy the address', glyph]);
	});

	it('stops saying Copied when a later copy fails', async () => {
		const oncopy = vi.fn(async () => true);
		render(CopyButton, { label: 'Copy the address', oncopy });
		button('Copy the address').click();
		await vi.advanceTimersByTimeAsync(0);
		expect(queryByRole('button', 'Copied')).not.toBeNull();
		oncopy.mockResolvedValue(false);
		button('Copied').click();
		await vi.advanceTimersByTimeAsync(0);
		expect(queryByRole('button', 'Copy the address')).not.toBeNull();
	});

	it('sets nothing, and leaves no timer, when a copy resolves after it is gone', async () => {
		let resolve!: (copied: boolean) => void;
		render(CopyButton, { label: 'Copy the address', oncopy: () => new Promise<boolean>((done) => (resolve = done)) });
		button('Copy the address').click();
		unmount();
		resolve(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('says nothing when it could not copy, and Copied unless told otherwise', async () => {
		const oncopy = vi.fn(() => false);
		render(CopyButton, { label: 'Copy terminal text', oncopy });
		button('Copy terminal text').click();
		await vi.advanceTimersByTimeAsync(0);
		expect(oncopy).toHaveBeenCalledOnce();
		expect(queryByRole('button', 'Copied')).toBeNull();
		oncopy.mockReturnValue(true);
		button('Copy terminal text').click();
		await vi.advanceTimersByTimeAsync(0);
		expect(button('Copied').title).toBe('Copied');
	});
});
