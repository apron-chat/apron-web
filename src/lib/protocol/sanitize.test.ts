// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { NOWHERE, sanitizeHtml, type MediaCheck } from './sanitize';

const fromServer: MediaCheck = { key: 'chat.example', src: (src) => (typeof src === 'string' && src.startsWith('https://chat.example/') ? src : undefined) };
const embed = (html: string, media = fromServer) => sanitizeHtml(html, 'embed', media);

describe('sanitizeHtml: media in an HTML embed (§4.8)', () => {
	it('keeps an image from where media may load, and makes any other a link to it', () => {
		expect(embed('<img src="https://chat.example/a.png" alt="A">')).toBe('<img src="https://chat.example/a.png" alt="A">');
		expect(embed('<p><img src="https://tracker.example/t.gif" alt="Pixel"></p>')).toBe('<p><a href="https://tracker.example/t.gif" target="_blank" rel="noreferrer noopener">Pixel</a></p>');
	});

	it('drops every other way to load: srcset, background, data, ping, and a poster from elsewhere', () => {
		const html = embed('<img src="https://chat.example/a.png" srcset="https://tracker.example/2x.png 2x"><table background="https://tracker.example/bg.png"><tbody><tr><td>x</td></tr></tbody></table><a href="https://example.com" ping="https://tracker.example/ping">go</a><video src="https://chat.example/v.mp4" poster="https://tracker.example/p.jpg"></video>');
		expect(html).not.toContain('tracker.example');
		expect(html).toContain('<video src="https://chat.example/v.mp4"></video>');
	});

	it('takes a video or audio from elsewhere for a link, and drops its sources and captions from elsewhere', () => {
		expect(embed('<audio src="https://tracker.example/a.mp3"></audio>')).toBe('<a href="https://tracker.example/a.mp3" target="_blank" rel="noreferrer noopener">https://tracker.example/a.mp3</a>');
		expect(embed('<video><source src="https://tracker.example/v.mp4"><source src="https://chat.example/v.mp4"><track src="https://tracker.example/c.vtt"></video>')).toBe('<video><source src="https://chat.example/v.mp4"></video>');
	});

	it('loads nothing with no gate, and keeps no SVG, MathML, style or script', () => {
		expect(embed('<img src="https://chat.example/a.png" alt="A">', NOWHERE)).not.toContain('<img');
		const html = embed('<svg><image href="https://tracker.example/s.png"></image></svg><math><mi>x</mi></math><style>p{background:url(https://tracker.example/s)}</style><p style="background:url(https://tracker.example/s)">x</p><script>1</script>');
		expect(html).not.toContain('tracker.example');
		expect(html).not.toMatch(/<svg|<math|<style|<script/);
	});

	it('keeps media inline in the markup, which loads from nowhere, and never shows where a hidden image pointed', () => {
		const svg = 'data:image/svg+xml;base64,PHN2Zy8+';
		expect(embed(`<img src="${svg}" alt="Logo">`, NOWHERE)).toBe(`<img src="${svg}" alt="Logo">`);
		expect(embed('<p><img src="/relative.png"></p>', NOWHERE)).toBe('<p></p>');
		expect(embed('<p><img src="/relative.png" alt="Chart"></p>', NOWHERE)).toBe('<p>Chart</p>');
	});

	it('opens an embed’s links in a new tab, without a referrer', () => {
		expect(embed('<a href="https://example.com">x</a>')).toBe('<a href="https://example.com" target="_blank" rel="noreferrer noopener">x</a>');
	});

	it('remembers each result by its markup and its gate', () => {
		const html = '<img src="https://chat.example/a.png" alt="A">';
		expect(embed(html)).toContain('<img');
		expect(embed(html, NOWHERE)).not.toContain('<img');
		expect(embed(html)).toContain('<img');
	});
});
