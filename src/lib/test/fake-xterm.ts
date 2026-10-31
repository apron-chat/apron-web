import { vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import type { Xterm } from '$lib/ui/xterm';

/** A buffer line for `shownRows`: its text, and the columns with a background color. */
export function fakeLine(text = '', colored: number[] = []) {
	return {
		length: 80,
		isWrapped: false,
		translateToString: (trimRight?: boolean) => (trimRight ? text.trimEnd() : text.padEnd(80)),
		getCell: (x: number) => ({ isBgDefault: () => !colored.includes(x) })
	};
}

/** A screen's buffer: `rows` lines (the rest blank), normal or alternate, scrolled by `baseY`, in view at the foot. */
export function fakeBuffer(rows: ReturnType<typeof fakeLine>[] = [], type: 'normal' | 'alternate' = 'normal', baseY = 0) {
	return { type, baseY, viewportY: baseY, getLine: (y: number) => rows[y] ?? fakeLine() };
}

/**
 * Stands in for xterm.js's `Terminal`: records its options, what is written, the OSC handlers registered, and every
 * event subscribed to, so a test can tell nothing listens for input, titles or the bell.
 */
export class FakeTerminal {
	static made: FakeTerminal[] = [];
	options: Record<string, unknown>;
	written: Array<string | Uint8Array> = [];
	oscs = new Map<number, (data: string) => boolean | Promise<boolean>>();
	subscribed: string[] = [];
	textarea: HTMLTextAreaElement | undefined;
	element: HTMLElement | undefined;
	disposed = false;
	/** What `attachCustomKeyEventHandler` was given: whether xterm may handle a key. */
	keyHandler: ((event: KeyboardEvent) => boolean) | undefined;
	buffer: { readonly active: Pick<Terminal['buffer']['active'], 'type' | 'baseY' | 'viewportY' | 'getLine'>; onBufferChange: unknown } = { active: fakeBuffer() as never, onBufferChange: this.listen('onBufferChange') };
	parser = {
		registerOscHandler: (ident: number, callback: (data: string) => boolean | Promise<boolean>) => {
			this.oscs.set(ident, callback);
			return { dispose: () => this.oscs.delete(ident) };
		}
	};
	onWriteParsed = this.listen('onWriteParsed');
	onData = this.listen('onData');
	onBinary = this.listen('onBinary');
	onTitleChange = this.listen('onTitleChange');
	onBell = this.listen('onBell');
	onKey = this.listen('onKey');

	constructor(options: Record<string, unknown> = {}) {
		this.options = { ...options };
		FakeTerminal.made.push(this);
	}

	private listen(name: string) {
		return (_listener: unknown) => {
			this.subscribed.push(name);
			return { dispose() {} };
		};
	}

	open(parent: HTMLElement): void {
		this.element = document.createElement('div');
		const screen = document.createElement('div');
		screen.className = 'xterm-screen';
		this.textarea = document.createElement('textarea');
		this.element.append(this.textarea, screen);
		parent.append(this.element);
	}

	write(data: string | Uint8Array): void {
		this.written.push(data);
	}

	attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
		this.keyHandler = handler;
	}

	scrollLines(lines: number): void {
		const buffer = this.buffer.active as { viewportY: number; baseY: number };
		buffer.viewportY = Math.max(0, Math.min(buffer.baseY, buffer.viewportY + lines));
	}

	scrollToTop(): void {
		this.scrollLines(-Infinity);
	}

	scrollToBottom(): void {
		this.scrollLines(Infinity);
	}

	reset(): void {
		this.written.push('<reset()>');
	}

	dispose(): void {
		this.disposed = true;
	}
}

/** The module `loadXterm` resolves to, with the fake in place of `Terminal`. */
export const fakeXterm = { Terminal: FakeTerminal } as unknown as Xterm;

/**
 * The fake, recording as it does, around a real xterm.js terminal that is never opened (jsdom can't draw one): what is
 * written is parsed, into a buffer of the options' size and scrollback, which scrolls as xterm's does.
 */
export class HeadlessTerminal extends FakeTerminal {
	readonly real: Terminal;

	constructor(real: Terminal, options: Record<string, unknown>) {
		super(options);
		this.real = real;
		this.buffer = { get active() { return real.buffer.active; }, onBufferChange: this.buffer.onBufferChange };
	}

	override write(data: string | Uint8Array): void {
		super.write(data);
		this.real.write(data);
	}

	/** Once what was written is parsed. */
	parsed(): Promise<void> {
		return new Promise((resolve) => this.real.write('', resolve));
	}

	override scrollLines(lines: number): void {
		this.real.scrollLines(lines);
	}

	override scrollToTop(): void {
		this.real.scrollToTop();
	}

	override scrollToBottom(): void {
		this.real.scrollToBottom();
	}
}

/** `loadXterm` for `HeadlessTerminal`s: real xterm.js, never drawn. */
export async function headlessXterm(): Promise<Xterm> {
	const xterm = await import('@xterm/xterm');
	return { Terminal: class extends HeadlessTerminal {
		constructor(options: Record<string, unknown>) {
			super(new xterm.Terminal(options), options);
		}
	} } as unknown as Xterm;
}

/** A `loadXterm` that resolves when the test says so. */
export function deferredXterm() {
	let resolve!: (module: Xterm) => void;
	const promise = new Promise<Xterm>((done) => (resolve = done));
	return { load: vi.fn(() => promise), resolve: () => resolve(fakeXterm) };
}
