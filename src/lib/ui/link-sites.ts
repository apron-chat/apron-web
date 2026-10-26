/**
 * The sites whose links get a preview, by host, and how each describes one of
 * its links: a public API that allows cross-origin reads, so the browser can
 * ask without a server. `link-previews.ts` finds the links and does the asking.
 */
import type { OpenGraph } from '$lib/protocol/types';

const DESCRIPTION_MAX = 200;

export type Json = Record<string, unknown>;
export const record = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

/** How to describe one link: what to ask, and what the answer says. */
export interface Lookup {
	/** The link as its preview names it: one address per page, so the same page linked two ways is one preview. */
	url: string;
	/** The API request that describes it. */
	api: string;
	headers?: Record<string, string>;
	/** The `og` for the API's answer, or undefined when it describes nothing. */
	preview(data: Json): OpenGraph | undefined;
	/** What the URL alone says, shown until the answer arrives; undefined when that is too little. */
	fallback?: OpenGraph;
}

export interface Site {
	/** Names the site, which is asked and rate limited apart from the others. */
	name: string;
	/** The lookup for `url`, or undefined for a page this site doesn't describe. */
	match(url: URL): Lookup | undefined;
	/** Statuses that say the link has nothing to describe (gone, private, or not a page), remembered so it isn't asked for again. Default 404. */
	missing?: readonly number[];
	/** Statuses that say requests are being limited, holding further ones until the limit resets. Default 429. */
	limited?: readonly number[];
	/** Any subdomain of its host is this site too (for `match` to check), not only `www.` and its like. */
	subdomains?: boolean;
}

/** Text as one line, cut to fit a card. */
export function clip(text: unknown): string | undefined {
	if (typeof text !== 'string') return undefined;
	const line = text.replace(/\s+/g, ' ').trim();
	if (!line) return undefined;
	return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : line;
}

/** Markdown reduced to a line of plain text, cut to fit a card; headings and HTML comments (as in PR templates) are left out. */
export function excerpt(markdown: unknown): string | undefined {
	if (typeof markdown !== 'string') return undefined;
	return clip(
		markdown
			.replace(/<!--[\s\S]*?(-->|$)/g, ' ')
			.replace(/```[\s\S]*?(```|$)/g, ' ')
			.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/<[^>]+>/g, ' ')
			.replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ')
			.replace(/^\s{0,3}(>|[-*+]|\d+\.)\s+/gm, '')
			.replace(/[`*_~]+/g, '')
	);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…' };

/** An HTML fragment's text: tags dropped, `<br>` as a space, entities decoded. */
export function htmlText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<[^>]*>/g, '')
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
			if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
			const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
		});
}

/** `/a/b/` as `['a', 'b']`, each segment decoded; undefined if one can't be. */
function segments(url: URL): string[] | undefined {
	try {
		return url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
	} catch {
		return undefined;
	}
}

const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;
/** First path segments that are GitHub's own pages, not owners. */
const GITHUB_RESERVED = new Set([
	'about', 'apps', 'blog', 'collections', 'contact', 'customer-stories', 'enterprise', 'events', 'explore', 'features',
	'login', 'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'issues', 'search',
	'security', 'settings', 'site', 'sponsors', 'topics', 'trending'
]);

/**
 * GitHub pull requests, issues, commits, and repositories, from its REST API.
 * Unauthenticated calls are limited per IP, and an exhausted limit answers 403.
 */
export const github: Site = {
	name: 'GitHub',
	limited: [403, 429],
	match(url) {
		const [owner, repo, section, id] = url.pathname.split('/').filter(Boolean);
		if (!owner || !repo || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo) || GITHUB_RESERVED.has(owner.toLowerCase())) return undefined;
		const name = repo.replace(/\.git$/, '');
		const base = `https://github.com/${owner}/${name}`;
		const api = `https://api.github.com/repos/${owner}/${name}`;
		const headers = { Accept: 'application/vnd.github+json' };
		const site_name = `GitHub · ${owner}/${name}`;
		if (section === undefined) return { url: base, api, headers, preview: githubRepo };
		if ((section === 'pull' || section === 'issues') && id && /^\d+$/.test(id)) {
			const label = `${section === 'pull' ? 'Pull request' : 'Issue'} #${id}`;
			return { url: `${base}/${section}/${id}`, api: `${api}/issues/${id}`, headers, preview: (data) => githubIssue(site_name, id, data), fallback: { site_name, title: label } };
		}
		if (section === 'commit' && id && /^[0-9a-f]{7,40}$/i.test(id)) {
			const sha = id.toLowerCase();
			return { url: `${base}/commit/${id}`, api: `${api}/commits/${sha}`, headers, preview: (data) => githubCommit(site_name, sha, data), fallback: { site_name, title: `Commit ${sha.slice(0, 7)}` } };
		}
		return undefined;
	}
};

