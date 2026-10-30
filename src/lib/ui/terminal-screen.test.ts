// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferredXterm, fakeBuffer, fakeLine, FakeTerminal, fakeXterm } from '$lib/test/fake-xterm';
import { shownRows, TERMINAL_COLS, TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, TERMINAL_ROWS, terminalFontSize, terminalOptions, TerminalScreen } from './terminal-screen';

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
		const screen = new TerminalScreen(host(), async () => fakeXterm);
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
		const screen = new TerminalScreen(host(), xterm.load);
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
		const screen = new TerminalScreen(host(), xterm.load);
		screen.write('x');
		screen.dispose();
		xterm.resolve();
		await settle();
		expect(FakeTerminal.made).toEqual([]);
	});

	it('keeps the page’s scrolling: a wheel or a swipe over it never reaches the terminal', async () => {
		const box = host();
		new TerminalScreen(box, async () => fakeXterm);
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
