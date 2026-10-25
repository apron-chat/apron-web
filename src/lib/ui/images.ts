/**
 * Shrinks images before they're uploaded (capability `embed:upload`, §4.8.4, and
 * `/avatar`, §4.8.6). Photos are always re-encoded, so their EXIF (GPS
 * location included) never reaches the server, which stores bytes as sent.
 * Large images are scaled so their longest side fits and encoded as WebP, or
 * JPEG where the browser can't encode WebP, stepping the quality down until
 * the file fits. Animated images can't go through a canvas without losing
 * their animation: they're sent unchanged.
 *
 * What fits is the client's own preference, below, unless the server states
 * its limits (`ext:media`, EXT.md §6): then a file goes out only as a type the
 * server takes, within that type's limits, and one that can't is refused here.
 * Without stated limits nothing is refused here: the server's 413 or 415 decides.
 */

import { mediaLimit, type MediaTypes } from '$lib/protocol/client';

/** What the client aims for: uploads under 5 MB, avatars under 256 KB. */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MAX_BYTES = 256 * 1024;
/** The longest side an uploaded image is scaled to. */
export const UPLOAD_MAX_SIDE = 2048;
/** Avatar squares, largest first: the first that fits under the limit wins. */
export const AVATAR_SIDES = [512, 256];
/** What an image is re-encoded as, by preference: WebP, else JPEG where the browser can't encode WebP. */
const ENCODINGS = ['image/webp', 'image/jpeg'];
const QUALITIES = [0.85, 0.75, 0.65, 0.6];
/** How far a too-large image shrinks per step once the quality floor is reached, and the smallest side tried. */
const SHRINK = 0.75;
const MIN_SIDE = 320;

/** A file ready to upload, with the image's dimensions when it is one. */
export interface Attachment {
	file: File;
	width?: number;
	height?: number;
}

export interface ImageFacts {
	type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
	/** More than one frame: GIF, APNG, or animated WebP. */
	animated: boolean;
	/** Carries EXIF or XMP that may hold a location (always assumed for JPEG). */
	metadata: boolean;
}

export interface DecodedImage {
	width: number;
	height: number;
	close?(): void;
}

/** Decoding and encoding, injectable so the sizing logic can be tested without a canvas. */
export interface ImageCodec {
	decode(blob: Blob): Promise<DecodedImage>;
	/** Draws `crop` of the image at `width`×`height` and encodes it; the Blob's type is what the browser actually produced. */
	encode(image: DecodedImage, crop: Crop, width: number, height: number, type: string, quality: number): Promise<Blob>;
}

export interface Crop {
	x: number;
	y: number;
	width: number;
	height: number;
}

export class ImageTooLargeError extends Error {}

/** A file the server said it doesn't take (`ext:media`): of a type it doesn't list, or larger than that type's limit. */
export class NotAcceptedError extends Error {}

/**
 * Identifies an image from its first bytes, as a server that reads content
 * would: PNG, JPEG, GIF, or WebP. Anything else is undefined.
 */
export function sniffImage(bytes: Uint8Array): ImageFacts | undefined {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return { type: 'image/jpeg', animated: false, metadata: true };
	}
	if (ascii(bytes, 1, 3) === 'PNG' && bytes[0] === 0x89) return sniffPng(bytes);
	if (ascii(bytes, 0, 4) === 'GIF8') return { type: 'image/gif', animated: gifFrames(bytes) > 1, metadata: false };
	if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
		// Only the extended format (VP8X) carries animation or metadata, flagged in its first byte.
		const flags = ascii(bytes, 12, 4) === 'VP8X' ? bytes[20] ?? 0 : 0;
		return { type: 'image/webp', animated: (flags & 0x02) !== 0, metadata: (flags & 0x0c) !== 0 };
	}
	return undefined;
}

function sniffPng(bytes: Uint8Array): ImageFacts {
	let animated = false;
	let metadata = false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 8; offset + 8 <= bytes.length;) {
		const length = view.getUint32(offset);
		const type = ascii(bytes, offset + 4, 4);
		if (type === 'acTL') animated = true;
		else if (type === 'eXIf') metadata = true;
		// XMP rides in a text chunk; only a location in it matters.
		else if ((type === 'iTXt' || type === 'tEXt') && ascii(bytes, offset + 8, Math.min(length, bytes.length - offset - 8)).includes('GPS')) metadata = true;
		else if (type === 'IDAT' || type === 'IEND') break;
		offset += 12 + length;
	}
	return { type: 'image/png', animated, metadata };
}