function githubIssue(site_name: string, number: string, data: Json): OpenGraph | undefined {
	const title = str(data.title);
	if (!title) return undefined;
	const pull = record(data.pull_request);
	const isPull = Object.keys(pull).length > 0;
	const state = isPull
		? (str(pull.merged_at) ? 'Merged' : data.state === 'closed' ? 'Closed' : data.draft ? 'Draft' : 'Open')
		: data.state === 'closed' ? (data.state_reason === 'not_planned' ? 'Closed as not planned' : 'Closed') : 'Open';
	const author = str(record(data.user).login);
	const summary = [`${isPull ? 'Pull request' : 'Issue'} #${number}`, state, author && `by ${author}`].filter(Boolean).join(' · ');
	const body = excerpt(data.body);
	return { site_name, title, description: body ? `${summary} — ${body}` : summary };
}

function githubCommit(site_name: string, sha: string, data: Json): OpenGraph | undefined {
	const commit = record(data.commit);
	const message = str(commit.message);
	if (!message) return undefined;
	const [subject, ...rest] = message.split('\n');
	const author = str(record(data.author).login) ?? str(record(commit.author).name);
	const summary = [`Commit ${sha.slice(0, 7)}`, author && `by ${author}`].filter(Boolean).join(' · ');
	const body = excerpt(rest.join('\n'));
	return { site_name, title: subject.trim(), description: body ? `${summary} — ${body}` : summary };
}

