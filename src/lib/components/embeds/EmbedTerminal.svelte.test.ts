// @vitest-environment jsdom
import { flushSync, tick } from 'svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLiveFetch } from '$lib/protocol/live-text';
import type { Embed as EmbedRecord } from '$lib/protocol/types';
import { page, pushes } from '$lib/test/app-page.svelte';
import { button, byRole, press, queryByRole, render, stubDialog, unmount } from '$lib/test/dom';
import { fakeBuffer, fakeLine, FakeTerminal } from '$lib/test/fake-xterm';
import { directory } from '$lib/ui/directory.svelte';
import { blankSnapshot } from '$lib/ui/session.svelte';
import { closedTerminals } from '$lib/ui/terminal-closed.svelte';
import { VIEWER_FIT, VIEWER_SCROLLBACK } from '$lib/ui/terminal-screen';
import { terminalViewer } from '$lib/ui/terminal-viewer.svelte';
import { loadXterm } from '$lib/ui/xterm';
import TerminalViewerHost from '../TerminalViewerHost.svelte';
import Embed from './Embed.svelte';

vi.mock('$lib/ui/xterm', async () => {
	const { fakeXterm } = await import('$lib/test/fake-xterm');
	const loadXterm = vi.fn(async () => fakeXterm);
	// As the real one: the screen, with xterm loading beside it.
	const loadTerminalScreen = async () => {
		void loadXterm();
		return import('$lib/ui/terminal-screen');
	};
	return { loadXterm, loadTerminalScreen };
});
vi.mock('$app/state', async () => ({ page: (await import('$lib/test/app-page.svelte')).page }));
vi.mock('$app/navigation', async () => ({ pushState: (await import('$lib/test/app-page.svelte')).pushState }));

const ESC_C = '\u001bc';
const text = (written: Array<string | Uint8Array>) => written.map((part) => (typeof part === 'string' ? part : new TextDecoder().decode(part)));

/** `GET url`: one response per request, each written by the test. */
function serve() {
	const responses: { push: (text: string) => void; end: () => void; fail: () => void }[] = [];
	const urls: string[] = [];
	const signals: (AbortSignal | null | undefined)[] = [];
	setLiveFetch(async (url, init) => {
		urls.push(url);
		signals.push(init.signal);
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
		responses.push({ push: (chunk) => controller.enqueue(new TextEncoder().encode(chunk)), end: () => controller.close(), fail: () => controller.error(new TypeError('dropped')) });
		return new Response(body);
	});
	return { urls, signals, responses };
}

function show(embed: EmbedRecord): HTMLElement {
	return render(Embed, { embed });
}

beforeEach(() => {
	directory.apply({ ...blankSnapshot(), authenticated: true }, 'https://chat.example', 'wss://chat.example/ws');
});

beforeAll(stubDialog);

afterEach(() => {
	// Unmounted before the fakes are cleared: a screen loads a moment after its embed mounts.
	unmount();
	terminalViewer.open = false;
	terminalViewer.view = undefined;
	page.state = {};
	pushes.length = 0;
	setLiveFetch();
	localStorage.clear();
	closedTerminals.load();
	directory.forget();
	FakeTerminal.made = [];
	vi.mocked(loadXterm).mockClear();
});

