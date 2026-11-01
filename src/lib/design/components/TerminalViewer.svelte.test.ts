// @vitest-environment jsdom
import { flushSync, tick } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import TerminalViewer from './TerminalViewer.svelte';
import { button, press, render, stubDialog } from '$lib/test/dom';

beforeAll(stubDialog);

describe('TerminalViewer', () => {
	it('shows the terminal full screen, titled, Live while it is, with Close focused, and its screen in a stage that scrolls', () => {
		const attach = vi.fn();
		render(TerminalViewer, { open: true, title: 'make test', live: true, attach, testid: 'viewer' });
		const dialog = document.querySelector('dialog')!;
		expect(dialog.open).toBe(true);
		expect(dialog.dataset.testid).toBe('viewer');
		expect(dialog.querySelector('h2')?.textContent).toBe('make test');
		expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id);
		expect(dialog.querySelector('.ap-embed-livebadge')?.textContent).toBe('Live');
		expect(document.activeElement).toBe(button('Close'));
		const screen = dialog.querySelector<HTMLElement>('.ap-termviewer-screen')!;
		expect(attach).toHaveBeenCalledWith(screen);
		expect(screen.dir).toBe('ltr');
		expect(screen.parentElement?.classList.contains('ap-termviewer-stage')).toBe(true);
	});

	it('says how it stopped once it isn’t live, and shows plain text without `attach`', () => {
		render(TerminalViewer, { open: true, status: 'Ended', text: '$ make\nok' });
		const dialog = document.querySelector('dialog')!;
		expect(dialog.querySelector('h2')?.textContent).toBe('Terminal');
		expect(dialog.querySelector('.ap-embed-livebadge')).toBeNull();
		expect(dialog.querySelector('.ap-viewer-detail')?.textContent).toBe('Ended');
		expect(dialog.querySelector('pre.ap-termviewer-screen')?.textContent).toBe('$ make\nok');
	});

	it('draws nothing while closed, and closes on Escape or Close, saying so', async () => {
		const onclose = vi.fn();
		const attach = vi.fn();
		const props = $state({ open: false, attach, onclose });
		render(TerminalViewer, props);
		const dialog = document.querySelector('dialog')!;
		expect(dialog.open).toBe(false);
		expect(attach).not.toHaveBeenCalled();

		props.open = true;
		flushSync();
		expect(press(dialog.querySelector('.ap-termviewer-stage')!, 'Escape')).toBe(false);
		flushSync();
		await tick();
		expect([props.open, dialog.open, onclose.mock.calls.length]).toEqual([false, false, 1]);
		expect(dialog.querySelector('.ap-termviewer-screen')).toBeNull();

		props.open = true;
		flushSync();
		button('Close').click();
		flushSync();
		expect([props.open, dialog.open, onclose.mock.calls.length]).toEqual([false, false, 2]);
	});
});
