import { describe, expect, it } from 'vitest';
import { mediaLimit, serverMedia } from './client-views';
import type { ServerParams } from './types';

const server = (capabilities: string[], ext?: ServerParams['ext']): ServerParams => ({ apron: 9, capabilities, auth: ['guest'], ...(ext ? { ext } : {}) });

describe('serverMedia (ext:media)', () => {
	const media = {
		origins: ['https://media.chat.example', 'https://media.chat.example/f', 'http://media.chat.example'],
		upload: { 'image/*': { max_bytes: 5_242_880, max_side: 2048 }, 'image/gif': { max_bytes: 5_242_880 }, 'audio/*': { max_bytes: 10_485_760 } },
		avatar: { 'image/*': { max_bytes: 262_144, max_side: 512 } }
	};

	it('reads the media only while the server advertises the extension', () => {
		expect(serverMedia(server(['ext:media'], { media }))).toEqual({
			origins: ['https://media.chat.example'],
			upload: media.upload,
			avatar: media.avatar
		});
		expect(serverMedia(server([], { media }))).toEqual({ origins: [] });
		expect(serverMedia(undefined)).toEqual({ origins: [] });
	});

	it('leaves out each field of the wrong shape on its own', () => {
		const odd = {
			origins: 'https://media.chat.example',
			upload: {
				'image/*': { max_bytes: -1, max_side: 2.5, max_frames: 3 },
				'audio/*': { max_bytes: '10485760' },
				'video/*': 'yes',
				'IMAGE/PNG': {},
				'*/png': {},
				nonsense: {}
			},
			avatar: ['image/*']
		};
		expect(serverMedia(server(['ext:media'], { media: odd }))).toEqual({ origins: [], upload: { 'image/*': {}, 'audio/*': {}, 'image/png': {} } });
	});

	it('takes a file by its most specific pattern, whatever the order of keys', () => {
		const types = { '*/*': { max_bytes: 1 }, 'image/gif': { max_bytes: 3 }, 'image/*': { max_bytes: 2 } };
		expect(mediaLimit(types, 'image/gif')).toEqual({ max_bytes: 3 });
		expect(mediaLimit(types, 'image/png')).toEqual({ max_bytes: 2 });
		expect(mediaLimit(types, 'audio/webm;codecs=opus')).toEqual({ max_bytes: 1 });
		// Without `*/*`, a type no pattern matches isn't taken; one without a type is `application/octet-stream`.
		expect(mediaLimit({ 'image/*': {} }, 'audio/ogg')).toBeUndefined();
		expect(mediaLimit({ 'application/octet-stream': {} }, '')).toEqual({});
		expect(mediaLimit({ 'audio/*': {} }, 'Audio/MP4')).toEqual({});
	});
});
