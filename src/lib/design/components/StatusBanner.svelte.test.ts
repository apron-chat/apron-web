// @vitest-environment jsdom
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import StatusBanner from './StatusBanner.svelte';
import * as dom from '$lib/test/dom';
import { byText } from '$lib/test/queries';

function render(props: Record<string, unknown>) {
	dom.render(StatusBanner, props);
}

describe('StatusBanner', () => {
	it('takes a tone, role and words of its own, without a connection state', () => {
		render({ tone: 'none', role: 'alert', live: true, children: createRawSnippet(() => ({ render: () => '<span>Rate limited</span>' })) });
		expect(dom.byRole('alert').textContent?.trim()).toBe('Rate limited');
		expect(document.querySelector('.ap-status-dot')?.className).toBe('ap-status-dot');
		expect(byText('Rate limited').parentElement?.getAttribute('aria-live')).toBe('polite');
	});

	it('takes its tone and words from the connection state unless told otherwise', () => {
		render({ state: 'offline', retryIn: 3 });
		expect(document.querySelector('.ap-status-dot')?.classList.contains('ap-status-danger')).toBe(true);
		expect(dom.byRole('status').textContent?.trim()).toBe('Offline · Retrying in 3s');
		expect(document.querySelector('[aria-live]')).toBeNull();
		dom.unmount();
		render({ state: 'offline', tone: 'warn' });
		expect(document.querySelector('.ap-status-dot')?.classList.contains('ap-status-warn')).toBe(true);
	});
});
