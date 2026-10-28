import { describe, expect, it } from 'vitest';
import { qrCode } from './qr-code';

describe('qrCode', () => {
	it('draws a device sign-in link as a version 6 code, 41 modules a side, and a short text as the smallest, 21', () => {
		const link = `https://link.apron.chat/#server=wss://server.apron.chat/&token=apron_device_${'A'.repeat(43)}`;
		expect(qrCode(link)?.size).toBe(41);
		expect(qrCode('apron')?.size).toBe(21);
	});

	it('gives none for text too long for any code', () => {
		expect(qrCode('a'.repeat(3000))).toBeUndefined();
	});
});
