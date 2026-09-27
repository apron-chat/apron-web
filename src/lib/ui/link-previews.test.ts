import { describe, expect, it, vi } from 'vitest';
import { excerpt, findGitHubLinks, LinkPreviews, parseGitHubLink, previewFromApi } from './link-previews';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('GitHub links', () => {
	it('reads pull requests, issues, commits, and repositories', () => {
		expect(parseGitHubLink('https://github.com/shazow/apron/pull/60/files#diff')).toEqual({ type: 'issue', owner: 'shazow', repo: 'apron', number: 60, url: 'https://github.com/shazow/apron/pull/60' });
		expect(parseGitHubLink('https://www.github.com/shazow/apron/issues/7')).toMatchObject({ type: 'issue', number: 7, url: 'https://github.com/shazow/apron/issues/7' });
		expect(parseGitHubLink('https://github.com/shazow/apron/commit/5B0CC30abc')).toMatchObject({ type: 'commit', sha: '5b0cc30abc' });
		expect(parseGitHubLink('https://github.com/shazow/apron.git')).toEqual({ type: 'repo', owner: 'shazow', repo: 'apron', url: 'https://github.com/shazow/apron' });
	});

	it('ignores other pages and hosts', () => {
		expect(parseGitHubLink('https://github.com/shazow')).toBeUndefined();
		expect(parseGitHubLink('https://github.com/features/copilot')).toBeUndefined();
		expect(parseGitHubLink('https://github.com/shazow/apron/tree/main')).toBeUndefined();
		expect(parseGitHubLink('https://github.com/shazow/apron/pull/abc')).toBeUndefined();
		expect(parseGitHubLink('https://gitlab.com/shazow/apron/pull/1')).toBeUndefined();
		expect(parseGitHubLink('https://github.com.evil.example/a/b')).toBeUndefined();
	});

	it('finds distinct links in text, without trailing punctuation, up to three', () => {
		const text = 'see https://github.com/a/b/pull/1, and (https://github.com/a/b/issues/2). again https://github.com/a/b/pull/1 https://github.com/c/d https://github.com/e/f';
		expect(findGitHubLinks(text).map((link) => link.url)).toEqual(['https://github.com/a/b/pull/1', 'https://github.com/a/b/issues/2', 'https://github.com/c/d']);
	});
});

describe('previews', () => {
	it('boils markdown down to a short line', () => {
		expect(excerpt('<!-- template -->\n## Summary\n\n- Moves the **Go** server to [its repo](https://x).\n```sh\nmake\n```')).toBe('Summary Moves the Go server to its repo.');
		expect(excerpt('x'.repeat(300))).toHaveLength(200);
		expect(excerpt(null)).toBeUndefined();
	});

	it('describes pull requests and issues with their state and author', () => {
		const pull = parseGitHubLink('https://github.com/a/b/pull/60')!;
		expect(previewFromApi(pull, { title: 'Remove the Go server', state: 'closed', user: { login: 'shazow' }, body: 'Now in its own repo.', pull_request: { merged_at: '2026-09-01T00:00:00Z' } })).toEqual({
			site_name: 'GitHub · a/b', title: 'Remove the Go server', description: 'Pull request #60 · Merged · by shazow — Now in its own repo.'
		});
		const issue = parseGitHubLink('https://github.com/a/b/issues/3')!;
		expect(previewFromApi(issue, { title: 'Bug', state: 'closed', state_reason: 'not_planned', body: '' })?.description).toBe('Issue #3 · Closed as not planned');
		expect(previewFromApi(issue, {})).toBeUndefined();
	});

	it('describes commits and repositories', () => {
		const commit = parseGitHubLink('https://github.com/a/b/commit/5b0cc30')!;
		expect(previewFromApi(commit, { commit: { message: 'Fix it\n\nBecause.', author: { name: 'Ada' } } })).toEqual({ site_name: 'GitHub · a/b', title: 'Fix it', description: 'Commit 5b0cc30 · by Ada — Because.' });
		const repo = parseGitHubLink('https://github.com/a/b')!;
		expect(previewFromApi(repo, { full_name: 'a/b', description: 'A chat protocol', language: 'Go', stargazers_count: 1234 })).toEqual({ site_name: 'GitHub', title: 'a/b', description: 'A chat protocol — Go · ★ 1,234' });
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

	it('falls back to the URL for private links, and attaches nothing for an unknown repository', async () => {
		const fetcher = vi.fn(async () => json({ message: 'Not Found' }, 404));
		const previews = new LinkPreviews(fetcher as unknown as typeof fetch);
		await previews.prefetch('https://github.com/a/b/pull/1 https://github.com/c/d');
		expect(previews.embeds('https://github.com/a/b/pull/1 https://github.com/c/d')).toEqual([{ kind: 'link', url: 'https://github.com/a/b/pull/1', og: { site_name: 'GitHub · a/b', title: 'Pull request #1' } }]);
		await previews.prefetch('https://github.com/a/b/pull/1');
		expect(fetcher).toHaveBeenCalledTimes(2);
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

	it('survives a failed request', async () => {
		const previews = new LinkPreviews((async () => { throw new TypeError('offline'); }) as unknown as typeof fetch);
		await previews.prefetch('https://github.com/a/b/pull/1');
		expect(previews.embeds('https://github.com/a/b/pull/1')[0].og?.title).toBe('Pull request #1');
	});
});
