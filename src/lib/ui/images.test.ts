import { describe, expect, it } from 'vitest';
import { centerSquare, fitWithin, ImageTooLargeError, prepareAvatar, prepareUpload, sniffImage, type Crop, type ImageCodec } from './images';

const JPEG = [0xff, 0xd8, 0xff, 0xe1];
const bytes = (...parts: Array<number[] | string>) => new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : part)));
const u32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const pngChunk = (type: string, data: number[] | string = []) => {
	const body = typeof data === 'string' ? [...data].map((char) => char.charCodeAt(0)) : data;
	return [...u32(body.length), ...[...type].map((char) => char.charCodeAt(0)), ...body, 0, 0, 0, 0];
};
const png = (...chunks: number[][]) => bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], ...chunks, pngChunk('IDAT', [0]), pngChunk('IEND'));
const gifFrame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x02, 0x01, 0x00, 0x00];
const gif = (frames: number) => bytes('GIF89a', [1, 0, 1, 0, 0, 0, 0], ...Array.from({ length: frames }, () => gifFrame), [0x3b]);
const webp = (flags?: number) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', flags === undefined ? 'VP8 ' : 'VP8X', [0, 0, 0, 0, flags ?? 0]);

/** A codec that decodes to fixed dimensions and encodes to `size(width, quality)` bytes. */
function fakeCodec(width: number, height: number, size: (width: number, height: number, quality: number) => number, { webp = true } = {}) {
	const encodes: Array<{ crop: Crop; width: number; height: number; type: string; quality: number }> = [];
	let closed = 0;
	const codec: ImageCodec = {
		decode: async () => ({ width, height, close: () => void closed++ }),
		async encode(_image, crop, w, h, type, quality) {
			encodes.push({ crop, width: w, height: h, type, quality });
			const made = type === 'image/webp' && !webp ? 'image/png' : type;
			return new Blob([new Uint8Array(size(w, h, quality))], { type: made });
		}
	};
	return { codec, encodes, closed: () => closed };
}

const file = (content: Uint8Array, name: string, type: string, pad = 0) => new File([content as BlobPart, new Uint8Array(pad)], name, { type });

describe('sniffImage', () => {
	it('knows the four accepted formats from their bytes', () => {
		expect(sniffImage(bytes(JPEG))).toEqual({ type: 'image/jpeg', animated: false, metadata: true });
		expect(sniffImage(png())).toEqual({ type: 'image/png', animated: false, metadata: false });
		expect(sniffImage(gif(1))).toEqual({ type: 'image/gif', animated: false, metadata: false });
		expect(sniffImage(webp())).toEqual({ type: 'image/webp', animated: false, metadata: false });
		expect(sniffImage(bytes('hello world'))).toBeUndefined();
	});

	it('spots animation and location metadata', () => {
		expect(sniffImage(gif(2))?.animated).toBe(true);
		expect(sniffImage(png(pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0])))?.animated).toBe(true);
		expect(sniffImage(png(pngChunk('eXIf', [1, 2])))?.metadata).toBe(true);
		expect(sniffImage(png(pngChunk('iTXt', 'XML:com.adobe.xmp exif:GPSLatitude')))?.metadata).toBe(true);
		expect(sniffImage(png(pngChunk('iTXt', 'XML:com.adobe.xmp screenshot')))?.metadata).toBe(false);
		expect(sniffImage(webp(0x02))).toMatchObject({ animated: true, metadata: false });
		expect(sniffImage(webp(0x08))).toMatchObject({ animated: false, metadata: true });
	});
});

describe('sizing', () => {
	it('fits the longest side without scaling up', () => {
		expect(fitWithin(4096, 3072, 2048)).toEqual({ width: 2048, height: 1536 });
		expect(fitWithin(1000, 3000, 2048)).toEqual({ width: 683, height: 2048 });
		expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
	});

	it('crops the centered square', () => {
		expect(centerSquare(400, 300)).toEqual({ x: 50, y: 0, width: 300, height: 300 });
		expect(centerSquare(300, 401)).toEqual({ x: 0, y: 50, width: 300, height: 300 });
	});
});

