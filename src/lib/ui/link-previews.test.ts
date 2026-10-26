import { describe, expect, it, vi } from 'vitest';
import { findLinks, findUrls, LinkPreviews, previewLink, trimUrl } from './link-previews';
import type { Site } from './link-sites';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('finding links', () => {
	it('finds URLs in text without the punctuation or brackets around them, keeping brackets they open', () => {
		expect(trimUrl('https://a.example/x).')).toBe('https://a.example/x');
		expect(trimUrl('https://en.wikipedia.org/wiki/Mercury_(planet)')).toBe('https://en.wikipedia.org/wiki/Mercury_(planet)');
		expect(trimUrl('https://en.wikipedia.org/wiki/Mercury_(planet)),')).toBe('https://en.wikipedia.org/wiki/Mercury_(planet)');
		expect(trimUrl("https://en.wikipedia.org/wiki/Hitchhiker's_Guide'")).toBe("https://en.wikipedia.org/wiki/Hitchhiker's_Guide");
		// A bracket closing around the URL ends it, whatever follows.
		expect(trimUrl('https://a.example/x)and more')).toBe('https://a.example/x');
		expect(trimUrl('https://a.example/x](https://a.example/x)')).toBe('https://a.example/x');
		// In one pass, so a long run of brackets doesn't stall typing.
		expect(trimUrl(`https://a.example/${')'.repeat(100_000)}`)).toBe('https://a.example/');
		expect(findUrls('see [this](https://a.example/b?c=1), <https://d.example> and **https://e.example/f**! ftp://g.example').map(String)).toEqual([
			'https://a.example/b?c=1', 'https://d.example/', 'https://e.example/f'
		]);
	});

	it('previews only links on a known site that it describes', () => {
		expect(previewLink('https://github.com/shazow/apron/pull/60/files#diff')).toMatchObject({ url: 'https://github.com/shazow/apron/pull/60', site: { name: 'GitHub' } });
		expect(previewLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.site.name).toBe('YouTube');
		expect(previewLink('https://example.com/a/b')).toBeUndefined();
		expect(previewLink('https://github.com/shazow')).toBeUndefined();
		expect(previewLink('javascript:alert(1)')).toBeUndefined();
		expect(previewLink('not a url')).toBeUndefined();
	});

	it('finds distinct previewable links in text, skipping others, up to three', () => {
		const text = 'see https://github.com/a/b/pull/1, https://example.com/x and (https://github.com/a/b/issues/2). again https://github.com/a/b/pull/1 https://youtu.be/dQw4w9WgXcQ https://github.com/e/f';
		expect(findLinks(text).map((link) => link.url)).toEqual(['https://github.com/a/b/pull/1', 'https://github.com/a/b/issues/2', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
		// The same page linked two ways is one link.
		expect(findLinks('https://youtu.be/dQw4w9WgXcQ https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1')).toHaveLength(1);
		expect(findLinks('https://x.com/Jack/status/20 https://x.com/jack/status/20 https://github.com/a/b/commit/ABCDEF1 https://github.com/a/b/commit/abcdef1')).toHaveLength(2);
		expect(findLinks('[https://github.com/a/b/pull/1](https://github.com/a/b/pull/1) (https://github.com/a/b/pull/2)and').map((link) => link.url)).toEqual(['https://github.com/a/b/pull/1', 'https://github.com/a/b/pull/2']);
		expect(findLinks(text, ['https://github.com/a/b/issues/2']).map((link) => link.url)).toEqual(['https://github.com/a/b/pull/1', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://github.com/e/f']);
	});
});

describe('LinkPreviews', () => {
	it('fetches each pasted link once and attaches what it learned', async () => {
		const fetcher = vi.fn(async () => json({ title: 'Remove the Go server', state: 'open', user: { login: 'shazow' } }));
		const previews = new LinkPreviews(fetcher as unknown as typeof fetch);
		const text = 'look https://github.com/a/b/issues/60';
		expect(previews.embeds(text)).toEqual([{ kind: 'link', url: 'https://github.com/a/b/issues/60', og: { site_name: 'GitHub · a/b', title: 'Issue #60' } }]);
		await Promise.all([previews.prefetch(text), previews.prefetch(text)]);
		await previews.prefetch(text);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(fetcher).toHaveBeenCalledWith('https://api.github.com/repos/a/b/issues/60', expect.objectContaining({ credentials: 'omit' }));
		expect(previews.embeds(text)[0].og).toEqual({ site_name: 'GitHub · a/b', title: 'Remove the Go server', description: 'Issue #60 · Open · by shazow' });
	});

	it('falls back to the URL for private links and failed requests, and attaches nothing for an unknown repository', async () => {
		const fetcher = vi.fn(async () => json({ message: 'Not Found' }, 404));
		const previews = new LinkPreviews(fetcher as unknown as typeof fetch);
		await previews.prefetch('https://github.com/a/b/pull/1 https://github.com/c/d');
		expect(previews.embeds('https://github.com/a/b/pull/1 https://github.com/c/d')).toEqual([{ kind: 'link', url: 'https://github.com/a/b/pull/1', og: { site_name: 'GitHub · a/b', title: 'Pull request #1' } }]);
		await previews.prefetch('https://github.com/a/b/pull/1');
		expect(fetcher).toHaveBeenCalledTimes(2);
		// A request that fails falls back to the URL too.
		const offline = new LinkPreviews((async () => { throw new TypeError('offline'); }) as unknown as typeof fetch);
		await offline.prefetch('https://github.com/a/b/pull/1');
		expect(offline.embeds('https://github.com/a/b/pull/1')[0].og?.title).toBe('Pull request #1');
	});

	it('stops asking while rate limited, and retries a link after', async () => {
		let now = 1_000_000;
		const fetcher = vi.fn(async () => json({ message: 'rate limited' }, 403, { 'x-ratelimit-reset': String(now / 1000 + 60) }));
		const previews = new LinkPreviews(fetcher as unknown as typeof fetch, () => now);
		await previews.prefetch('https://github.com/a/b/pull/1');
		await previews.prefetch('https://github.com/a/b/pull/2');
		expect(fetcher).toHaveBeenCalledTimes(1);
		now += 61_000;
		await previews.prefetch('https://github.com/a/b/pull/1');
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('holds a rate-limited site for its Retry-After without holding the others', async () => {
		let now = 1_000_000;
		const fetcher = vi.fn(async (url: string) => (url.includes('youtube') ? json({}, 429, { 'retry-after': '120' }) : json({ title: 'T', state: 'open' })));
		const previews = new LinkPreviews(fetcher as unknown as typeof fetch, () => now);
		await previews.prefetch('https://youtu.be/dQw4w9WgXcQ');
		await previews.prefetch('https://youtu.be/aaaaaaaaaaa https://github.com/a/b/pull/1');
		expect(fetcher).toHaveBeenCalledTimes(2);
		now += 121_000;
		await previews.prefetch('https://youtu.be/aaaaaaaaaaa');
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it('remembers the statuses a site names as missing, and asks again after other failures', async () => {
		const site: Site = { name: 'Test', missing: [400], match: (url) => ({ url: url.href, api: `https://api.test${url.pathname}`, preview: () => undefined, fallback: { title: 'From the URL' } }) };
		const statuses: Record<string, number> = { '/gone': 400, '/broken': 500 };
		const fetcher = vi.fn(async (url: string) => json({}, statuses[new URL(url).pathname]));
		const previews = new LinkPreviews(fetcher as unknown as typeof fetch, Date.now, { 'test.example': site });
		await previews.prefetch('https://test.example/gone https://test.example/broken');
		await previews.prefetch('https://test.example/gone https://test.example/broken');
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://api.test/gone', 'https://api.test/broken', 'https://api.test/broken']);
		expect(previews.embeds('https://test.example/gone')).toEqual([{ kind: 'link', url: 'https://test.example/gone', og: { title: 'From the URL' } }]);
	});

	it('leaves out dismissed links, letting later ones in under the cap, and tells listeners when details arrive', async () => {
		const fetcher = vi.fn(async () => json({ title: 'T', state: 'open' }));
		const previews = new LinkPreviews(fetcher as unknown as typeof fetch);
		const text = 'https://github.com/a/b/pull/1 https://github.com/a/b/pull/2 https://github.com/a/b/pull/3 https://github.com/a/b/pull/4';
		expect(previews.embeds(text, ['https://github.com/a/b/pull/2']).map((embed) => embed.url)).toEqual([
			'https://github.com/a/b/pull/1', 'https://github.com/a/b/pull/3', 'https://github.com/a/b/pull/4'
		]);
		const listener = vi.fn();
		const unsubscribe = previews.subscribe(listener);
		await previews.prefetch('https://github.com/a/b/pull/1');
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
		await previews.prefetch('https://github.com/a/b/pull/2');
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
