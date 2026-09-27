/**
 * Link previews the sender builds for links in a message: `link` embeds whose
 * `og` (PROTOCOL.md §4.6.1) describes what the link points to. The server has
 * the last word on `og` and may keep, replace, or drop it.
 *
 * Only GitHub is supported: its REST API allows cross-origin reads, so the
 * browser can describe a pull request, issue, commit, or repository without
 * a server. A preview is fetched when a link is pasted; a message sent before
 * it arrives, or for a private repository, gets a card built from the URL.
 */
import type { Embed, OpenGraph } from '$lib/protocol/types';

/** At most this many previews per message. */
export const LINK_PREVIEWS_MAX = 3;
const DESCRIPTION_MAX = 200;
const CACHE_MAX = 100;
const API = 'https://api.github.com';

export type GitHubLink =
	| { type: 'issue'; owner: string; repo: string; number: number; url: string }
	| { type: 'commit'; owner: string; repo: string; sha: string; url: string }
	| { type: 'repo'; owner: string; repo: string; url: string };

const GITHUB_URL = /https?:\/\/(?:www\.)?github\.com\/[^\s<>()[\]{}"'`]+/gi;
const NAME = /^[A-Za-z0-9_.-]+$/;
/** First path segments that are GitHub's own pages, not owners. */
const RESERVED = new Set([
	'about', 'apps', 'blog', 'collections', 'contact', 'customer-stories', 'enterprise', 'events', 'explore', 'features',
	'login', 'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'issues', 'search',
	'security', 'settings', 'site', 'sponsors', 'topics', 'trending'
]);

/** A GitHub pull request, issue, commit, or repository URL, as the API names it; anything else is undefined. */
export function parseGitHubLink(value: string): GitHubLink | undefined {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return undefined;
	}
	if (!/^https?:$/.test(parsed.protocol) || !/^(www\.)?github\.com$/i.test(parsed.hostname)) return undefined;
	const [owner, repo, section, id] = parsed.pathname.split('/').filter(Boolean);
	if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo) || RESERVED.has(owner.toLowerCase())) return undefined;
	const name = repo.replace(/\.git$/, '');
	const base = `https://github.com/${owner}/${name}`;
	if (section === undefined) return { type: 'repo', owner, repo: name, url: base };
	if ((section === 'pull' || section === 'issues') && id && /^\d+$/.test(id)) {
		return { type: 'issue', owner, repo: name, number: Number(id), url: `${base}/${section}/${id}` };
	}
	if (section === 'commit' && id && /^[0-9a-f]{7,40}$/i.test(id)) return { type: 'commit', owner, repo: name, sha: id.toLowerCase(), url: `${base}/commit/${id}` };
	return undefined;
}

/** The distinct GitHub links in a message's text, in order, up to `LINK_PREVIEWS_MAX`. */
export function findGitHubLinks(text: string): GitHubLink[] {
	const found = new Map<string, GitHubLink>();
	for (const match of text.matchAll(GITHUB_URL)) {
		const link = parseGitHubLink(match[0].replace(/[.,:;!?*_~]+$/, ''));
		if (link && !found.has(link.url)) found.set(link.url, link);
		if (found.size >= LINK_PREVIEWS_MAX) break;
	}
	return [...found.values()];
}

/** What the URL alone says, for a link whose details aren't known; a repository link alone says too little. */
export function fallbackPreview(link: GitHubLink): OpenGraph | undefined {
	const site_name = `GitHub · ${link.owner}/${link.repo}`;
	if (link.type === 'issue') return { site_name, title: `${link.url.includes('/pull/') ? 'Pull request' : 'Issue'} #${link.number}` };
	if (link.type === 'commit') return { site_name, title: `Commit ${link.sha.slice(0, 7)}` };
	return undefined;
}