describe('prepareUpload', () => {
	it('passes other files through untouched', async () => {
		const notes = file(bytes('hello'), 'notes.txt', 'text/plain');
		const { codec, encodes } = fakeCodec(10, 10, () => 1);
		expect(await prepareUpload(notes, { codec })).toEqual({ file: notes });
		expect(encodes).toEqual([]);
	});

	it('sends a small image without metadata as it is, with its dimensions', async () => {
		const shot = file(png(), 'shot.png', 'image/png');
		const { codec, encodes, closed } = fakeCodec(800, 600, () => 1);
		expect(await prepareUpload(shot, { codec })).toEqual({ file: shot, width: 800, height: 600 });
		expect(encodes).toEqual([]);
		expect(closed()).toBe(1);
	});

	it('always re-encodes a photo, dropping its EXIF', async () => {
		const photo = file(bytes(JPEG), 'IMG_1.JPG', 'image/jpeg');
		const { codec, encodes } = fakeCodec(1200, 900, () => 1000);
		const prepared = await prepareUpload(photo, { codec });
		expect(prepared).toMatchObject({ width: 1200, height: 900 });
		expect(prepared.file).toMatchObject({ name: 'IMG_1.webp', type: 'image/webp', size: 1000 });
		expect(encodes).toEqual([{ crop: { x: 0, y: 0, width: 1200, height: 900 }, width: 1200, height: 900, type: 'image/webp', quality: 0.85 }]);
	});

	it('scales a large image and steps the quality down until it fits', async () => {
		const big = file(png(), 'big.png', 'image/png');
		const { codec, encodes } = fakeCodec(4000, 3000, (_w, _h, quality) => (quality > 0.7 ? 6_000_000 : 4_000_000));
		const prepared = await prepareUpload(big, { codec });
		expect(prepared).toMatchObject({ width: 2048, height: 1536 });
		expect(prepared.file.name).toBe('big.webp');
		expect(encodes.map((encode) => encode.quality)).toEqual([0.85, 0.75, 0.65]);
	});

	it('shrinks further when the lowest quality is still too large', async () => {
		const big = file(png(), 'big.png', 'image/png');
		const { codec, encodes } = fakeCodec(4000, 2000, (w) => (w > 1600 ? 6_000_000 : 100));
		const prepared = await prepareUpload(big, { codec });
		expect(prepared).toMatchObject({ width: 1536, height: 768 });
		expect(encodes.at(-1)).toMatchObject({ width: 1536, quality: 0.85 });
	});

	it('falls back to JPEG where the browser cannot encode WebP', async () => {
		const photo = file(bytes(JPEG), 'photo.jpeg', 'image/jpeg');
		const { codec } = fakeCodec(100, 100, () => 10, { webp: false });
		expect((await prepareUpload(photo, { codec })).file).toMatchObject({ name: 'photo.jpg', type: 'image/jpeg' });
	});

	it('sends an animated GIF unchanged, or refuses one over the limit', async () => {
		const small = file(gif(2), 'party.gif', 'image/gif');
		const { codec, encodes } = fakeCodec(300, 200, () => 1);
		expect(await prepareUpload(small, { codec })).toEqual({ file: small, width: 300, height: 200 });
		const large = file(gif(2), 'huge.gif', 'image/gif', 64);
		await expect(prepareUpload(large, { codec, maxBytes: 32 })).rejects.toBeInstanceOf(ImageTooLargeError);
		expect(encodes).toEqual([]);
	});

	it('passes an image the browser cannot decode through', async () => {
		const photo = file(bytes(JPEG), 'odd.jpg', 'image/jpeg');
		const codec: ImageCodec = { decode: () => Promise.reject(new Error('nope')), encode: () => Promise.reject(new Error('unused')) };
		expect(await prepareUpload(photo, { codec })).toEqual({ file: photo });
	});
});

describe('prepareAvatar', () => {
	it('crops a square and takes 512 when it fits', async () => {
		const { codec, encodes } = fakeCodec(1000, 800, () => 100_000);
		const prepared = await prepareAvatar(file(bytes(JPEG), 'me.jpg', 'image/jpeg'), { codec });
		expect(prepared).toMatchObject({ width: 512, height: 512 });
		expect(prepared.file.name).toBe('me.webp');
		expect(encodes[0]).toMatchObject({ crop: { x: 100, y: 0, width: 800, height: 800 }, width: 512, height: 512 });
	});

	it('drops to 256 when 512 is too large, and refuses what never fits', async () => {
		const { codec } = fakeCodec(1000, 1000, (w) => (w > 256 ? 300_000 : 200_000));
		expect(await prepareAvatar(file(png(), 'me.png', 'image/png'), { codec })).toMatchObject({ width: 256, height: 256 });
		const { codec: stubborn } = fakeCodec(1000, 1000, () => 300_000);
		await expect(prepareAvatar(file(png(), 'me.png', 'image/png'), { codec: stubborn })).rejects.toBeInstanceOf(ImageTooLargeError);
	});

	it('never scales a small image up', async () => {
		const { codec } = fakeCodec(120, 200, () => 10);
		expect(await prepareAvatar(file(png(), 'me.png', 'image/png'), { codec })).toMatchObject({ width: 120, height: 120 });
	});
});