function githubRepo(data: Json): OpenGraph | undefined {
	const name = str(data.full_name);
	if (!name) return undefined;
	const stars = typeof data.stargazers_count === 'number' && data.stargazers_count > 0 ? `★ ${data.stargazers_count.toLocaleString('en-US')}` : undefined;
	const details = [str(data.language), stars].filter(Boolean).join(' · ');
	const description = [excerpt(data.description), details].filter(Boolean).join(' — ');
	return { site_name: 'GitHub', title: name, ...(description ? { description } : {}) };
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * YouTube videos, from its oEmbed endpoint: the title and channel. A video
 * that is private, removed, or not embeddable answers 401, 403, or 404, and a
 * malformed one 400.
 */
export const youtube: Site = {
	name: 'YouTube',
	missing: [400, 401, 403, 404],
	match(url) {
		const [first, second] = url.pathname.split('/').filter(Boolean);
		const id = url.hostname === 'youtu.be' ? first
			: first === 'watch' ? url.searchParams.get('v')
			: first === 'shorts' || first === 'live' || first === 'embed' ? second
			: undefined;
		if (!id || !YOUTUBE_ID.test(id)) return undefined;
		const watch = `https://www.youtube.com/watch?v=${id}`;
		return {
			url: watch,
			api: `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`,
			preview(data) {
				const title = str(data.title);
				const channel = str(data.author_name);
				return title ? { site_name: channel ? `YouTube · ${channel}` : 'YouTube', title } : undefined;
			}
		};
	}
};

const X_USER = /^[A-Za-z0-9_]{1,15}$/;

/**
 * Posts on X, from its oEmbed endpoint, whose answer carries the post only as
 * an HTML blockquote: the text, then the author and date.
 */
export const x: Site = {
	name: 'X',
	missing: [400, 403, 404],
	match(url) {
		const [user, section, id] = url.pathname.split('/').filter(Boolean);
		if (!user || !X_USER.test(user) || section !== 'status' || !id || !/^\d{1,20}$/.test(id)) return undefined;
		const post = `https://x.com/${user}/status/${id}`;
		// `/i/status/<id>` names no author.
		const known = user.toLowerCase() !== 'i';
		return {
			url: post,
			api: `https://publish.x.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(post)}`,
			preview(data) {
				const author = str(data.author_name);
				const handle = str(data.author_url)?.match(/\/([A-Za-z0-9_]{1,15})$/)?.[1] ?? (known ? user : undefined);
				if (!author && !handle) return undefined;
				const html = str(data.html) ?? '';
				const text = clip(htmlText(html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? ''));
				const date = clip(htmlText([...html.matchAll(/<a\b[^>]*>([^<]*)<\/a>/gi)].at(-1)?.[1] ?? ''));
				return {
					site_name: date ? `X · ${date}` : 'X',
					title: author && handle ? `${author} (@${handle})` : author ?? `@${handle}`,
					...(text ? { description: text } : {})
				};
			},
			fallback: known ? { site_name: 'X', title: `Post by @${user}` } : undefined
		};
	}
};

const BLUESKY_API = 'https://public.api.bsky.app/xrpc';
const BLUESKY_ACTOR = /^(did:[a-z]+:[A-Za-z0-9._:%-]+|[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+)$/;

/**
 * Bluesky posts and profiles, from its public AppView, which names a missing
 * post or account with a 400.
 */
export const bluesky: Site = {
	name: 'Bluesky',
	missing: [400, 404],
	match(url) {
		const [profile, actor, section, rkey] = url.pathname.split('/').filter(Boolean);
		if (profile !== 'profile' || !actor || !BLUESKY_ACTOR.test(actor)) return undefined;
		const base = `https://bsky.app/profile/${actor}`;
		if (section === undefined) {
			return { url: base, api: `${BLUESKY_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`, preview: blueskyProfile };
		}
		if (section !== 'post' || !rkey || !/^[A-Za-z0-9._:~-]{1,512}$/.test(rkey)) return undefined;
		const uri = `at://${actor}/app.bsky.feed.post/${rkey}`;
		return {
			url: `${base}/post/${rkey}`,
			api: `${BLUESKY_API}/app.bsky.feed.getPostThread?depth=0&parentHeight=0&uri=${encodeURIComponent(uri)}`,
			preview: blueskyPost,
			fallback: actor.startsWith('did:') ? undefined : { site_name: 'Bluesky', title: `Post by @${actor}` }
		};
	}
};

/** "Name (@handle)", or whichever of the two an account has. */
function blueskyName(author: Json): string | undefined {
	const name = clip(author.displayName);
	const handle = str(author.handle);
	return name && handle ? `${name} (@${handle})` : name ?? (handle && `@${handle}`);
}

function blueskyPost(data: Json): OpenGraph | undefined {
	// A thread whose post is missing or blocked has no `record`.
	const post = record(record(data.thread).post);
	const title = blueskyName(record(post.author));
	if (!title || !Object.keys(record(post.record)).length) return undefined;
	const text = clip(record(post.record).text);
	return { site_name: 'Bluesky', title, ...(text ? { description: text } : {}) };
}

function blueskyProfile(data: Json): OpenGraph | undefined {
	const title = blueskyName(data);
	if (!title) return undefined;
	const bio = clip(data.description);
	return { site_name: 'Bluesky', title, ...(bio ? { description: bio } : {}) };
}

/**
 * Wikipedia articles in any language, from its REST API's page summary: the
 * title and the lead's opening sentences. It follows redirects itself.
 */
export const wikipedia: Site = {
	name: 'Wikipedia',
	subdomains: true,
	match(url) {
		const lang = url.hostname.match(/^([a-z][a-z0-9-]{1,20})\.(?:m\.)?wikipedia\.org$/)?.[1];
		const [wiki, ...parts] = segments(url) ?? [];
		// A title may hold a slash, written as one or as %2F.
		const title = parts.join('/');
		if (!lang || lang === 'www' || wiki !== 'wiki' || !title || /^special:/i.test(title)) return undefined;
		const path = encodeURIComponent(title.replace(/ /g, '_'));
		return {
			url: `https://${lang}.wikipedia.org/wiki/${path}`,
			api: `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${path}`,
			preview(data) {
				const name = str(data.title);
				if (!name) return undefined;
				const description = clip(data.extract) ?? clip(data.description);
				return { site_name: 'Wikipedia', title: name, ...(description ? { description } : {}) };
			},
			fallback: { site_name: 'Wikipedia', title: title.replace(/_/g, ' ') }
		};
	}
};

/** The sites with previews, by host; see `siteFor` for their subdomains. */
export const SITES: Record<string, Site> = {
	'github.com': github,
	'youtube.com': youtube,
	'youtu.be': youtube,
	'x.com': x,
	'twitter.com': x,
	'bsky.app': bluesky,
	'wikipedia.org': wikipedia
};

/** Subdomains that are the same site as their parent; others (such as gist.github.com) are not. */
const SAME_SITE = new Set(['www', 'm', 'mobile', 'music']);

/** The site that previews `url`, if any: the one its host names, or its parent domain's. */
export function siteFor(url: URL, sites: Record<string, Site> = SITES): Site | undefined {
	const labels = url.hostname.toLowerCase().split('.');
	for (let i = 0; i < labels.length - 1; i++) {
		const site = sites[labels.slice(i).join('.')];
		if (site) return site.subdomains || labels.slice(0, i).every((label) => SAME_SITE.has(label)) ? site : undefined;
	}
	return undefined;
}