/** Counts a GIF's frames, stopping at the second: its blocks walked from the header on. */
function gifFrames(bytes: Uint8Array): number {
	let offset = 13;
	if (bytes.length < offset) return 0;
	if (bytes[10] & 0x80) offset += 3 * (1 << ((bytes[10] & 0x07) + 1));
	let frames = 0;
	const skipSubBlocks = () => {
		while (offset < bytes.length && bytes[offset] !== 0) offset += bytes[offset] + 1;
		offset += 1;
	};
	while (offset < bytes.length) {
		const block = bytes[offset];
		if (block === 0x2c) {
			if (++frames > 1) return frames;
			const packed = bytes[offset + 9] ?? 0;
			offset += 10;
			if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
			offset += 1; // LZW minimum code size
			skipSubBlocks();
		} else if (block === 0x21) {
			offset += 2;
			skipSubBlocks();
		} else {
			break; // trailer, or bytes we don't understand
		}
	}
	return frames;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
	let text = '';
	for (let index = start; index < start + length && index < bytes.length; index++) text += String.fromCharCode(bytes[index]);
	return text;
}

/** Scales `width`×`height` down so the longest side is at most `max`; never up. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
	const scale = Math.min(1, max / Math.max(width, height));
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The largest centered square. */
export function centerSquare(width: number, height: number): Crop {
	const side = Math.min(width, height);
	return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side };
}

/** `photo.jpg` → `photo.webp`. */
function renamed(name: string, type: string): string {
	const extension = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
	const base = name.replace(/\.[^./\\]*$/, '') || 'image';
	return `${base}.${extension}`;
}

async function headOf(file: Blob): Promise<Uint8Array> {
	// The chunks we look for sit before the pixel data; for a GIF, frames are counted through the file.
	const slice = file.type === 'image/gif' ? file : file.slice(0, 256 * 1024);
	return new Uint8Array(await slice.arrayBuffer());
}

/** The type a file goes out as, which is the one the server's limits apply to: `application/octet-stream` without one. */
function declared(file: Blob): string {
	return file.type || 'application/octet-stream';
}

/**
 * Throws `NotAcceptedError` for a file that goes as it is when the server
 * stated what it takes (`limits`) and this isn't it.
 */
function accept(file: File, limits: MediaTypes | undefined): void {
	if (!limits) return;
	const limit = mediaLimit(limits, declared(file));
	if (!limit) throw new NotAcceptedError(`This server doesn't take this type of file${file.name ? ` (${file.name})` : ''}`);
	if (limit.max_bytes !== undefined && file.size > limit.max_bytes) {
		throw new NotAcceptedError(`${file.name || 'The file'} is too large to send: this server takes ${kindOf(declared(file))} up to ${limitSize(limit.max_bytes)}`);
	}
}

/**
 * What a re-encoded image goes out as and must fit: the `ENCODINGS` the server
 * takes, held to the strictest of their limits, and otherwise to the
 * client's own. Without stated limits, both encodings and the client's own.
 */
function reencoding(limits: MediaTypes | undefined, maxBytes: number, maxSide: number): { types: string[]; maxBytes: number; maxSide: number } {
	if (!limits) return { types: ENCODINGS, maxBytes, maxSide };
	const taken = ENCODINGS.flatMap((type) => {
		const limit = mediaLimit(limits, type);
		return limit ? [{ type, limit }] : [];
	});
	return {
		types: taken.map(({ type }) => type),
		maxBytes: Math.min(...taken.map(({ limit }) => limit.max_bytes ?? maxBytes)),
		maxSide: Math.min(maxSide, ...taken.map(({ limit }) => limit.max_side ?? maxSide))
	};
}

/**
 * Encodes at each quality step as the first of `types`, and as the next once
 * the browser shows it can't encode one; resolves with the first Blob under
 * `maxBytes`.
 */
async function encodeUnder(codec: ImageCodec, image: DecodedImage, crop: Crop, width: number, height: number, maxBytes: number, types = ENCODINGS): Promise<Blob | undefined> {
	let index = 0;
	for (const quality of QUALITIES) {
		let blob = await codec.encode(image, crop, width, height, types[index], quality);
		while (blob.type !== types[index] && index + 1 < types.length) {
			index++;
			blob = await codec.encode(image, crop, width, height, types[index], quality);
		}
		if (blob.type !== types[index]) return undefined;
		if (blob.size <= maxBytes) return blob;
	}
	return undefined;
}

/**
 * Readies a file for an upload embed. Images are scaled so their longest side
 * is at most 2048 px, or the server's `max_side` if smaller, and re-encoded
 * under 5 MB, or the server's `max_bytes`; small images without metadata, of
 * a type the server takes, go as they are. Photos are always re-encoded so
 * their EXIF is dropped. What can't be re-encoded (an animated image, audio,
 * video, any other file, an image the browser can't decode) goes as it is:
 * refused with `NotAcceptedError` only by the server's stated `limits`
 * (`ext.media.upload`), and otherwise left for the server to judge.
 */
