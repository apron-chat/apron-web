import { vi } from 'vitest';
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

/** A screen's buffer: `rows` lines (the rest blank), normal or alternate, scrolled by `baseY`. */
export function fakeBuffer(rows: ReturnType<typeof fakeLine>[] = [], type: 'normal' | 'alternate' = 'normal', baseY = 0) {
	return { type, baseY, getLine: (y: number) => rows[y] ?? fakeLine() };
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
	buffer = { active: fakeBuffer(), onBufferChange: this.listen('onBufferChange') };
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

	reset(): void {
		this.written.push('<reset()>');
	}

	dispose(): void {
		this.disposed = true;
	}
}

/** The module `loadXterm` resolves to, with the fake in place of `Terminal`. */
export const fakeXterm = { Terminal: FakeTerminal } as unknown as Xterm;

/** A `loadXterm` that resolves when the test says so. */
export function deferredXterm() {
	let resolve!: (module: Xterm) => void;
	const promise = new Promise<Xterm>((done) => (resolve = done));
	return { load: vi.fn(() => promise), resolve: () => resolve(fakeXterm) };
}
