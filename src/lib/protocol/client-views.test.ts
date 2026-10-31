import { describe, expect, it } from 'vitest';
import { bioOf, cleanBio, keepsBio, MAX_BIO_CHARS, mediaLimit, peopleTitle, serverLook, serverMedia, serverSettings, yourPermissions } from './client-views';
import type { ServerParams } from './types';

const server = (capabilities: string[], ext?: ServerParams['ext']): ServerParams => ({ apron: 9, capabilities, auth: ['guest'], ...(ext ? { ext } : {}) });

describe('serverMedia (ext:media)', () => {
	const media = {
		origins: ['https://media.chat.example', 'https://media.chat.example/f', 'http://media.chat.example'],
		upload: { 'image/*': { max_bytes: 5_242_880, max_side: 2048 }, 'image/gif': { max_bytes: 5_242_880 }, 'audio/*': { max_bytes: 10_485_760 } },
		avatar: { 'image/*': { max_bytes: 262_144, max_side: 512 } },
		emoji: { 'image/png': { max_bytes: 262_144 }, 'image/gif': { max_bytes: 262_144 }, 'image/webp': { max_bytes: 262_144, max_side: 128 } }
	};

	it('reads the media only while the server advertises the extension', () => {
		expect(serverMedia(server(['ext:media'], { media }))).toEqual({
			origins: ['https://media.chat.example'],
			upload: media.upload,
			avatar: media.avatar,
			emoji: media.emoji
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
			avatar: ['image/*'],
			emoji: { 'Image/GIF': { max_bytes: 0 }, 'image/png': null }
		};
		expect(serverMedia(server(['ext:media'], { media: odd }))).toEqual({ origins: [], upload: { 'image/*': {}, 'audio/*': {}, 'image/png': {} }, emoji: { 'image/gif': {} } });
		expect(serverMedia(server(['ext:media'], { media: { emoji: 'image/png' } }))).toEqual({ origins: [] });
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

	it('keeps read cursors unless the server says false, and knows no other setting', () => {
		expect(serverSettings(server(['ext:settings'], { settings: { read_cursors: false } }))).toEqual({ read_cursors: false, read_receipts: false });
		for (const odd of [undefined, 'false', 0, null]) expect(serverSettings(server(['ext:settings'], { settings: { read_cursors: odd } })).read_cursors).toBe(true);
		expect(serverSettings(server([], { settings: { read_cursors: false } })).read_cursors).toBe(true);
		// Settings that moved to ext:permissions mean nothing here.
		expect(serverSettings(server(['ext:settings'], { settings: { guest_posting: false, add_members: false } }))).toEqual({ read_cursors: true, read_receipts: false });
	});

	it('shows read receipts only where the server says "private"', () => {
		expect(serverSettings(server(['ext:settings'], { settings: { read_receipts: 'private' } })).read_receipts).toBe('private');
		for (const odd of [undefined, true, 'all', false]) expect(serverSettings(server(['ext:settings'], { settings: { read_receipts: odd } })).read_receipts).toBe(false);
		expect(serverSettings(server([], { settings: { read_receipts: 'private' } })).read_receipts).toBe(false);
	});
});

describe('serverLook (§3.1)', () => {
	it('reads title, description and avatar as strings, the avatar only from where avatars load (§4.8.6)', () => {
		const frame = { apron: 9, auth: ['guest'], title: '  Work chat ', description: 'Where **we** talk.', avatar: 'https://cdn.example/icon.png' };
		expect(serverLook(frame, 'wss://chat.example/ws')).toEqual({ title: 'Work chat', description: 'Where **we** talk.', avatar: 'https://cdn.example/icon.png' });
		expect(serverLook({ ...frame, avatar: '/icon.png' }, 'wss://chat.example/ws').avatar).toBeUndefined();
		expect(serverLook({ ...frame, avatar: 'https://chat.example/icon.svg' }, 'wss://chat.example/ws').avatar).toBe('https://chat.example/icon.svg');
		expect(serverLook({ ...frame, avatar: 'http://chat.example/icon.png' }, 'wss://chat.example/ws').avatar).toBeUndefined();
		expect(serverLook({ ...frame, avatar: 'javascript:alert(1)' }, 'wss://chat.example/ws').avatar).toBeUndefined();
		expect(serverLook({ apron: 9, auth: [], title: ' ', description: 7 } as never, 'wss://chat.example/')).toEqual({});
		expect(serverLook(undefined, undefined)).toEqual({});
	});

	it('shows the title and description without bidi embeddings and overrides (§3.5.2), the frame kept as sent', () => {
		const frame = { apron: 9, auth: ['guest'], title: 'Mock\u202E Chat', description: 'Where\u202A **we** talk.' };
		expect(serverLook(frame, 'wss://chat.example/')).toEqual({ title: 'Mock Chat', description: 'Where **we** talk.' });
		expect(frame.title).toBe('Mock\u202E Chat');
		expect(serverLook({ apron: 9, auth: [], title: '\u202E' }, 'wss://chat.example/')).toEqual({});
	});
});

describe('peopleTitle', () => {
	it('names a private room after the others in it, sorted, or "You" alone', () => {
		expect(peopleTitle(['Mira', 'dev'])).toBe('dev, Mira');
		expect(peopleTitle(['Bob'])).toBe('Bob');
		// Shown, so without bidi embeddings and overrides (§3.5.2).
		expect(peopleTitle(['Mal\u202Elory', 'Bob'])).toBe('Bob, Mallory');
		expect(peopleTitle([])).toBe('You');
	});
});

describe('yourPermissions (ext:permissions)', () => {
	const DEFAULTS = { write: true, add_members: false, move_any: false };

	it('reads each permission from you, only while the server advertises the extension', () => {
		const admin = { user_id: 'ada', roles: ['admin'], ext: { permissions: { add_members: true, move_any: true, delete_any: true } } };
		expect(yourPermissions(server(['ext:permissions']), admin)).toEqual({ write: true, add_members: true, move_any: true });
		expect(yourPermissions(server(['ext:permissions']), { user_id: 'guest_1', ext: { permissions: { write: false } } })).toEqual({ ...DEFAULTS, write: false });
		// An absent key takes its default while the extension is advertised.
		expect(yourPermissions(server(['ext:permissions']), undefined)).toEqual(DEFAULTS);
		expect(yourPermissions(server(['ext:permissions']), { user_id: 'ada' })).toEqual(DEFAULTS);
		expect(yourPermissions(server(['ext:permissions']), { user_id: 'ada', ext: { permissions: {} } })).toEqual(DEFAULTS);
	});

	it('offers what PROTOCOL.md allows without the extension: writes, adding people anywhere, and moving only your own', () => {
		const CORE = { write: true, add_members: true, move_any: false };
		expect(yourPermissions(server([]), { user_id: 'ada' })).toEqual(CORE);
		expect(yourPermissions(undefined, undefined)).toEqual(CORE);
		// you.ext.permissions means nothing then, whatever it says.
		expect(yourPermissions(server([]), { user_id: 'ada', ext: { permissions: { write: false, move_any: true, add_members: false } } })).toEqual(CORE);
	});

	it('takes the default for a key of the wrong type, and for all of them when permissions is not an object', () => {
		expect(yourPermissions(server(['ext:permissions']), { user_id: 'ada', ext: { permissions: { write: 'no', move_any: 1, add_members: true } } })).toEqual({ ...DEFAULTS, add_members: true });
		// The old list of names is the wrong type: nothing in it counts.
		expect(yourPermissions(server(['ext:permissions']), { user_id: 'ada', ext: { permissions: ['move_any', 'add_members'] } })).toEqual(DEFAULTS);
		expect(yourPermissions(server(['ext:permissions']), { user_id: 'ada', ext: { permissions: 'move_any' } })).toEqual(DEFAULTS);
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
