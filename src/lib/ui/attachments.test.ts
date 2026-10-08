import { describe, expect, it } from 'vitest';
import { embedTile } from './attachments';

const origin = 'https://chat.test';

describe('embedTile', () => {
	it('shows an upload as its picture, audio or a file card, by its title, renamable', () => {
		expect(embedTile({ kind: 'upload', embed_id: 'e1', title: 'dusk.jpg', url: `${origin}/f/1`, og: { title: 'old.jpg', image: { url: `${origin}/f/1/thumb`, width: 640, height: 480 } } }, origin))
			.toEqual({ kind: 'image', name: 'dusk.jpg', detail: '640 × 480', src: `${origin}/f/1/thumb`, renamable: true });
		expect(embedTile({ kind: 'upload', url: `${origin}/f/2`, og: { title: 'memo.ogg', audio: { url: `${origin}/f/2` } } }, origin))
			.toEqual({ kind: 'audio', name: 'memo.ogg', src: `${origin}/f/2`, renamable: true });
		expect(embedTile({ kind: 'upload', title: 'notes.txt', url: `${origin}/f/3` }, origin)).toEqual({ kind: 'file', name: 'notes.txt', detail: 'TXT file', renamable: true });
		expect(embedTile({ kind: 'upload', title: 'renamed notes', url: `${origin}/f/3` }, origin).detail).toBe('File');
		expect(embedTile({ kind: 'upload', title: 'big.bin' }, origin)).toEqual({ kind: 'file', name: 'big.bin', detail: 'Uploading…', renamable: true });
	});

	it('loads no picture from elsewhere, and names other embeds by their title or host', () => {
		expect(embedTile({ kind: 'upload', title: 'x.png', url: `${origin}/f/4`, og: { image: { url: 'https://evil.test/x.png' } } }, origin).kind).toBe('file');
		expect(embedTile({ kind: 'link', url: 'https://github.com/a/b/pull/1', og: { title: 'Fix the cert' } }, origin))
			.toEqual({ kind: 'link', name: 'Fix the cert', detail: 'github.com', renamable: false });
		expect(embedTile({ kind: 'stream', url: `${origin}/s/1` }, origin)).toMatchObject({ kind: 'link', name: 'chat.test', renamable: false });
	});
});
