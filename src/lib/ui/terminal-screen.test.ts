// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferredXterm, fakeBuffer, fakeLine, FakeTerminal, fakeXterm } from '$lib/test/fake-xterm';
import { shownRows, TERMINAL_COLS, TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, TERMINAL_ROWS, TERMINAL_VIEWER_FONT_MAX, TERMINAL_VIEWER_FONT_MIN, TerminalFeed, terminalFontSize, terminalOptions, TerminalScreen, VIEWER_FIT, type TerminalSink } from './terminal-screen';

const ESC_C = '\u001bc';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	FakeTerminal.made = [];
	document.body.replaceChildren();
});

function host(): HTMLElement {
	return document.body.appendChild(document.createElement('div'));
}

describe('a terminal embed’s screen (§4.8.6)', () => {
	it('is 80 by 40 and only reads: no input, no blinking cursor, no scrollback, LF as CR LF, and links that open nothing', () => {
		const options = terminalOptions({}, 'monospace', 12);
		expect(options).toMatchObject({ cols: 80, rows: 40, disableStdin: true, cursorBlink: false, cursorInactiveStyle: 'none', convertEol: true, scrollback: 0, windowOptions: {} });
		expect([TERMINAL_COLS, TERMINAL_ROWS]).toEqual([80, 40]);
		const open = vi.spyOn(window, 'open').mockImplementation(() => null);
		options.linkHandler!.activate(new MouseEvent('click'), 'https://evil.example/', { start: { x: 1, y: 1 }, end: { x: 5, y: 1 } });
		expect(open).not.toHaveBeenCalled();
		expect(options.linkHandler!.allowNonHttpProtocols).toBe(false);
		open.mockRestore();
	});

	it('swallows titles and the clipboard, and listens to nothing a program could send back: no input, replies, title or bell', async () => {
		const screen = new TerminalScreen(host(), { load: async () => fakeXterm });
		await settle();
		const terminal = FakeTerminal.made[0];
		expect([...terminal.oscs.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 52]);
		for (const handler of terminal.oscs.values()) expect(handler('anything')).toBe(true);
		expect(terminal.subscribed.filter((name) => ['onData', 'onBinary', 'onTitleChange', 'onBell', 'onKey'].includes(name))).toEqual([]);
		// Not a tab stop: nothing can be typed into it.
		expect(terminal.textarea?.tabIndex).toBe(-1);
		screen.dispose();
		expect(terminal.disposed).toBe(true);
	});

	it('loads xterm only when made, and plays what was asked meanwhile in order, a reset as RIS in the same queue', async () => {
		const xterm = deferredXterm();
		const screen = new TerminalScreen(host(), { load: xterm.load });
		expect(xterm.load).toHaveBeenCalledOnce();
		const bytes = new Uint8Array([0x6f, 0x6b]);
		screen.write('stale');
		screen.reset();
		screen.write(bytes);
		expect(FakeTerminal.made).toEqual([]);
		xterm.resolve();
		await settle();
		expect(FakeTerminal.made[0].written).toEqual(['stale', ESC_C, bytes]);
		screen.show('done\r\n');
		expect(FakeTerminal.made[0].written.slice(3)).toEqual([ESC_C, 'done\r\n']);
	});

	it('makes no terminal once disposed, even if xterm arrives later', async () => {
		const xterm = deferredXterm();
		const screen = new TerminalScreen(host(), { load: xterm.load });
		screen.write('x');
		screen.dispose();
		xterm.resolve();
		await settle();
		expect(FakeTerminal.made).toEqual([]);
	});

	it('keeps the page’s scrolling: a wheel or a swipe over it never reaches the terminal', async () => {
		const box = host();
		new TerminalScreen(box, { load: async () => fakeXterm });
		await settle();
		const reached = vi.fn();
		FakeTerminal.made[0].element!.addEventListener('wheel', reached);
		const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 });
		FakeTerminal.made[0].element!.dispatchEvent(wheel);
		expect(reached).not.toHaveBeenCalled();
		expect(wheel.defaultPrevented).toBe(false);
	});
});

describe('terminalFontSize', () => {
	it('fits the 80 columns in the width, in quarter pixels, at most the comfortable size and at least the smallest', () => {
		expect(terminalFontSize(1000, 0.6)).toBe(TERMINAL_FONT_MAX);
		// A phone: 300 pixels for 80 columns of a face 0.6 wide.
		expect(terminalFontSize(300, 0.6)).toBe(6.25);
		expect(300 / (80 * 0.6)).toBeGreaterThanOrEqual(terminalFontSize(300, 0.6));
		expect(terminalFontSize(10, 0.6)).toBe(TERMINAL_FONT_MIN);
	});

	it('full screen, fits all 80 by 40 in the space, as large as that allows, but never below a readable size', () => {
		expect(TERMINAL_VIEWER_FONT_MIN).toBe(9);
		// A desktop, 1248 by 800 for the screen: the 40 rows (1.2 per pixel of font) decide, not the columns.
		expect(terminalFontSize(1248, 0.6, VIEWER_FIT, 800, 1.2)).toBe(16.5);
		expect(terminalFontSize(1248, 0.6)).toBe(TERMINAL_FONT_MAX);
		// A tablet upright: the columns decide.
		expect(terminalFontSize(736, 0.6, VIEWER_FIT, 940, 1.2)).toBe(15.25);
		// A phone upright, 358 wide: the columns fit only at 7.25, so it stays at 9 and the screen scrolls sideways.
		expect(terminalFontSize(358, 0.6, VIEWER_FIT, 700, 1.2)).toBe(TERMINAL_VIEWER_FONT_MIN);
		expect(terminalFontSize(358, 0.6)).toBe(7.25);
		// A phone on its side, 812 by 334: the rows would fit only at 7, so they stop at a message's desktop size and
		// the screen scrolls up and down; the columns still fit.
		expect(VIEWER_FIT.rows).toBe(TERMINAL_FONT_MAX);
		expect(terminalFontSize(812, 0.6, VIEWER_FIT, 334, 1.2)).toBe(TERMINAL_FONT_MAX);
		expect(80 * 0.6 * TERMINAL_FONT_MAX).toBeLessThanOrEqual(812);
		// Narrower than that, the columns decide again.
		expect(terminalFontSize(560, 0.6, VIEWER_FIT, 300, 1.2)).toBe(11.5);
		// A large screen stops at the largest.
		expect(terminalFontSize(3800, 0.6, VIEWER_FIT, 2000, 1.2)).toBe(TERMINAL_VIEWER_FONT_MAX);
	});
});