describe('a terminal embed (§4.8.6)', () => {
	it('loads xterm only once a terminal is shown', async () => {
		show({ kind: 'upload', title: 'a.txt', url: 'https://chat.example/f/1' });
		show({ kind: 'append', url: 'https://chat.example/a/1' });
		expect(loadXterm).not.toHaveBeenCalled();
		show({ kind: 'terminal', title: 'make', output: 'ok\r\n' });
		expect(loadXterm).toHaveBeenCalledOnce();
	});

	it('shows a finished one’s output from a fresh terminal, titled and Finished, fetching nothing', async () => {
		const server = serve();
		const box = show({ kind: 'terminal', title: 'make test', output: '\u001b[32mok\u001b[0m\r\n', url: 'https://chat.example/t/1' });
		await vi.waitFor(() => expect(FakeTerminal.made).toHaveLength(1));
		expect(FakeTerminal.made[0].written).toEqual([ESC_C, '\u001b[32mok\u001b[0m\r\n']);
		expect(box.querySelector('.ap-embed-termtitle')?.textContent).toBe('make test');
		expect(box.querySelector('.ap-embed-detail')?.textContent).toBe('Finished');
		expect(box.querySelector('[data-testid="terminal-embed"]')).not.toBeNull();
		expect(server.urls).toEqual([]);
	});

	it('writes live output as it arrives, and a reconnect starts the screen afresh with the new response', async () => {
		const server = serve();
		const box = show({ kind: 'terminal', url: 'https://chat.example/t/2' });
		expect(box.querySelector('.ap-embed-livebadge')?.textContent).toBe('Live');
		await vi.waitFor(() => expect(server.responses).toHaveLength(1));
		server.responses[0].push('$ make\r\n');
		await vi.waitFor(() => expect(text(FakeTerminal.made[0].written)).toEqual([ESC_C, '$ make\r\n']));
		server.responses[0].fail();
		await vi.waitFor(() => expect(server.responses).toHaveLength(2), { timeout: 3000 });
		server.responses[1].push('$ make\r\nok\r\n');
		server.responses[1].end();
		await vi.waitFor(() => expect(text(FakeTerminal.made[0].written)).toEqual([ESC_C, '$ make\r\n', ESC_C, '$ make\r\nok\r\n']));
		flushSync();
		// It ended: the snapshot with its output is on its way.
		expect(box.querySelector('.ap-embed-livebadge')).toBeNull();
		expect(box.querySelector('.ap-embed-detail')?.textContent).toBe('Ended');
	});

	it('waits for its writer while it has no url', async () => {
		const server = serve();
		const box = show({ kind: 'terminal', title: 'make' });
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(server.urls).toEqual([]);
		expect(box.querySelector('.ap-embed-livebadge')).toBeNull();
		expect(box.querySelector('.ap-embed-detail')?.textContent).toBe('Waiting to stream…');
		unmount();
	});

	it('reads live output only from the chat server', async () => {
		const server = serve();
		const box = show({ kind: 'terminal', url: 'https://elsewhere.example/t/3' });
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(server.urls).toEqual([]);
		expect(box.querySelector('.ap-embed-detail')?.textContent).toBe('Unavailable');
		expect(queryByRole('link', 'Open terminal in a new tab', box)).toBeNull();
		unmount();
	});

	it('copies what its screen shows, as plain text', async () => {
		const writeText = vi.fn(async (_text: string) => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		try {
			const box = show({ kind: 'terminal', title: 'make', output: '\u001b[32mok\u001b[0m  3 tests\r\n' });
			await vi.waitFor(() => expect(FakeTerminal.made).toHaveLength(1));
			const terminal = FakeTerminal.made[0];
			terminal.buffer = { active: fakeBuffer([fakeLine('ok  3 tests')]) as never, onBufferChange: terminal.buffer.onBufferChange };
			byRole('button', 'Copy terminal text', box).click();
			await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith('ok  3 tests'));
			await vi.waitFor(() => expect(queryByRole('button', 'Copied', box)).not.toBeNull());
		} finally {
			Reflect.deleteProperty(navigator, 'clipboard');
		}
	});

	it('links its stream to terminal.apron.chat, in a new tab, while it has one', async () => {
		serve();
		const live = show({ kind: 'terminal', title: 'make test', url: 'https://chat.example/t/4' });
		const open = byRole<HTMLAnchorElement>('link', 'Open terminal in a new tab', live);
		expect(open.closest('.ap-embed-termhead')).not.toBeNull();
		expect([open.href, open.target, open.rel]).toEqual(['https://terminal.apron.chat/#stream=https://chat.example/t/4&title=make%20test', '_blank', 'noopener noreferrer']);
		unmount();
		// A title that isn't a string, as a sender may send: left out, and nothing breaks.
		const odd = show({ kind: 'terminal', title: 5 as unknown as string, url: 'https://chat.example/t/5' });
		expect(byRole<HTMLAnchorElement>('link', 'Open terminal in a new tab', odd).href).toBe('https://terminal.apron.chat/#stream=https://chat.example/t/5');
		unmount();
		for (const embed of [{ kind: 'terminal', title: 'make' }, { kind: 'terminal', output: 'ok\r\n' }] satisfies EmbedRecord[]) {
			expect(queryByRole('link', 'Open terminal in a new tab', show(embed))).toBeNull();
			unmount();
		}
	});
});

