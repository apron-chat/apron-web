import { describe, expect, it, vi } from 'vitest';
import { findLinks, findUrls, LinkPreviews, previewLink, samePreviews, trimUrl } from './link-previews';
import type { Site } from './link-sites';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('finding links', () => {
	it('finds URLs in text without the punctuation or brackets around them, keeping brackets they open', () => {
		expect(trimUrl('https://a.example/x).')).toBe('https://a.example/x');
		// A spoiler's bars after it, as in `||https://…||`.
		expect(trimUrl('https://a.example/x||')).toBe('https://a.example/x');
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

	it('reads each URL as written once, as a draft is typed on: only the one being typed into is read again', () => {
		const match = vi.fn((url: URL) => (url.pathname.startsWith('/p/') ? { url: url.href, api: url.href, preview: () => undefined } : undefined));
		const sites: Record<string, Site> = { 'a.example': { name: 'A', match } };
		const draft = 'see https://a.example/p/1 and https://a.example/q/2 then https://a.example/p/3';
		expect(findLinks(draft, [], sites).map((link) => link.url)).toEqual(['https://a.example/p/1', 'https://a.example/p/3']);
		expect(match).toHaveBeenCalledTimes(3);
		// A key after the links: none of them is read again.
		expect(findLinks(`${draft} ok`, [], sites)).toEqual(findLinks(draft, [], sites));
		expect(match).toHaveBeenCalledTimes(3);
		// A key in the last one: only it is.
		expect(findLinks(draft.replace('/p/3', '/p/34'), [], sites).map((link) => link.url)).toEqual(['https://a.example/p/1', 'https://a.example/p/34']);
		expect(match).toHaveBeenCalledTimes(4);
		// Another set of sites reads it afresh.
		expect(findLinks(draft, [], { 'a.example': { name: 'A', match: () => undefined } })).toEqual([]);
	});

	it('tells the same previews apart from new ones by link and details', () => {
		const og = { title: 'One' };
		const one = { kind: 'link' as const, url: 'https://a.example/1', og };
		expect(samePreviews([one], [{ ...one }])).toBe(true);
		expect(samePreviews([one], [{ ...one, og: { title: 'One' } }])).toBe(false);
		expect(samePreviews([one], [{ ...one, url: 'https://a.example/2' }])).toBe(false);
		expect(samePreviews([one], [])).toBe(false);
		expect(samePreviews([], [])).toBe(true);
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

	describe('settle', () => {
		const issue = 'https://github.com/a/b/issues/60';
		const answer = () => json({ title: 'Remove the Go server', state: 'open' });

		it('fetches what is not yet known and resolves once it is', async () => {
			const fetcher = vi.fn(async () => answer());
			const previews = new LinkPreviews(fetcher as unknown as typeof fetch);
			await previews.settle(`see ${issue}`, [], 1000);
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(previews.embeds(issue)[0].og?.title).toBe('Remove the Go server');
		});

		it('has nothing to wait for without links, once they are known, when dismissed, or while their site is limited', async () => {
			let now = 1_000_000;
			const fetcher = vi.fn(async () => answer());
			const previews = new LinkPreviews(fetcher as unknown as typeof fetch, () => now);
			expect(previews.settle('no links here https://example.com', [], 1000)).toBeUndefined();
			expect(previews.settle(issue, [issue], 1000)).toBeUndefined();
			await previews.prefetch(issue);
			expect(previews.settle(issue, [], 1000)).toBeUndefined();
			const limited = new LinkPreviews((async () => json({}, 429, { 'retry-after': '60' })) as unknown as typeof fetch, () => now);
			await limited.prefetch(issue);
			expect(limited.settle('https://github.com/a/b/pull/2', [], 1000)).toBeUndefined();
			now += 61_000;
			expect(limited.settle('https://github.com/a/b/pull/2', [], 1000)).toBeInstanceOf(Promise);
		});

		it('stops waiting after its time, and the answer still arrives for later', async () => {
			vi.useFakeTimers();
			try {
				let reply!: (response: Response) => void;
				const previews = new LinkPreviews((() => new Promise<Response>((resolve) => (reply = resolve))) as unknown as typeof fetch);
				let settled = false;
				void previews.settle(issue, [], 1500)?.then(() => (settled = true));
				await vi.advanceTimersByTimeAsync(1499);
				expect(settled).toBe(false);
				await vi.advanceTimersByTimeAsync(1);
				expect(settled).toBe(true);
				expect(previews.embeds(issue)[0].og?.title).toBe('Issue #60');
				reply(answer());
				await vi.runAllTimersAsync();
				expect(previews.embeds(issue)[0].og?.title).toBe('Remove the Go server');
			} finally {
				vi.useRealTimers();
			}
		});
	});
});