/** Markdown reduced to a line of plain text, cut to fit a card; headings and HTML comments (as in PR templates) are left out. */
export function excerpt(markdown: unknown): string | undefined {
	if (typeof markdown !== 'string') return undefined;
	const text = markdown
		.replace(/<!--[\s\S]*?(-->|$)/g, ' ')
		.replace(/```[\s\S]*?(```|$)/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ')
		.replace(/^\s{0,3}(>|[-*+]|\d+\.)\s+/gm, '')
		.replace(/[`*_~]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!text) return undefined;
	return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : text;
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

/** The `og` for an API response about `link`. */
export function previewFromApi(link: GitHubLink, data: Json): OpenGraph | undefined {
	const site_name = `GitHub · ${link.owner}/${link.repo}`;
	if (link.type === 'issue') {
		const title = str(data.title);
		if (!title) return undefined;
		const pull = record(data.pull_request);
		const isPull = Object.keys(pull).length > 0;
		const state = isPull
			? (str(pull.merged_at) ? 'Merged' : data.state === 'closed' ? 'Closed' : data.draft ? 'Draft' : 'Open')
			: data.state === 'closed' ? (data.state_reason === 'not_planned' ? 'Closed as not planned' : 'Closed') : 'Open';
		const author = str(record(data.user).login);
		const summary = [`${isPull ? 'Pull request' : 'Issue'} #${link.number}`, state, author && `by ${author}`].filter(Boolean).join(' · ');
		const body = excerpt(data.body);
		return { site_name, title, description: body ? `${summary} — ${body}` : summary };
	}
	if (link.type === 'commit') {
		const commit = record(data.commit);
		const message = str(commit.message);
		if (!message) return undefined;
		const [subject, ...rest] = message.split('\n');
		const author = str(record(data.author).login) ?? str(record(commit.author).name);
		const summary = [`Commit ${link.sha.slice(0, 7)}`, author && `by ${author}`].filter(Boolean).join(' · ');
		const body = excerpt(rest.join('\n'));
		return { site_name, title: subject.trim(), description: body ? `${summary} — ${body}` : summary };
	}
	const name = str(data.full_name);
	if (!name) return undefined;
	const stars = typeof data.stargazers_count === 'number' && data.stargazers_count > 0 ? `★ ${data.stargazers_count.toLocaleString('en-US')}` : undefined;
	const details = [str(data.language), stars].filter(Boolean).join(' · ');
	const description = [excerpt(data.description), details].filter(Boolean).join(' — ');
	return { site_name: 'GitHub', title: name, ...(description ? { description } : {}) };
}

function apiPath(link: GitHubLink): string {
	const repo = `/repos/${link.owner}/${link.repo}`;
	if (link.type === 'issue') return `${repo}/issues/${link.number}`;
	if (link.type === 'commit') return `${repo}/commits/${link.sha}`;
	return repo;
}

/**
 * Fetches and remembers previews by link. Unauthenticated API calls are
 * limited per IP, so each link is asked for once, and a rate-limited answer
 * holds further requests until the limit resets.
 */
export class LinkPreviews {
	private readonly known = new Map<string, OpenGraph | null>();
	private readonly pending = new Map<string, Promise<void>>();
	private blockedUntil = 0;

	constructor(private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args), private readonly now: () => number = Date.now) {}

	/** Starts fetching previews for the GitHub links in `text`; resolves when they have settled. */
	prefetch(text: string): Promise<void> {
		return Promise.all(findGitHubLinks(text).map((link) => this.load(link))).then(() => undefined);
	}

	/** `link` embeds for the GitHub links in `text`: fetched details where they've arrived, else what the URL says. */
	embeds(text: string): Embed[] {
		return findGitHubLinks(text).flatMap((link) => {
			const og = this.known.get(link.url) ?? fallbackPreview(link);
			return og ? [{ kind: 'link', url: link.url, og }] : [];
		});
	}

	private load(link: GitHubLink): Promise<void> {
		if (this.known.has(link.url)) return Promise.resolve();
		const running = this.pending.get(link.url);
		if (running) return running;
		if (this.now() < this.blockedUntil) return Promise.resolve();
		const request = this.request(link).finally(() => this.pending.delete(link.url));
		this.pending.set(link.url, request);
		return request;
	}

	private async request(link: GitHubLink): Promise<void> {
		let response: Response;
		try {
			response = await this.fetcher(`${API}${apiPath(link)}`, { credentials: 'omit', headers: { Accept: 'application/vnd.github+json' } });
		} catch {
			return;
		}
		if (response.status === 403 || response.status === 429) {
			const reset = Number(response.headers.get('x-ratelimit-reset'));
			this.blockedUntil = Number.isFinite(reset) && reset > 0 ? reset * 1000 : this.now() + 60_000;
			return;
		}
		let og: OpenGraph | undefined;
		if (response.ok) {
			try {
				og = previewFromApi(link, record(await response.json()));
			} catch {
				return;
			}
		} else if (response.status !== 404) {
			return;
		}
		// A 404 (private, or not there) is remembered too, so it isn't asked for again.
		this.remember(link.url, og ?? null);
	}

	private remember(url: string, og: OpenGraph | null): void {
		if (this.known.size >= CACHE_MAX) this.known.delete(this.known.keys().next().value as string);
		this.known.set(url, og);
	}
}

/** The page's previews, shared by every room's composer. */
export const linkPreviews = new LinkPreviews();
