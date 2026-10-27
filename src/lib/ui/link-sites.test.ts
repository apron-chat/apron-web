import { describe, expect, it } from 'vitest';
import { bluesky, clip, excerpt, github, htmlText, siteFor, wikipedia, x, youtube, type Json, type Site } from './link-sites';

/** What `site` makes of `url`: its preview link, API request, and fallback. */
const lookup = (site: Site, url: string) => site.match(new URL(url));
/** The `og` `site` builds for `url` from the API's answer `data`. */
const preview = (site: Site, url: string, data: Json) => lookup(site, url)!.preview(data);

describe('sites by host', () => {
	it('maps hosts and their www-like subdomains, and any language of Wikipedia', () => {
		const name = (url: string) => siteFor(new URL(url))?.name;
		expect(name('https://github.com/a/b')).toBe('GitHub');
		expect(name('https://www.github.com/a/b')).toBe('GitHub');
		expect(name('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('YouTube');
		expect(name('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('YouTube');
		expect(name('https://mobile.twitter.com/jack/status/20')).toBe('X');
		expect(name('https://de.m.wikipedia.org/wiki/Ada_Lovelace')).toBe('Wikipedia');
		expect(name('https://gist.github.com/a/b')).toBeUndefined();
		expect(name('https://github.com.evil.example/a/b')).toBeUndefined();
		expect(name('https://evilgithub.com/a/b')).toBeUndefined();
	});

	it('asks only its own API, whatever the path holds', () => {
		const apis = new Set(['api.github.com', 'www.youtube.com', 'publish.x.com', 'public.api.bsky.app', 'en.wikipedia.org']);
		const hosts = ['github.com', 'youtu.be', 'www.youtube.com', 'x.com', 'bsky.app', 'en.wikipedia.org'];
		const paths = ['/a/b', '/a/b/pull/1', '/watch?v=dQw4w9WgXcQ', '/a/status/1', '/profile/a.example/post/x', '/wiki/A'];
		const hostile = ['/..', '/%2e%2e', '/%2F%2Fevil.example', '/@evil.example', '/%3F', '/%23', '/..%2F..%2Fevil.example%2F'];
		for (const host of hosts) {
			for (const path of paths) {
				for (const bad of hostile) {
					for (const href of [`https://${host}${path}${bad}`, `https://${host}${bad}${path}`]) {
						const url = new URL(href);
						const lookup = siteFor(url)?.match(url);
						if (lookup) expect(apis, href).toContain(new URL(lookup.api).hostname);
					}
				}
			}
		}
	});
});

describe('text', () => {
	it('boils markdown down to a short line', () => {
		expect(excerpt('<!-- template -->\n## Summary\n\n- Moves the **Go** server to [its repo](https://x).\n```sh\nmake\n```')).toBe('Moves the Go server to its repo.');
		expect(excerpt('x'.repeat(300))).toHaveLength(200);
		expect(excerpt(null)).toBeUndefined();
	});

	it('cuts text by code point, never inside an emoji', () => {
		const cut = clip(`${'x'.repeat(198)}😀 tail`)!;
		expect(cut).toBe(`${'x'.repeat(198)}😀…`);
		expect(cut.isWellFormed()).toBe(true);
	});

	it('reads the text of HTML', () => {
		expect(htmlText('a<br>b <a href="x">c</a> &amp; &mdash; &#39;d&#x27; &#128512; &bogus;')).toBe("a b c & — 'd' 😀 &bogus;");
	});
});

describe('GitHub', () => {
	it('reads pull requests, issues, commits, and repositories, and ignores other pages', () => {
		expect(lookup(github, 'https://github.com/shazow/apron/pull/60/files#diff')).toMatchObject({
			url: 'https://github.com/shazow/apron/pull/60', api: 'https://api.github.com/repos/shazow/apron/issues/60', fallback: { site_name: 'GitHub · shazow/apron', title: 'Pull request #60' }
		});
		expect(lookup(github, 'https://github.com/shazow/apron/issues/7')).toMatchObject({ url: 'https://github.com/shazow/apron/issues/7', fallback: { title: 'Issue #7' } });
		expect(lookup(github, 'https://github.com/shazow/apron/commit/5B0CC30abc')).toMatchObject({ api: 'https://api.github.com/repos/shazow/apron/commits/5b0cc30abc', fallback: { title: 'Commit 5b0cc30' } });
		expect(lookup(github, 'https://github.com/shazow/apron.git')).toMatchObject({ url: 'https://github.com/shazow/apron', api: 'https://api.github.com/repos/shazow/apron' });
		expect(lookup(github, 'https://github.com/shazow/apron')?.fallback).toBeUndefined();
		expect(lookup(github, 'https://github.com/shazow')).toBeUndefined();
		expect(lookup(github, 'https://github.com/features/copilot')).toBeUndefined();
		expect(lookup(github, 'https://github.com/shazow/apron/tree/main')).toBeUndefined();
		expect(lookup(github, 'https://github.com/shazow/apron/pull/abc')).toBeUndefined();
	});

	it('describes pull requests and issues with their state and author, and commits and repositories', () => {
		expect(preview(github, 'https://github.com/a/b/pull/60', { title: 'Remove the Go server', state: 'closed', user: { login: 'shazow' }, body: 'Now in its own repo.', pull_request: { merged_at: '2026-09-01T00:00:00Z' } })).toEqual({
			site_name: 'GitHub · a/b', title: 'Remove the Go server', description: 'Pull request #60 · Merged · by shazow — Now in its own repo.'
		});
		expect(preview(github, 'https://github.com/a/b/issues/3', { title: 'Bug', state: 'closed', state_reason: 'not_planned', body: '' })?.description).toBe('Issue #3 · Closed as not planned');
		expect(preview(github, 'https://github.com/a/b/issues/3', {})).toBeUndefined();
		expect(preview(github, 'https://github.com/a/b/commit/5b0cc30', { commit: { message: 'Fix it\n\nBecause.', author: { name: 'Ada' } } })).toEqual({ site_name: 'GitHub · a/b', title: 'Fix it', description: 'Commit 5b0cc30 · by Ada — Because.' });
		expect(preview(github, 'https://github.com/a/b', { full_name: 'a/b', description: 'A chat protocol', language: 'Go', stargazers_count: 1234 })).toEqual({ site_name: 'GitHub', title: 'a/b', description: 'A chat protocol — Go · ★ 1,234' });
		expect(preview(github, 'https://github.com/a/b', { full_name: 'a/b', description: 'New', stargazers_count: 0 })?.description).toBe('New');
	});
});

describe('YouTube', () => {
	it('reads every form of a video link as its watch page', () => {
		const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
		for (const url of [watch, 'https://youtu.be/dQw4w9WgXcQ?t=42', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ']) {
			expect(lookup(youtube, url)).toMatchObject({ url: watch, api: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}` });
			expect(lookup(youtube, url)?.fallback).toBeUndefined();
		}
		expect(lookup(youtube, 'https://www.youtube.com/@RickAstleyYT')).toBeUndefined();
		expect(lookup(youtube, 'https://www.youtube.com/watch?v=short')).toBeUndefined();
	});

	it('describes a video by its title and channel', () => {
		const data = { title: 'Rick Astley - Never Gonna Give You Up', author_name: 'Rick Astley', provider_name: 'YouTube', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' };
		expect(preview(youtube, 'https://youtu.be/dQw4w9WgXcQ', data)).toEqual({ site_name: 'YouTube · Rick Astley', title: 'Rick Astley - Never Gonna Give You Up' });
		expect(preview(youtube, 'https://youtu.be/dQw4w9WgXcQ', {})).toBeUndefined();
	});
});

describe('X', () => {
	it('reads posts on x.com and twitter.com as x.com posts', () => {
		for (const url of ['https://x.com/jack/status/20', 'https://twitter.com/jack/status/20?s=20', 'https://mobile.twitter.com/jack/status/20/photo/1']) {
			expect(lookup(x, url)).toMatchObject({
				url: 'https://x.com/jack/status/20',
				api: `https://publish.x.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent('https://x.com/jack/status/20')}`,
				fallback: { site_name: 'X', title: 'Post by @jack' }
			});
		}
		expect(lookup(x, 'https://x.com/i/status/20')?.fallback).toBeUndefined();
		expect(lookup(x, 'https://x.com/jack')).toBeUndefined();
		expect(lookup(x, 'https://x.com/jack/likes')).toBeUndefined();
	});

	it("describes a post by its author, date, and text from the oEmbed blockquote", () => {
		const html = '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">just setting up my twttr &amp; <a href="https://t.co/x">more</a></p>&mdash; jack (@jack) <a href="https://x.com/jack/status/20?ref_src=twsrc%5Etfw">March 21, 2006</a></blockquote>\n\n';
		expect(preview(x, 'https://x.com/i/status/20', { author_name: 'jack', author_url: 'https://x.com/jack', html })).toEqual({
			site_name: 'X · March 21, 2006', title: 'jack (@jack)', description: 'just setting up my twttr & more'
		});
		expect(preview(x, 'https://x.com/jack/status/20', {})).toEqual({ site_name: 'X', title: '@jack' });
		expect(preview(x, 'https://x.com/i/status/20', {})).toBeUndefined();
	});
});

describe('Bluesky', () => {
	it('reads posts and profiles, by handle or DID', () => {
		expect(lookup(bluesky, 'https://bsky.app/profile/jay.bsky.team/post/3mymxa653fs27')).toMatchObject({
			url: 'https://bsky.app/profile/jay.bsky.team/post/3mymxa653fs27',
			api: `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?depth=0&parentHeight=0&uri=${encodeURIComponent('at://jay.bsky.team/app.bsky.feed.post/3mymxa653fs27')}`,
			fallback: { site_name: 'Bluesky', title: 'Post by @jay.bsky.team' }
		});
		expect(lookup(bluesky, 'https://bsky.app/profile/did:plc:oky5czdrnfjpqslsw2a5iclo/post/3mymxa653fs27')?.fallback).toBeUndefined();
		expect(lookup(bluesky, 'https://bsky.app/profile/Jay.Bsky.Team')?.url).toBe('https://bsky.app/profile/jay.bsky.team');
		expect(lookup(bluesky, 'https://bsky.app/profile/did:plc:AbC/post/3mymxa653fs27')?.url).toBe('https://bsky.app/profile/did:plc:AbC/post/3mymxa653fs27');
		expect(lookup(bluesky, 'https://bsky.app/profile/jay.bsky.team')).toMatchObject({ api: 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=jay.bsky.team' });
		expect(lookup(bluesky, 'https://bsky.app/profile/jay.bsky.team')?.fallback).toBeUndefined();
		expect(lookup(bluesky, 'https://bsky.app/profile/jay.bsky.team/lists/abc')).toBeUndefined();
		expect(lookup(bluesky, 'https://bsky.app/search?q=x')).toBeUndefined();
	});

	it('describes a post by its author and text, and a profile by its bio', () => {
		const author = { handle: 'catsofyore.bsky.social', displayName: 'Cats of Yore' };
		expect(preview(bluesky, 'https://bsky.app/profile/catsofyore.bsky.social/post/3mymxa653fs27', { thread: { post: { author, record: { text: 'Snow puff!\nPhoto from my collection.' } } } })).toEqual({
			site_name: 'Bluesky', title: 'Cats of Yore (@catsofyore.bsky.social)', description: 'Snow puff! Photo from my collection.'
		});
		expect(preview(bluesky, 'https://bsky.app/profile/a.example/post/3mymxa653fs27', { thread: { $type: 'app.bsky.feed.defs#notFoundPost', notFound: true } })).toBeUndefined();
		expect(preview(bluesky, 'https://bsky.app/profile/jay.bsky.team', { handle: 'jay.bsky.team', displayName: '', description: 'Founder' })).toEqual({ site_name: 'Bluesky', title: '@jay.bsky.team', description: 'Founder' });
	});
});

describe('Wikipedia', () => {
	it('reads articles in any language, with their title from the URL until the summary comes', () => {
		expect(lookup(wikipedia, 'https://en.wikipedia.org/wiki/Mercury_(planet)#Orbit')).toMatchObject({
			url: 'https://en.wikipedia.org/wiki/Mercury_(planet)', api: 'https://en.wikipedia.org/api/rest_v1/page/summary/Mercury_(planet)', fallback: { site_name: 'Wikipedia', title: 'Mercury (planet)' }
		});
		expect(lookup(wikipedia, 'https://de.m.wikipedia.org/wiki/K%C3%B6ln')).toMatchObject({ url: 'https://de.wikipedia.org/wiki/K%C3%B6ln', fallback: { title: 'Köln' } });
		for (const url of ['https://en.wikipedia.org/wiki/AC/DC', 'https://en.wikipedia.org/wiki/AC%2FDC']) {
			expect(lookup(wikipedia, url)).toMatchObject({ url: 'https://en.wikipedia.org/wiki/AC%2FDC', api: 'https://en.wikipedia.org/api/rest_v1/page/summary/AC%2FDC', fallback: { title: 'AC/DC' } });
		}
		expect(lookup(wikipedia, 'https://en.wikipedia.org/wiki/Special:Random')).toBeUndefined();
		expect(lookup(wikipedia, 'https://en.wikipedia.org/w/index.php?title=Ada')).toBeUndefined();
		expect(lookup(wikipedia, 'https://www.wikipedia.org/wiki/Ada')).toBeUndefined();
		expect(lookup(wikipedia, 'https://en.wikipedia.org/wiki/%E0%A4%A')).toBeUndefined();
	});

	it('describes an article by its title and opening sentences', () => {
		const data = { type: 'standard', title: 'Ada Lovelace', description: 'English mathematician (1815–1852)', extract: 'Augusta Ada King, Countess of Lovelace, was an English mathematician.' };
		expect(preview(wikipedia, 'https://en.wikipedia.org/wiki/Ada_Lovelace', data)).toEqual({ site_name: 'Wikipedia', title: 'Ada Lovelace', description: 'Augusta Ada King, Countess of Lovelace, was an English mathematician.' });
		expect(preview(wikipedia, 'https://en.wikipedia.org/wiki/Ada_Lovelace', { title: 'Ada Lovelace', description: 'English mathematician' })?.description).toBe('English mathematician');
		expect(preview(wikipedia, 'https://en.wikipedia.org/wiki/Ada_Lovelace', {})).toBeUndefined();
	});
});
