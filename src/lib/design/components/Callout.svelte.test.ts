// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Callout from './Callout.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

describe('Callout', () => {
	it('is a note within its section, not a landmark', () => {
		instance = mount(Callout, { target: document.body, props: { title: 'Install Apron' } });
		flushSync();
		const callout = document.querySelector('.ap-callout')!;
		expect(callout.tagName).toBe('DIV');
		expect(callout.getAttribute('role')).toBe('note');
		expect(document.querySelector('aside')).toBeNull();
		expect(callout.querySelector('.ap-callout-title')?.textContent).toBe('Install Apron');
	});

	it('takes the caller’s attributes on its root, merging its class', () => {
		instance = mount(Callout, { target: document.body, props: { title: 'Install Apron', class: 'extra', 'data-testid': 'install', role: 'alert' } });
		flushSync();
		const callout = document.querySelector('[data-testid="install"]')!;
		expect(callout.className).toBe('ap-callout extra');
		expect(callout.getAttribute('role')).toBe('alert');
	});
});