describe('a terminal embed, closed', () => {
	it('stops reading its live text and drops its screen on Close, stays closed when drawn again and after a reload, and reads afresh on Show', async () => {
		const server = serve();
		const embed = { kind: 'terminal', embed_id: 'embed_7', title: 'make', url: 'https://chat.example/t/7' } satisfies EmbedRecord;
		let box = show(embed);
		await vi.waitFor(() => expect(server.responses).toHaveLength(1));
		server.responses[0].push('$ make\r\n');
		await vi.waitFor(() => expect(text(FakeTerminal.made[0].written)).toEqual([ESC_C, '$ make\r\n']));

		const close = button('Close terminal', box);
		close.click();
		flushSync();
		await tick();
		expect(server.signals[0]?.aborted).toBe(true);
		expect(FakeTerminal.made[0].disposed).toBe(true);
		expect(box.querySelector('.ap-embed-termscreen')).toBeNull();
		expect(box.querySelector('.ap-embed-livebadge')).toBeNull();
		expect(box.querySelector('.ap-embed-detail')?.textContent).toBe('Closed');
		expect(document.activeElement).toBe(button('Show terminal', box));

		// Drawn again, such as on coming back to its room: still closed, reading nothing.
		unmount(box);
		box = show(embed);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(server.urls).toHaveLength(1);
		expect(FakeTerminal.made).toHaveLength(1);
		expect(box.querySelector('.ap-embed-detail')?.textContent).toBe('Closed');

		// Saved for the next visit: after a reload, it is still closed, and reads nothing.
		expect(JSON.parse(localStorage.getItem('apron.closedTerminals')!)).toEqual(['https://chat.example embed_7']);
		unmount(box);
		closedTerminals.load();
		box = show(embed);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(server.urls).toHaveLength(1);
		expect(box.querySelector('.ap-embed-detail')?.textContent).toBe('Closed');

		// Show: read afresh, from the start of what the server kept.
		button('Show terminal', box).click();
		flushSync();
		await vi.waitFor(() => expect(server.responses).toHaveLength(2));
		server.responses[1].push('$ make\r\nok\r\n');
		await vi.waitFor(() => expect(text(FakeTerminal.made.at(-1)!.written)).toEqual([ESC_C, '$ make\r\nok\r\n']));
		expect(box.querySelector('.ap-embed-livebadge')?.textContent).toBe('Live');
		expect(document.activeElement).toBe(button('Close terminal', box));
		expect(JSON.parse(localStorage.getItem('apron.closedTerminals')!)).toEqual([]);
		unmount(box);
	});

	it('follows another tab closing or showing it', async () => {
		const server = serve();
		const box = show({ kind: 'terminal', embed_id: 'embed_8', url: 'https://chat.example/t/8' });
		await vi.waitFor(() => expect(server.responses).toHaveLength(1));
		localStorage.setItem('apron.closedTerminals', JSON.stringify(['https://chat.example embed_8']));
		closedTerminals.storageChanged('apron.closedTerminals');
		flushSync();
		expect(server.signals[0]?.aborted).toBe(true);
		expect(box.querySelector('.ap-embed-detail')?.textContent).toBe('Closed');
		localStorage.setItem('apron.closedTerminals', '[]');
		closedTerminals.storageChanged('apron.closedTerminals');
		flushSync();
		await vi.waitFor(() => expect(server.responses).toHaveLength(2));
	});

	it('closes its viewer too', async () => {
		serve();
		render(TerminalViewerHost);
		const box = show({ kind: 'terminal', title: 'make', output: 'ok\r\n' });
		button('Expand terminal', box).click();
		flushSync();
		await vi.waitFor(() => expect(FakeTerminal.made).toHaveLength(2));
		const back = vi.spyOn(history, 'back').mockImplementation(() => {});
		// The dialog is modal, so a press can't reach Close while it shows; whatever closes it, its viewer goes.
		button('Close terminal', box).click();
		flushSync();
		await tick();
		expect(document.querySelector('[data-testid="terminal-viewer"]')).toBeNull();
		expect(FakeTerminal.made.every((terminal) => terminal.disposed)).toBe(true);
		back.mockRestore();
	});
});

