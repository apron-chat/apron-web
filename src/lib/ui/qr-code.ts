import { generate } from 'lean-qr/nano';
import { toSvgPath } from 'lean-qr/extras/svg';

/** A QR code as one SVG path: `size` modules a side, the dark ones drawn by `path` in a `0 0 size size` box. */
export interface QrCode {
	size: number;
	path: string;
}

/** `text` as a QR code, or undefined when it is too long for one. */
export function qrCode(text: string): QrCode | undefined {
	try {
		const code = generate(text);
		return { size: code.size, path: toSvgPath(code) };
	} catch {
		return undefined;
	}
}
