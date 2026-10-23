// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import Callout from './Callout.svelte';
import { byRole, render, unmount } from '$lib/test/dom';

describe('Callout', () => {
	it('is a note within its section, not a landmark, taking the caller’s class on its root', () => {
		render(Callout, { title: 'Install Apron' });
		const callout = document.querySelector('.ap-callout')!;
		expect(callout.tagName).toBe('DIV');
		expect(callout.getAttribute('role')).toBe('note');
		expect(document.querySelector('aside')).toBeNull();
		expect(callout.querySelector('.ap-callout-title')?.textContent).toBe('Install Apron');
		unmount();
		// The caller's class joins its own.
		render(Callout, { title: 'Install Apron', class: 'extra' });
		expect(byRole('note').className).toBe('ap-callout extra');
	});
});
