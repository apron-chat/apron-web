import type { IBuffer, ITerminalInitOnlyOptions, ITerminalOptions, ITheme, Terminal } from '@xterm/xterm';
import { loadXterm, type Xterm } from './xterm';

/**
 * The screen of a `terminal` embed (§4.8.6): xterm.js, 80 columns by 40
 * rows, loaded only once a terminal embed is shown. It only reads: no input,
 * and nothing a program prints acts outside it. It never sends xterm's
 * replies anywhere, ignores title changes, the bell and the clipboard
 * (OSC 52), and opens no links (OSC 8). The font is scaled so the 80 columns
 * fit the space it has, up to TERMINAL_FONT_MAX; rows below the last one
 * written are hidden, unless a program is using the alternate screen.
 */

export const TERMINAL_COLS = 80;
export const TERMINAL_ROWS = 40;
/** The largest font, for a wide screen: a comfortable size for reading a log. */
export const TERMINAL_FONT_MAX = 13;
/** The smallest it goes, however narrow the space. */
export const TERMINAL_FONT_MIN = 4;

/** The options every terminal embed's xterm is made with. */
export function terminalOptions(theme: ITheme, fontFamily: string, fontSize: number): ITerminalOptions & ITerminalInitOnlyOptions {
	return {
		cols: TERMINAL_COLS,
		rows: TERMINAL_ROWS,
		// Read-only: nothing typed reaches it, and no cursor of its own blinks.
		disableStdin: true,
		cursorBlink: false,
		cursorStyle: 'block',
		cursorInactiveStyle: 'none',
		// Output piped without a pseudo-terminal ends lines with a bare line feed, which a terminal's driver would turn into CR LF.
		convertEol: true,
		// The screen, as a terminal shows it: what scrolls off its top is gone.
		scrollback: 0,
		// OSC 8 links are shown, never opened.
		linkHandler: { activate: () => {}, allowNonHttpProtocols: false },
		// No window manipulation or reports (the default, stated).
		windowOptions: {},
		fontFamily,
		fontSize,
		lineHeight: 1,
		theme
	};
}

/** The theme from the design tokens of the page around `element`, so a terminal follows light and dark. */
export function terminalTheme(element: Element): ITheme {
	const style = getComputedStyle(element);
	const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
	const ink = token('--ink', '#ece9e4');
	const muted = token('--ink-muted', '#a8a6b2');
	const red = token('--danger', '#ff6f86');
	const green = token('--ok', '#62c287');
	const yellow = token('--warn', '#d6b24c');
	const blue = token('--denim', '#8fb0f5');
	const magenta = token('--term-magenta', '#d99be8');
	const cyan = token('--term-cyan', '#6cc9d1');
	return {
		background: token('--bg-rail', '#0b0b12'),
		foreground: ink,
		// A program's cursor is where it would write next: nothing to show a reader.
		cursor: 'rgba(0, 0, 0, 0)',
		cursorAccent: 'rgba(0, 0, 0, 0)',
		selectionBackground: token('--denim-soft', '#1e2b48'),
		selectionForeground: ink,
		black: token('--line-strong', '#6d6d80'),
		red, green, yellow, blue, magenta, cyan,
		white: ink,
		brightBlack: muted,
		brightRed: red, brightGreen: green, brightYellow: yellow, brightBlue: blue, brightMagenta: magenta, brightCyan: cyan,
		brightWhite: ink
	};
}

/** The monospace face of the page around `element`. */
function monoFont(element: Element): string {
	return getComputedStyle(element).getPropertyValue('--font-mono').trim() || 'monospace';
}

