// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import Callout from './Callout.svelte';
import { render } from '$lib/test/dom';

describe('Callout', () => {
	it('is a note within its section, not a landmark', () => {
		render(Callout, { title: 'Install Apron' });
		const callout = document.querySelector('.ap-callout')!;
		expect(callout.tagName).toBe('DIV');
		expect(callout.getAttribute('role')).toBe('note');
		expect(document.querySelector('aside')).toBeNull();
		expect(callout.querySelector('.ap-callout-title')?.textContent).toBe('Install Apron');
	});

	it('takes the caller’s attributes on its root, merging its class', () => {
		render(Callout, { title: 'Install Apron', class: 'extra', 'data-testid': 'install', role: 'alert' });
		const callout = document.querySelector('[data-testid="install"]')!;
		expect(callout.className).toBe('ap-callout extra');
		expect(callout.getAttribute('role')).toBe('alert');
	});
});
