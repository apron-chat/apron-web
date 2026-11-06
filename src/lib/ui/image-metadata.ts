/**
 * Cuts an animated image's metadata out of its file without re-encoding it (`prepareUpload` in `images.ts`, which
 * loads this only for an animated image that carries metadata).
 */
import { ascii, type ImageFacts } from './images';

/** PNG's chunks that carry metadata: EXIF, and text, where XMP rides. */
const PNG_METADATA = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);
/** WebP's, and the VP8X flags that say it has them. */
const WEBP_METADATA = new Set(['EXIF', 'XMP ']);
const WEBP_METADATA_FLAGS = 0x0c;

/**
 * An image's bytes without its metadata chunks and with nothing re-encoded, so
 * an animation keeps every frame: a PNG's EXIF and text chunks (each chunk has
 * a checksum of its own, so the rest stand as they are); a WebP's EXIF and XMP
 * chunks, its flags for them cleared and its size made to match. Whatever
 * follows the image's end goes too. Undefined for bytes it can't follow chunk
 * by chunk to that end.
 */
export function stripMetadata(bytes: Uint8Array, type: ImageFacts['type']): Uint8Array | undefined {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const kept: Uint8Array[] = [];
	if (type === 'image/png') {
		kept.push(bytes.subarray(0, 8));
		for (let offset = 8; offset + 12 <= bytes.length;) {
			const end = offset + 12 + view.getUint32(offset);
			if (end > bytes.length) return undefined;
			const chunk = ascii(bytes, offset + 4, 4);
			if (!PNG_METADATA.has(chunk)) kept.push(bytes.subarray(offset, end));
			if (chunk === 'IEND') return concat(kept);
			offset = end;
		}
		return undefined;
	}
	// Metadata comes only in the extended format, whose VP8X chunk, first, holds its flags.
	if (type !== 'image/webp' || bytes.length < 30 || ascii(bytes, 12, 4) !== 'VP8X' || view.getUint32(16, true) !== 10) return undefined;
	const end = 8 + view.getUint32(4, true);
	if (end > bytes.length) return undefined;
	kept.push(bytes.subarray(0, 12));
	for (let offset = 12; offset < end;) {
		if (offset + 8 > end) return undefined;
		// Each chunk is padded to an even length.
		const size = view.getUint32(offset + 4, true);
		const next = offset + 8 + size + (size & 1);
		if (next > end) return undefined;
		if (!WEBP_METADATA.has(ascii(bytes, offset, 4))) kept.push(bytes.subarray(offset, next));
		offset = next;
	}
	const stripped = concat(kept);
	new DataView(stripped.buffer).setUint32(4, stripped.length - 8, true);
	stripped[20] &= ~WEBP_METADATA_FLAGS;
	return stripped;
}

function concat(parts: Uint8Array[]): Uint8Array {
	const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		whole.set(part, offset);
		offset += part.length;
	}
	return whole;
}
