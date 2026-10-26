import { describe, expect, it } from 'vitest';
import { bioOf, cleanBio, keepsBio, MAX_BIO_CHARS, mediaLimit, peopleTitle, serverMedia, serverSettings, yourPermissions } from './client-views';
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

describe('serverSettings (ext:settings)', () => {
	it('reads private_rooms as a count, and states no limit without one', () => {
		expect(serverSettings(server(['ext:settings'], { settings: { private_rooms: 5 } })).private_rooms).toBe(5);
		expect(serverSettings(server(['ext:settings'], { settings: { private_rooms: 0 } })).private_rooms).toBe(0);
		for (const odd of [undefined, -1, 2.5, '5', true]) expect(serverSettings(server(['ext:settings'], { settings: { private_rooms: odd } }))).not.toHaveProperty('private_rooms');
		// Only while the server lists the extension.
		expect(serverSettings(server([], { settings: { private_rooms: 5 } }))).not.toHaveProperty('private_rooms');
	});
});

describe('peopleTitle', () => {
	it('names a private room after the others in it, sorted, or "You" alone', () => {
		expect(peopleTitle(['Mira', 'dev'])).toBe('dev, Mira');
		expect(peopleTitle(['Bob'])).toBe('Bob');
		expect(peopleTitle([])).toBe('You');
	});
});

describe('yourPermissions (ext:permissions)', () => {
	const you = { user_id: 'ada', roles: ['admin'], ext: { permissions: ['move_any', 7, 'delete_any', 'add_members'] } };

	it('reads known permissions from you, only while the server advertises the extension', () => {
		expect(yourPermissions(server(['ext:permissions']), you)).toEqual({ move_any: true, add_members: true });
		expect(yourPermissions(server(['ext:permissions']), { user_id: 'ada', ext: { permissions: ['move_any'] } })).toEqual({ move_any: true, add_members: false });
		// Without the extension, or without the list, roles grant nothing.
		expect(yourPermissions(server([]), you)).toEqual({ move_any: false, add_members: false });
		expect(yourPermissions(server(['ext:permissions']), { user_id: 'ada', roles: ['admin'], ext: { permissions: 'move_any' } })).toEqual({ move_any: false, add_members: false });
		expect(yourPermissions(server(['ext:permissions']), undefined)).toEqual({ move_any: false, add_members: false });
	});
});

describe('bios (ext:bio)', () => {
	it('are kept by a server with ext:bio, or with ext, which keeps any key', () => {
		expect([keepsBio(server(['ext:bio'])), keepsBio(server(['ext'])), keepsBio(server(['ext:media'])), keepsBio(undefined)]).toEqual([true, true, false, false]);
	});

	it('are plain strings, trimmed and cut to MAX_BIO_CHARS characters, emoji counting as one', () => {
		expect(bioOf({ user_id: 'ada', ext: { bio: '  Counts things.\nMostly engines.  ' } })).toBe('Counts things.\nMostly engines.');
		expect(bioOf({ user_id: 'ada', ext: { bio: '🦆'.repeat(MAX_BIO_CHARS + 10) } })).toBe('🦆'.repeat(MAX_BIO_CHARS));
		// None, cleared, blank, or not a string: no bio.
		expect([undefined, '', '   ', 7, { text: 'hi' }].map((bio) => bioOf({ user_id: 'ada', ext: { bio } as never }))).toEqual([undefined, undefined, undefined, undefined, undefined]);
		expect(bioOf({ user_id: 'ada' })).toBeUndefined();
	});

	it('are cleaned as plain text before they show or go (cleanPlainText)', () => {
		expect(cleanBio('evil\u202Egnp.exe\n\n\n\nok\u0000')).toBe('evilgnp.exe\n\nok');
		expect(bioOf({ user_id: 'ada', ext: { bio: '\u202E\u0000 ' } })).toBeUndefined();
	});
});
