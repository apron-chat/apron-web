/**
 * Shrinks images before they're uploaded (capability `embed:upload`, §4.8.4, and
 * `/avatar`, §4.8.6). Photos are always re-encoded, so their EXIF (GPS
 * location included) never reaches the server, which stores bytes as sent.
 * Large images are scaled so their longest side fits and encoded as WebP, or
 * JPEG where the browser can't encode WebP, stepping the quality down until
 * the file fits. Animated images can't go through a canvas without losing
 * their animation: they're sent unchanged, or refused when too large.
 */

/** Uploads are capped at 5 MB, avatars at 256 KB, by the servers we know. */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MAX_BYTES = 256 * 1024;
/** The longest side an uploaded image is scaled to. */
export const UPLOAD_MAX_SIDE = 2048;
/** Avatar squares, largest first: the first that fits under the limit wins. */
export const AVATAR_SIDES = [512, 256];
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

/**
 * Identifies an image the server accepts from its first bytes, the way the
 * server does: PNG, JPEG, GIF, or WebP. Anything else is undefined.
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

/**
 * Encodes at each quality step, WebP first and JPEG once the browser shows it
 * can't encode WebP; resolves with the first Blob under `maxBytes`.
 */
async function encodeUnder(codec: ImageCodec, image: DecodedImage, crop: Crop, width: number, height: number, maxBytes: number): Promise<Blob | undefined> {
	let type = 'image/webp';
	for (const quality of QUALITIES) {
		let blob = await codec.encode(image, crop, width, height, type, quality);
		if (blob.type !== type && type === 'image/webp') {
			type = 'image/jpeg';
			blob = await codec.encode(image, crop, width, height, type, quality);
		}
		if (blob.size <= maxBytes) return blob;
	}
	return undefined;
}

/**
 * Readies a file for an upload embed. Images are scaled so their longest side
 * is at most 2048 px and re-encoded under 5 MB; small images without
 * metadata go as they are. Photos are always re-encoded so their EXIF is
 * dropped. Animated images go unchanged, or throw `ImageTooLargeError` when
 * over the limit. Anything else, or an image the browser can't decode,
 * passes through untouched for the server to judge.
 */
export async function prepareUpload(
	file: File,
	{ maxBytes = UPLOAD_MAX_BYTES, maxSide = UPLOAD_MAX_SIDE, codec = browserCodec() }: { maxBytes?: number; maxSide?: number; codec?: ImageCodec | undefined } = {}
): Promise<Attachment> {
	const facts = sniffImage(await headOf(file));
	// Other formats the browser decodes (HEIC, AVIF, BMP) are converted, since the server takes only these four.
	if (!facts && !file.type.startsWith('image/')) return { file };
	if (facts?.animated) {
		if (file.size > maxBytes) throw new ImageTooLargeError(`${file.name || 'The animated image'} is too large to send (over ${megabytes(maxBytes)}); animation can't be kept while shrinking it`);
		const size = codec ? await dimensions(codec, file) : undefined;
		return { file, ...size };
	}
	if (!codec) return { file };
	let image: DecodedImage;
	try {
		image = await codec.decode(file);
	} catch {
		return { file };
	}
	try {
		const original = { width: image.width, height: image.height };
		const fits = Math.max(original.width, original.height) <= maxSide && file.size <= maxBytes;
		if (facts && fits && !facts.metadata) return { file, ...original };
		const crop = { x: 0, y: 0, ...original };
		let side = Math.min(maxSide, Math.max(original.width, original.height));
		for (;;) {
			const target = fitWithin(original.width, original.height, side);
			const blob = await encodeUnder(codec, image, crop, target.width, target.height, maxBytes);
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
 * re-encoded, which also drops its metadata.
 */
export async function prepareAvatar(
	file: File,
	{ maxBytes = AVATAR_MAX_BYTES, sides = AVATAR_SIDES, codec = browserCodec() }: { maxBytes?: number; sides?: number[]; codec?: ImageCodec | undefined } = {}
): Promise<Attachment> {
	if (!codec) return { file };
	let image: DecodedImage;
	try {
		image = await codec.decode(file);
	} catch {
		throw new Error('That file is not an image this browser can read');
	}
	try {
		const crop = centerSquare(image.width, image.height);
		for (const wanted of sides) {
			const side = Math.min(wanted, crop.width);
			const blob = await encodeUnder(codec, image, crop, side, side, maxBytes);
			if (blob) return { file: new File([blob], renamed(file.name || 'avatar', blob.type), { type: blob.type }), width: side, height: side };
		}
		throw new ImageTooLargeError(`The avatar couldn't be made smaller than ${Math.round(maxBytes / 1024)} KB`);
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

function megabytes(bytes: number): string {
	return `${Math.round(bytes / (1024 * 1024))} MB`;
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
