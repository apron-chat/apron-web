import type { IBuffer, ITerminalInitOnlyOptions, ITerminalOptions, ITheme, Terminal } from '@xterm/xterm';
import { loadXterm, type Xterm } from './xterm';

/**
 * The screen of a `terminal` embed (§4.8.6): xterm.js, 80 columns by 40
 * rows, loaded only once a terminal embed is shown. It only reads: no input,
 * and nothing a program prints acts outside it. It never sends xterm's
 * replies anywhere, ignores title changes, the bell and the clipboard
 * (OSC 52), and opens no links (OSC 8). The font is scaled so the 80 columns
 * fit the space it has (`TerminalFit`): in a message, up to TERMINAL_FONT_MAX;
 * in the full-screen viewer, the 40 rows too where the screen is tall enough,
 * and never below a readable size. Rows below the last one written are
 * hidden, unless a program is using the alternate screen. In a message it
 * keeps no scrollback (a glance; a wheel or swipe over it scrolls the page);
 * the viewer keeps VIEWER_SCROLLBACK lines to scroll back through.
 */

export const TERMINAL_COLS = 80;
export const TERMINAL_ROWS = 40;
/** The largest font, for a wide screen: a comfortable size for reading a log. */
export const TERMINAL_FONT_MAX = 13;
/** The smallest it goes, however narrow the space. */
export const TERMINAL_FONT_MIN = 4;
/** The full-screen viewer's smallest: readable on a phone. A narrower space scrolls sideways, inside the viewer. */
export const TERMINAL_VIEWER_FONT_MIN = 9;
/** The viewer's largest, for a big screen. */
export const TERMINAL_VIEWER_FONT_MAX = 24;

/**
 * The lines that scroll off the top the full-screen viewer keeps (§4.8.6 allows it), to scroll back through: a long
 * build's log, at about a kilobyte a line in xterm's buffer (80 cells), some 5 MB at most, and only while the viewer
 * is open. A message's screen keeps none.
 */
export const VIEWER_SCROLLBACK = 5000;

/** How a screen's font fits its space: between `min` and `max`, its 80 columns in the width, and with `rows` its 40 rows in the height too. */
export interface TerminalFit {
	min: number;
	max: number;
	/**
	 * Fit the 40 rows in the height as well, down to this size: a shorter space (a phone on its side) keeps this
	 * size and scrolls, rather than shrink the text further.
	 */
	rows?: number;
}

/** In a message: the columns in the message's width, small as that is on a phone (the page never scrolls sideways). */
export const INLINE_FIT: TerminalFit = { min: TERMINAL_FONT_MIN, max: TERMINAL_FONT_MAX };
/**
 * Full screen: the whole screen, 80 by 40, as large as fits, but never too small to read. The rows fit the height
 * down to the size a message shows on a desktop; on a shorter screen it scrolls up and down instead.
 */
export const VIEWER_FIT: TerminalFit = { min: TERMINAL_VIEWER_FONT_MIN, max: TERMINAL_VIEWER_FONT_MAX, rows: TERMINAL_FONT_MAX };