describe('a screen fitted to a space', () => {
	/** A box of `width` by `height`, as jsdom lays out nothing. */
	function sized(width: number, height: number, padding = 0): HTMLElement {
		const box = host();
		box.style.padding = `${padding}px`;
		Object.defineProperty(box, 'clientWidth', { value: width + 2 * padding });
		Object.defineProperty(box, 'clientHeight', { value: height + 2 * padding });
		return box;
	}

	/** xterm's screen drawn `advance` and `line` per pixel of font, wider and taller than the probe measured. */
	function drawn(advance: number, line: number) {
		return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
			const size = Number(FakeTerminal.made[0]?.options.fontSize ?? 0);
			const wide = this.classList.contains('xterm-screen') ? { width: TERMINAL_COLS * advance * size, height: TERMINAL_ROWS * line * size } : { width: 0, height: 0 };
			return { ...wide, top: 0, left: 0, right: wide.width, bottom: wide.height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
		});
	}

	it('in a message, fits the columns in the box’s width', async () => {
		const box = sized(358, 0);
		new TerminalScreen(box, { load: async () => fakeXterm });
		await settle();
		expect(box.dataset.fontSize).toBe('7.25');
	});

	it('full screen, fits the space around it (its padding aside), at least 9, and checks what xterm drew', async () => {
		const stage = sized(1248, 800, 16);
		const box = stage.appendChild(document.createElement('div'));
		const rects = drawn(0.6, 1.3);
		new TerminalScreen(box, { fit: VIEWER_FIT, space: stage, load: async () => fakeXterm });
		await settle();
		// 16.5 by the probe's 1.2 a row; xterm drew 1.3, so it shrinks until the 40 rows fit: 800 / (40 × 1.3) is 15.38.
		expect(Number(box.dataset.fontSize)).toBe(15.25);
		expect(TERMINAL_ROWS * 1.3 * 15.25).toBeLessThanOrEqual(800);
		FakeTerminal.made = [];
		// A phone on its side: the rows don't fit at 13, and it stays at 13, to scroll.
		const short = sized(812, 334, 0);
		const wide = short.appendChild(document.createElement('div'));
		new TerminalScreen(wide, { fit: VIEWER_FIT, space: short, load: async () => fakeXterm });
		await settle();
		expect(wide.dataset.fontSize).toBe('13');
		rects.mockRestore();

		const phone = sized(358, 700);
		const narrow = phone.appendChild(document.createElement('div'));
		new TerminalScreen(narrow, { fit: VIEWER_FIT, space: phone, load: async () => fakeXterm });
		await settle();
		expect(narrow.dataset.fontSize).toBe('9');
	});
});

describe('TerminalFeed', () => {
	function sink(): TerminalSink & { log: string[] } {
		const log: string[] = [];
		return { log, reset: () => log.push('reset'), write: (data) => log.push(String(data)), show: (output) => log.push(`show ${output}`) };
	}

	it('writes to every screen attached, and starts one attached later from the text so far', () => {
		const feed = new TerminalFeed();
		const inline = sink();
		feed.attach(inline);
		feed.reset();
		feed.write('$ make\r\n');
		feed.write('');
		const viewer = sink();
		const detach = feed.attach(viewer);
		feed.write('ok\r\n');
		expect(inline.log).toEqual(['reset', '$ make\r\n', 'ok\r\n']);
		expect(viewer.log).toEqual(['show $ make\r\n', 'ok\r\n']);
		expect(feed.text).toBe('$ make\r\nok\r\n');
		// A reconnect's response, then the finished output, replace it.
		feed.reset();
		feed.write('again');
		feed.show('done');
		expect(viewer.log.slice(2)).toEqual(['reset', 'again', 'show done']);
		detach();
		feed.write('more');
		expect(viewer.log).toHaveLength(5);
		expect(inline.log.at(-1)).toBe('more');
		expect(feed.text).toBe('donemore');
	});

	it('gives a screen attached before anything is written nothing to show', () => {
		const screen = sink();
		new TerminalFeed().attach(screen);
		expect(screen.log).toEqual([]);
	});
});

describe('shownRows', () => {
	it('shows rows down to the last one written, and at least one', () => {
		expect(shownRows(fakeBuffer([fakeLine('$ make'), fakeLine('ok'), fakeLine('   ')]) as never)).toBe(2);
		expect(shownRows(fakeBuffer([]) as never)).toBe(1);
	});

	it('counts a row of colored blanks, such as a bar, as written', () => {
		expect(shownRows(fakeBuffer([fakeLine('x'), fakeLine(''), fakeLine('', [4, 5])]) as never)).toBe(3);
	});

	it('shows the whole screen on the alternate screen, and once output has scrolled', () => {
		expect(shownRows(fakeBuffer([fakeLine('top')], 'alternate') as never)).toBe(40);
		expect(shownRows(fakeBuffer([fakeLine('top')], 'normal', 3) as never)).toBe(40);
	});
});