/** A face's advance width per pixel of size, measured on the page. */
function advanceRatio(host: HTMLElement, fontFamily: string): number {
	const probe = document.createElement('span');
	probe.textContent = 'W'.repeat(40);
	probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-family:${fontFamily};font-size:100px;line-height:1`;
	host.append(probe);
	const width = probe.getBoundingClientRect().width;
	probe.remove();
	return width > 0 ? width / 40 / 100 : 0.6;
}

/** The size that fits the 80 columns in `width` pixels, in quarter pixels, between the smallest and largest. */
export function terminalFontSize(width: number, ratio: number): number {
	const fit = Math.floor((width / (TERMINAL_COLS * ratio)) * 4) / 4;
	return Math.max(TERMINAL_FONT_MIN, Math.min(TERMINAL_FONT_MAX, fit));
}

/** The rows to show: all 40 on the alternate screen, else down to the last one written, at least one. */
export function shownRows(buffer: IBuffer): number {
	if (buffer.type === 'alternate' || buffer.baseY > 0) return TERMINAL_ROWS;
	for (let y = TERMINAL_ROWS - 1; y > 0; y--) {
		const line = buffer.getLine(y);
		if (!line) continue;
		if (line.translateToString(true).trim()) return y + 1;
		// A row of colored blanks, such as a bar, is written too.
		for (let x = 0; x < line.length; x++) if (!line.getCell(x)?.isBgDefault()) return y + 1;
	}
	return 1;
}

/** Full reset (RIS): the initial state of a terminal. */
const RESET = '\u001bc';

/** Pointer gestures that scroll: the page's, never the terminal's, which has nothing to scroll and would send them on as keys. */
const SCROLLS = ['wheel', 'touchstart', 'touchmove'] as const;

export class TerminalScreen {
	readonly #host: HTMLElement;
	#terminal: Terminal | undefined;
	#disposed = false;
	/** What was asked before xterm loaded, played in order once it has. */
	#queue: Array<(terminal: Terminal) => void> = [];
	#frame: number | undefined;
	#observer: ResizeObserver | undefined;
	#themeWatch: (() => void) | undefined;
	#ratio = 0.6;
	readonly #keep = (event: Event) => event.stopPropagation();

	/** Mounts a terminal in `host`, a box the page sizes; `load` stands in for loading xterm, in tests. */
	constructor(host: HTMLElement, load: () => Promise<Xterm> = loadXterm) {
		this.#host = host;
		for (const type of SCROLLS) host.addEventListener(type, this.#keep, { capture: true, passive: true });
		load().then((xterm) => this.#open(xterm), () => {
			if (!this.#disposed) host.dataset.failed = '';
		});
	}

	/** A fresh terminal: the initial state, default colors and attributes, nothing on screen. */
	reset(): void {
		// RIS (ESC c), in the same queue as the writes before and after it: xterm parses what it is given later.
		this.#run((terminal) => terminal.write(RESET));
	}

	/** Writes output as it arrives: bytes of UTF-8, which may stop mid-character, or text. */
	write(data: Uint8Array | string): void {
		this.#run((terminal) => terminal.write(data));
	}

	/** Shows `output` from a fresh terminal, such as a finished embed's. */
	show(output: string): void {
		this.reset();
		this.write(output);
	}

	dispose(): void {
		this.#disposed = true;
		this.#queue = [];
		for (const type of SCROLLS) this.#host.removeEventListener(type, this.#keep, { capture: true });
		this.#observer?.disconnect();
		this.#themeWatch?.();
		if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
		this.#terminal?.dispose();
		this.#terminal = undefined;
	}

	#run(step: (terminal: Terminal) => void): void {
		if (this.#disposed) return;
		if (this.#terminal) step(this.#terminal);
		else this.#queue.push(step);
	}

	#open(xterm: Xterm): void {
		if (this.#disposed) return;
		const host = this.#host;
		const fontFamily = monoFont(host);
		this.#ratio = advanceRatio(host, fontFamily);
		const terminal = new xterm.Terminal(terminalOptions(terminalTheme(host), fontFamily, terminalFontSize(host.clientWidth, this.#ratio)));
		// Swallowed, not acted on: window titles (OSC 0, 1, 2) and the clipboard (OSC 52).
		for (const osc of [0, 1, 2, 52]) terminal.parser.registerOscHandler(osc, () => true);
		const screen = document.createElement('div');
		host.append(screen);
		terminal.open(screen);
		// Not a stop on the way through the page: nothing can be typed into it.
		if (terminal.textarea) {
			terminal.textarea.tabIndex = -1;
			terminal.textarea.setAttribute('aria-hidden', 'true');
		}
		terminal.onWriteParsed(() => this.#schedule());
		terminal.buffer.onBufferChange(() => this.#schedule());
		this.#terminal = terminal;
		if (typeof ResizeObserver === 'function') {
			this.#observer = new ResizeObserver(() => this.#fit());
			this.#observer.observe(host);
		}
		this.#themeWatch = watchTheme(() => {
			terminal.options.theme = terminalTheme(host);
		});
		for (const step of this.#queue.splice(0)) step(terminal);
		this.#fit();
	}

	/** The font that fits the columns in the host's width; checked against what xterm drew, as faces round. */
	#fit(): void {
		const terminal = this.#terminal;
		if (!terminal) return;
		const width = this.#host.clientWidth;
		if (!width) return;
		let size = terminalFontSize(width, this.#ratio);
		if (terminal.options.fontSize !== size) terminal.options.fontSize = size;
		const drawn = this.#screenElement()?.getBoundingClientRect().width ?? 0;
		if (drawn > width && size > TERMINAL_FONT_MIN) {
			size = Math.max(TERMINAL_FONT_MIN, Math.floor(size * (width / drawn) * 4) / 4);
			terminal.options.fontSize = size;
		}
		this.#host.dataset.fontSize = String(terminal.options.fontSize);
		this.#schedule();
	}

	#screenElement(): HTMLElement | null {
		return this.#host.querySelector<HTMLElement>('.xterm-screen');
	}

	/** The shown rows, at most once a frame, after the output and the layout it changed. */
	#schedule(): void {
		if (this.#frame !== undefined || this.#disposed) return;
		this.#frame = requestAnimationFrame(() => {
			this.#frame = undefined;
			const terminal = this.#terminal;
			const screen = this.#screenElement();
			if (!terminal || !screen) return;
			const rows = shownRows(terminal.buffer.active);
			const rowHeight = screen.getBoundingClientRect().height / TERMINAL_ROWS;
			this.#host.style.height = `${Math.ceil(rows * rowHeight)}px`;
			this.#host.dataset.rows = String(rows);
		});
	}
}

/** Calls `changed` when the page's theme changes: Preferences (`data-theme`) or the system's light or dark. */
function watchTheme(changed: () => void): () => void {
	const root = document.documentElement;
	const observer = new MutationObserver(changed);
	observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
	const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : undefined;
	query?.addEventListener('change', changed);
	return () => {
		observer.disconnect();
		query?.removeEventListener('change', changed);
	};
}