/** The options every terminal embed's xterm is made with; `scrollback`, the lines it keeps above the screen, 0 unless said. */
export function terminalOptions(theme: ITheme, fontFamily: string, fontSize: number, scrollback = 0): ITerminalOptions & ITerminalInitOnlyOptions {
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
		// In a message, the screen as a terminal shows it: what scrolls off its top is gone. The viewer keeps some.
		scrollback,
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

/** A face's advance width and line height per pixel of size, measured on the page. */
function faceRatios(host: HTMLElement, fontFamily: string): { advance: number; line: number } {
	const probe = document.createElement('span');
	probe.textContent = 'W'.repeat(40);
	probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-family:${fontFamily};font-size:100px;line-height:normal`;
	host.append(probe);
	const { width, height } = probe.getBoundingClientRect();
	probe.remove();
	return { advance: width > 0 ? width / 40 / 100 : 0.6, line: height > 0 ? height / 100 : 1.2 };
}

/**
 * The size that fits the 80 columns in `width` pixels (and, for a fit with `rows`, the 40 rows in `height`, down
 * to that size), in quarter pixels, between the fit's smallest and largest. `ratio` is the face's advance and
 * `line` its row height, per pixel of size.
 */
export function terminalFontSize(width: number, ratio: number, fit: TerminalFit = INLINE_FIT, height = Infinity, line = 1.2): number {
	let size = width / (TERMINAL_COLS * ratio);
	if (fit.rows !== undefined) size = Math.min(size, Math.max(fit.rows, height / (TERMINAL_ROWS * line)));
	return Math.max(fit.min, Math.min(fit.max, Math.floor(size * 4) / 4));
}

/** How a `TerminalScreen` is made. */
export interface TerminalScreenOptions {
	/** How its font fits its space; INLINE_FIT unless said. */
	fit?: TerminalFit;
	/** The box whose content area is the space to fit, such as the viewer's stage around it; the host unless said. */
	space?: HTMLElement;
	/**
	 * The lines it keeps that scroll off the top (`VIEWER_SCROLLBACK` in the viewer), 0 unless said. With some, a
	 * wheel, a vertical swipe or a key (on `keys`) over the space scrolls through them and the screen as one
	 * (`scrollBy`), rather than the page.
	 */
	scrollback?: number;
	/** Where its scrolling keys are read, such as the viewer's dialog, with scrollback. */
	keys?: HTMLElement;
	/** Stands in for loading xterm, in tests. */
	load?: () => Promise<Xterm>;
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

/** The keys that scroll a screen with scrollback, in lines (a page is the rows in view less one; ±Infinity, all the way). */
const SCROLL_KEYS: Record<string, number | 'page'> = { ArrowUp: -1, ArrowDown: 1, PageUp: 'page', PageDown: 'page', Home: -Infinity, End: Infinity };

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
	#line = 1.2;
	readonly #fitting: TerminalFit;
	readonly #space: HTMLElement;
	readonly #scrollback: number;
	readonly #keys: HTMLElement | undefined;
	/** A scroll too small to move a line yet, in pixels, kept until the next in the same direction. */
	#owed = 0;
	/** Where a one-finger swipe last was. */
	#touchY: number | undefined;
	/** With scrollback, whether its space is scrolled to the screen's foot, where the newest line is: it stays there. */
	#atFoot = true;
	readonly #keep = (event: Event) => event.stopPropagation();

	/** Mounts a terminal in `host`, a box the page sizes, fitted to `options.space` (the host itself unless said). */
	constructor(host: HTMLElement, { fit = INLINE_FIT, space = host, scrollback = 0, keys, load = loadXterm }: TerminalScreenOptions = {}) {
		this.#host = host;
		this.#fitting = fit;
		this.#space = space;
		this.#scrollback = scrollback;
		this.#keys = keys;
		if (scrollback > 0) {
			// One scroll for the lines kept and the stage (`scrollBy`), read before xterm's own. Sideways is the stage's.
			space.addEventListener('wheel', this.#wheel, { capture: true, passive: false });
			space.addEventListener('touchstart', this.#touchstart, { capture: true, passive: true });
			space.addEventListener('touchmove', this.#touchmove, { capture: true, passive: true });
			space.addEventListener('scroll', this.#scrolled, { passive: true });
			space.style.touchAction = 'pan-x pinch-zoom';
			keys?.addEventListener('keydown', this.#keydown);
		} else for (const type of SCROLLS) host.addEventListener(type, this.#keep, { capture: true, passive: true });
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

	/**
	 * Scrolls by `pixels` (down if positive) through all there is to see as one: the lines kept above the screen, then
	 * the screen, which its space scrolls where the 40 rows are taller than it (a phone on its side). Back, the space
	 * stays at the screen's foot, where the newest line is, until there are no more lines above; forward, it reaches
	 * the foot first. The lines move whole, a part of one owed to the next scroll the same way.
	 */
	scrollBy(pixels: number): void {
		const terminal = this.#terminal;
		const row = this.#rowHeight();
		if (!terminal || !row || !pixels) return;
		if (Math.sign(pixels) !== Math.sign(this.#owed)) this.#owed = 0;
		this.#owed += pixels;
		const space = this.#space;
		const { viewportY, baseY } = terminal.buffer.active;
		if (this.#owed < 0) {
			const lines = Math.min(viewportY, Math.floor(-this.#owed / row));
			if (lines) terminal.scrollLines(-lines);
			this.#owed += lines * row;
			if (lines < viewportY) return;
			space.scrollTop = Math.max(0, space.scrollTop + this.#owed);
		} else {
			const room = Math.max(0, space.scrollHeight - space.clientHeight - space.scrollTop);
			const stage = Math.min(room, this.#owed);
			if (stage > 0) space.scrollTop += stage;
			this.#owed -= stage;
			const below = baseY - viewportY;
			const lines = Math.min(below, Math.floor(this.#owed / row));
			if (lines) terminal.scrollLines(lines);
			this.#owed -= lines * row;
			if (lines < below) return;
		}
		this.#owed = 0;
	}

	dispose(): void {
		this.#disposed = true;
		this.#queue = [];
		for (const type of SCROLLS) this.#host.removeEventListener(type, this.#keep, { capture: true });
		this.#space.removeEventListener('wheel', this.#wheel, { capture: true });
		this.#space.removeEventListener('touchstart', this.#touchstart, { capture: true });
		this.#space.removeEventListener('touchmove', this.#touchmove, { capture: true });
		this.#space.removeEventListener('scroll', this.#scrolled);
		if (this.#scrollback > 0) this.#space.style.touchAction = '';
		this.#keys?.removeEventListener('keydown', this.#keydown);
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
		({ advance: this.#ratio, line: this.#line } = faceRatios(host, fontFamily));
		const space = this.#room();
		const terminal = new xterm.Terminal(terminalOptions(terminalTheme(host), fontFamily, terminalFontSize(space.width, this.#ratio, this.#fitting, space.height, this.#line), this.#scrollback));
		// Swallowed, not acted on: window titles (OSC 0, 1, 2) and the clipboard (OSC 52).
		for (const osc of [0, 1, 2, 52]) terminal.parser.registerOscHandler(osc, () => true);
		// No key is xterm's, once a click has focused it: Escape, the arrows and Page Up reach the page (or the viewer) as if
		// it weren't there, and copying is the browser's.
		terminal.attachCustomKeyEventHandler(() => false);
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
			this.#observer.observe(this.#space);
		}
		this.#themeWatch = watchTheme(() => {
			terminal.options.theme = terminalTheme(host);
		});
		for (const step of this.#queue.splice(0)) step(terminal);
		this.#fit();
	}

	/** The space to fit: the content area of the space box. */
	#room(): { width: number; height: number } {
		const space = this.#space;
		const style = getComputedStyle(space);
		const padding = (a: string, b: string) => (parseFloat(style.getPropertyValue(a)) || 0) + (parseFloat(style.getPropertyValue(b)) || 0);
		return {
			width: Math.max(0, space.clientWidth - padding('padding-left', 'padding-right')),
			height: Math.max(0, space.clientHeight - padding('padding-top', 'padding-bottom'))
		};
	}

	/** The font that fits the space (`TerminalFit`); checked against what xterm drew, as faces round. */
	#fit(): void {
		const terminal = this.#terminal;
		if (!terminal) return;
		const fit = this.#fitting;
		const { width, height } = this.#room();
		if (!width) return;
		let size = terminalFontSize(width, this.#ratio, fit, height, this.#line);
		if (terminal.options.fontSize !== size) terminal.options.fontSize = size;
		const drawn = this.#screenElement()?.getBoundingClientRect();
		if (drawn) {
			let fits = size;
			if (drawn.width > width) fits = size * (width / drawn.width);
			if (fit.rows !== undefined && height && drawn.height > height) fits = Math.min(fits, Math.max(fit.rows, size * (height / drawn.height)));
			fits = Math.max(fit.min, Math.floor(fits * 4) / 4);
			if (fits < size) terminal.options.fontSize = size = fits;
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
			// With scrollback, a space at the screen's foot (the newest line), as it opens, stays there as the screen grows.
			if (this.#scrollback > 0 && this.#atFoot) this.#space.scrollTop = this.#space.scrollHeight;
		});
	}

	readonly #scrolled = (): void => {
		const space = this.#space;
		this.#atFoot = space.scrollTop >= space.scrollHeight - space.clientHeight - 1;
	};

	/** The height of a row as drawn; 0 before it is. */
	#rowHeight(): number {
		return (this.#screenElement()?.getBoundingClientRect().height ?? 0) / TERMINAL_ROWS;
	}

	/** A wheel up and down scrolls it (`scrollBy`), and never xterm; sideways, or a pinch (with Ctrl), is the browser's. */
	readonly #wheel = (event: WheelEvent): void => {
		event.stopPropagation();
		if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
		event.preventDefault();
		const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? this.#rowHeight() : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.#space.clientHeight : 1;
		this.scrollBy(event.deltaY * unit);
	};

	/** A one-finger swipe up and down scrolls it (`scrollBy`): the space leaves vertical panning to it (`touch-action`). */
	readonly #touchstart = (event: TouchEvent): void => {
		this.#touchY = event.touches.length === 1 ? event.touches[0].clientY : undefined;
		this.#owed = 0;
	};

	readonly #touchmove = (event: TouchEvent): void => {
		if (this.#touchY === undefined || event.touches.length !== 1) return;
		const y = event.touches[0].clientY;
		this.scrollBy(this.#touchY - y);
		this.#touchY = y;
	};

	/** ↑ and ↓ a line, Page Up and Page Down the rows in view less one, Home and End all the way; with no Ctrl, Alt or Meta. */
	readonly #keydown = (event: KeyboardEvent): void => {
		const step = SCROLL_KEYS[event.key];
		if (step === undefined || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
		const row = this.#rowHeight();
		if (!this.#terminal || !row) return;
		event.preventDefault();
		if (step === -Infinity || step === Infinity) {
			if (step < 0) this.#terminal.scrollToTop();
			else this.#terminal.scrollToBottom();
			this.#space.scrollTop = step < 0 ? 0 : this.#space.scrollHeight;
			this.#owed = 0;
			return;
		}
		const page = Math.max(1, Math.min(TERMINAL_ROWS, Math.floor(this.#space.clientHeight / row)) - 1);
		const lines = step === 'page' ? page * (event.key === 'PageUp' ? -1 : 1) : step;
		this.#owed = 0;
		this.scrollBy(lines * row);
	};
}

/** What a `TerminalFeed` writes to: a `TerminalScreen`. */
export type TerminalSink = Pick<TerminalScreen, 'reset' | 'write' | 'show'>;

/**
 * One terminal embed's text, decoded, for every screen that shows it: the one
 * in its message and, while it is open, the full-screen viewer's. It keeps
 * what was written since the last reset, so a screen attached later starts
 * from the same text (all 80 by 40 of a terminal's state follows from it) and
 * then gets what arrives, without reading the live text a second time.
 */
export class TerminalFeed {
	#text = '';
	readonly #screens = new Set<TerminalSink>();

	/** The text since the last reset, as written. */
	get text(): string {
		return this.#text;
	}

	/** Starts afresh, such as for a reconnect's new response. */
	reset(): void {
		this.#text = '';
		for (const screen of this.#screens) screen.reset();
	}

	/** The next of the text. */
	write(text: string): void {
		if (!text) return;
		this.#text += text;
		for (const screen of this.#screens) screen.write(text);
	}

	/** Replaces it with `output`, such as a finished embed's, from a fresh terminal. */
	show(output: string): void {
		this.#text = output;
		for (const screen of this.#screens) screen.show(output);
	}

	/** Shows the text so far on `screen`, a fresh one, then all that follows, until the function returned is called. */
	attach(screen: TerminalSink): () => void {
		if (this.#text) screen.show(this.#text);
		this.#screens.add(screen);
		return () => this.#screens.delete(screen);
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
