// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import StatusBanner from './StatusBanner.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	instance = mount(StatusBanner, { target: document.body, props });
	flushSync();
}

describe('StatusBanner', () => {
	it('takes a tone, role and words of its own, without a connection state', () => {
		render({ tone: 'none', role: 'alert', live: true, testid: 'words', children: createRawSnippet(() => ({ render: () => '<span>Rate limited</span>' })) });
		expect(document.querySelector('.ap-status')?.getAttribute('role')).toBe('alert');
		expect(document.querySelector('.ap-status-dot')?.className).toBe('ap-status-dot');
		const words = document.querySelector('[data-testid=words]');
		expect(words?.getAttribute('aria-live')).toBe('polite');
		expect(words?.textContent).toBe('Rate limited');
	});

	it('takes its tone and words from the connection state unless told otherwise', () => {
		render({ state: 'offline', retryIn: 3 });
		expect(document.querySelector('.ap-status-dot')?.classList.contains('ap-status-danger')).toBe(true);
		expect(document.querySelector('.ap-status-text')?.textContent).toBe('Offline · Retrying in 3s');
		expect(document.querySelector('.ap-status-text')?.hasAttribute('aria-live')).toBe(false);
		unmount(instance!);
		render({ state: 'offline', tone: 'warn' });
		expect(document.querySelector('.ap-status-dot')?.classList.contains('ap-status-warn')).toBe(true);
	});
});