describe('a terminal embed, expanded (the viewer)', () => {
	/** The page's one viewer, then the embed. */
	function showWithViewer(embed: EmbedRecord): HTMLElement {
		render(TerminalViewerHost);
		return show(embed);
	}
	const viewer = () => document.querySelector<HTMLDialogElement>('[data-testid="terminal-viewer"]');

	it('opens full screen from Expand, on a screen of its own fitted to the viewer, live from the same read of the text', async () => {
		const server = serve();
		const box = showWithViewer({ kind: 'terminal', title: 'make test', url: 'https://chat.example/t/4' });
		await vi.waitFor(() => expect(server.responses).toHaveLength(1));
		server.responses[0].push('$ make\r\n');
		await vi.waitFor(() => expect(text(FakeTerminal.made[0].written)).toEqual([ESC_C, '$ make\r\n']));
		expect(viewer()).toBeNull();

		const expand = button('Expand terminal', box);
		expand.click();
		flushSync();
		const dialog = viewer()!;
		expect(dialog.open).toBe(true);
		expect(dialog.querySelector('h2')?.textContent).toBe('make test');
		expect(dialog.querySelector('.ap-embed-livebadge')?.textContent).toBe('Live');
		// The viewer's own terminal starts from the text so far.
		await vi.waitFor(() => expect(FakeTerminal.made).toHaveLength(2));
		const full = FakeTerminal.made[1];
		expect(full.element?.closest('.ap-termviewer-screen')).not.toBeNull();
		expect(full.options.fontSize).toBeGreaterThanOrEqual(VIEWER_FIT.min);
		expect(text(full.written)).toEqual([ESC_C, '$ make\r\n']);
		// It keeps lines to scroll back through; the message's is a glance, and keeps none.
		expect([FakeTerminal.made[0].options.scrollback, full.options.scrollback]).toEqual([0, VIEWER_SCROLLBACK]);
		// A history entry of its own, for Back.
		expect(page.state.terminal).toBeTypeOf('number');

		// What arrives reaches both, from the one GET.
		server.responses[0].push('ok\r\n');
		await vi.waitFor(() => expect(text(full.written).at(-1)).toBe('ok\r\n'));
		expect(text(FakeTerminal.made[0].written).at(-1)).toBe('ok\r\n');
		// A reconnect starts both afresh.
		server.responses[0].fail();
		await vi.waitFor(() => expect(server.responses).toHaveLength(2), { timeout: 3000 });
		server.responses[1].push('$ make\r\nok\r\ndone\r\n');
		server.responses[1].end();
		await vi.waitFor(() => expect(text(full.written).slice(-2)).toEqual([ESC_C, '$ make\r\nok\r\ndone\r\n']));
		flushSync();
		expect(dialog.querySelector('.ap-embed-livebadge')).toBeNull();
		expect(dialog.querySelector('.ap-viewer-detail')?.textContent).toBe('Ended');
		expect(server.urls).toEqual(['https://chat.example/t/4', 'https://chat.example/t/4']);
	});

	it('closes on Escape, leaving its history entry, with its screen gone and focus back on Expand', async () => {
		const server = serve();
		const box = showWithViewer({ kind: 'terminal', url: 'https://chat.example/t/5' });
		await vi.waitFor(() => expect(server.responses).toHaveLength(1));
		const back = vi.spyOn(history, 'back').mockImplementation(() => {});
		const expand = button('Expand terminal', box);
		expand.click();
		flushSync();
		await vi.waitFor(() => expect(FakeTerminal.made).toHaveLength(2));
		const dialog = viewer()!;
		expect(press(dialog.querySelector('.ap-termviewer-stage')!, 'Escape')).toBe(false);
		flushSync();
		await tick();
		expect(viewer()).toBeNull();
		expect(FakeTerminal.made[1].disposed).toBe(true);
		expect(FakeTerminal.made[0].disposed).toBe(false);
		expect(back).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(expand);
		expect(server.urls).toHaveLength(1);
		back.mockRestore();
	});

	it('closes on Back, and when its embed goes', async () => {
		serve();
		const box = showWithViewer({ kind: 'terminal', title: 'make', output: 'ok\r\n' });
		button('Expand terminal').click();
		flushSync();
		await vi.waitFor(() => expect(FakeTerminal.made).toHaveLength(2));
		expect(text(FakeTerminal.made[1].written)).toEqual([ESC_C, 'ok\r\n']);
		expect(viewer()?.querySelector('.ap-viewer-detail')?.textContent).toBe('Finished');
		// Back: the entry before it.
		const back = vi.spyOn(history, 'back').mockImplementation(() => {});
		page.state = {};
		flushSync();
		await tick();
		expect(viewer()).toBeNull();
		expect(back).not.toHaveBeenCalled();

		button('Expand terminal').click();
		flushSync();
		expect(viewer()?.open).toBe(true);
		expect(pushes).toHaveLength(2);
		unmount(box);
		flushSync();
		await tick();
		expect(viewer()).toBeNull();
		expect(back).toHaveBeenCalledOnce();
		back.mockRestore();
	});
});