export async function prepareUpload(
	file: File,
	{ maxBytes = UPLOAD_MAX_BYTES, maxSide = UPLOAD_MAX_SIDE, limits, codec = browserCodec() }: { maxBytes?: number; maxSide?: number; limits?: MediaTypes; codec?: ImageCodec | undefined } = {}
): Promise<Attachment> {
	const asIs = (size?: { width: number; height: number }): Attachment => {
		accept(file, limits);
		return { file, ...size };
	};
	const facts = sniffImage(await headOf(file));
	// Other formats the browser decodes (HEIC, AVIF, BMP) are converted, since not every browser shows them.
	if (!facts && !file.type.startsWith('image/')) return asIs();
	if (facts?.animated) return asIs(codec ? await dimensions(codec, file) : undefined);
	const fit = reencoding(limits, maxBytes, maxSide);
	if (!codec || !fit.types.length) return asIs();
	let image: DecodedImage;
	try {
		image = await codec.decode(file);
	} catch {
		return asIs();
	}
	try {
		const original = { width: image.width, height: image.height };
		const own = limits ? mediaLimit(limits, declared(file)) : {};
		const fits = own !== undefined && Math.max(original.width, original.height) <= Math.min(maxSide, own.max_side ?? maxSide) && file.size <= (own.max_bytes ?? maxBytes);
		if (facts && fits && !facts.metadata) return { file, ...original };
		const crop = { x: 0, y: 0, ...original };
		let side = Math.min(fit.maxSide, Math.max(original.width, original.height));
		for (;;) {
			const target = fitWithin(original.width, original.height, side);
			const blob = await encodeUnder(codec, image, crop, target.width, target.height, fit.maxBytes, fit.types);
			if (blob) return { file: new File([blob], renamed(file.name, blob.type), { type: blob.type, lastModified: file.lastModified }), ...target };
			if (side <= MIN_SIDE) break;
			side = Math.max(MIN_SIDE, Math.round(side * SHRINK));
		}
		throw new ImageTooLargeError(`${file.name || 'The image'} couldn't be made small enough to send`);
	} finally {
		image.close?.();
	}
}

/**
 * Readies an avatar for `/avatar`: center-cropped to a square, scaled to
 * 512×512 when that fits under 256 KB and to 256×256 otherwise, and
 * re-encoded, which also drops its metadata. The server's stated `limits`
 * (`ext.media.avatar`) take the place of 256 KB, and cap the sides.
 */
export async function prepareAvatar(
	file: File,
	{ maxBytes = AVATAR_MAX_BYTES, sides = AVATAR_SIDES, limits, codec = browserCodec() }: { maxBytes?: number; sides?: number[]; limits?: MediaTypes; codec?: ImageCodec | undefined } = {}
): Promise<Attachment> {
	if (!codec) {
		accept(file, limits);
		return { file };
	}
	const fit = reencoding(limits, maxBytes, Math.max(...sides));
	if (!fit.types.length) throw new NotAcceptedError("This server doesn't take avatars as WebP or JPEG");
	let image: DecodedImage;
	try {
		image = await codec.decode(file);
	} catch {
		throw new Error('That file is not an image this browser can read');
	}
	try {
		const crop = centerSquare(image.width, image.height);
		for (const wanted of new Set(sides.map((side) => Math.min(side, fit.maxSide)))) {
			const side = Math.min(wanted, crop.width);
			const blob = await encodeUnder(codec, image, crop, side, side, fit.maxBytes, fit.types);
			if (blob) return { file: new File([blob], renamed(file.name || 'avatar', blob.type), { type: blob.type }), width: side, height: side };
		}
		throw new ImageTooLargeError(`The avatar couldn't be made smaller than ${limitSize(fit.maxBytes)}`);
	} finally {
		image.close?.();
	}
}

async function dimensions(codec: ImageCodec, file: Blob): Promise<{ width: number; height: number } | undefined> {
	try {
		const image = await codec.decode(file);
		image.close?.();
		return { width: image.width, height: image.height };
	} catch {
		return undefined;
	}
}

/** A limit for people: bytes, whole KB, or MB to at most one decimal. */
function limitSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

/** What files of a type are called, for a limit: images, audio, video, or files like it. */
function kindOf(type: string): string {
	const group = type.split('/')[0];
	return group === 'image' ? 'images' : group === 'audio' || group === 'video' ? group : 'files like this';
}

/** A file's size for people: bytes, whole KB, or MB to one decimal. */
export function fileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `createImageBitmap` and a canvas, or undefined where the platform has neither. */
export function browserCodec(): ImageCodec | undefined {
	if (typeof createImageBitmap === 'undefined') return undefined;
	const offscreen = typeof OffscreenCanvas !== 'undefined';
	if (!offscreen && typeof document === 'undefined') return undefined;
	return {
		decode: (blob) => createImageBitmap(blob, { imageOrientation: 'from-image' }),
		async encode(image, crop, width, height, type, quality) {
			const canvas = offscreen ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
			const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
			if (!context) throw new Error('This browser cannot resize images');
			// JPEG has no transparency: transparent pixels would turn black.
			if (type === 'image/jpeg') {
				context.fillStyle = '#fff';
				context.fillRect(0, 0, width, height);
			}
			context.imageSmoothingQuality = 'high';
			context.drawImage(image as ImageBitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
			if (offscreen) return (canvas as OffscreenCanvas).convertToBlob({ type, quality });
			const element = canvas as HTMLCanvasElement;
			return new Promise<Blob>((resolve, reject) => element.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded'))), type, quality));
		}
	};
}
