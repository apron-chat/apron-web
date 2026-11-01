/**
 * The one way markup from anyone else reaches the page (Svelte's `@html`): a message's body, a description, a bio, a
 * server's welcome, an HTML embed. DOMPurify keeps only what each allows, then every URL that would load
 * (an image's, a video's, its poster's) is asked of `media`, the page's media gate (`$lib/ui/media-gate`): one
 * that may not load waits for a click where the gate says one may load it (Load, Always load: `$lib/ui/media-ask`),
 * else becomes a link to it, so media loads from where the viewer chose and from nowhere else, whatever the markup
 * is; media inline in the markup (`data:`) loads from nowhere, so it stays. Nothing is fetched while that is
 * decided: the check works in an inert document.
 */
import DOMPurify, { type Config } from 'dompurify';

/** Where media may load from, as `$lib/ui/media-gate`'s gates answer: `key` changes whenever the answers do. */
export interface MediaCheck {
	readonly key: string;
	src(value: unknown): string | undefined;
	/** Media that may not load but may on a click: where it is, its site, and its origin where that can be trusted. */
	ask?(value: unknown): MediaAskAt | undefined;
}

export interface MediaAskAt {
	url: string;
	host: string;
	origin?: string;
}

/** Lets no media load from anywhere (`data:` aside, which loads from nowhere): where nothing is known of where it may. */
export const NOWHERE: MediaCheck = { key: 'none', src: () => undefined };

/**
 * `message`: what a body holds once rendered, what CommonMark produces plus the links, mention chips and custom
 * emoji added to it; raw HTML never gets this far, and sanitizing last also covers everything done after rendering.
 * `embed`: an HTML embed (§4.8), as its server sent it, without scripts, styles, forms or anything but HTML.
 */
const CONFIGS: Record<'message' | 'embed', Config> = {
	message: {
		ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a', 'img', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'button'],
		ALLOWED_ATTR: ['href', 'title', 'src', 'alt', 'start', 'class', 'rel', 'target', 'type', 'data-user-id', 'data-room-id'],
		ALLOW_DATA_ATTR: false,
		// DOMPurify's own list of URL schemes, and Apron links' (Appendix A.4), which the page opens itself.
		ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|apron):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
	},
	// No `data-` attribute either: Load, Always load and Block (`data-media-load`, `data-media-trust`, `data-media-block`) are written only here.
	embed: { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button'], FORBID_ATTR: ['style'], ALLOW_DATA_ATTR: false }
};

export type SanitizeKind = keyof typeof CONFIGS;

/** A custom emoji's `style`, as `customEmojiTag` writes it: its aspect ratio, and nothing else. */
const EMOJI_STYLE = /^aspect-ratio: \d+(?:\.\d+)? \/ \d+(?:\.\d+)?$/;

// The one `style` let through: a custom emoji's aspect ratio (`ext:emoji`), on its own image.
if (DOMPurify.isSupported) {
	DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
		if (data.attrName === 'style' && node.nodeName === 'IMG' && (node as Element).classList.contains('ap-cemoji') && EMOJI_STYLE.test(data.attrValue)) data.forceKeepAttr = true;
	});
}

/** Whether markup can be sanitized here: without a DOM (tests, prerendering), callers render text instead. */
export const canSanitize = DOMPurify.isSupported;

/** Sanitized markup kept for reuse, by what it was made from and the gate it was made with, least recently used first. */
const SANITIZED_SIZE = 1000;
const sanitized = new Map<string, string>();

/**
 * `html`, sanitized as `kind` allows, its media only from where `media` lets it load. DOMPurify parses every call
 * into a document of its own, and the same body is sanitized each time its row renders (a room reopened, a held view
 * replaced by the live one, a reply's quote); the same markup with the same gate always comes out the same, so each
 * is kept.
 */
export function sanitizeHtml(html: string, kind: SanitizeKind, media: MediaCheck): string {
	const key = `${kind}\n${media.key}\n${html}`;
	let clean = sanitized.get(key);
	if (clean !== undefined) {
		sanitized.delete(key);
	} else {
		clean = gateMedia(DOMPurify.sanitize(html, CONFIGS[kind]), media, kind === 'embed');
		if (sanitized.size >= SANITIZED_SIZE) sanitized.delete(sanitized.keys().next().value!);
	}
	sanitized.set(key, clean);
	return clean;
}

/** Attributes that load something, by any element: those not checked below go whatever they say. */
const LOADING = /\s(?:src|srcset|poster|background|data|ping)\s*=/i;
/** Those that never stay: a set of images to choose from, and the old and odd ways to load or ping. */
const DROPPED = ['srcset', 'background', 'data', 'ping'];

/**
 * Clean markup with each URL that would load asked of `media`. An image, video or audio that may not load waits for a
 * click, or becomes a link to it (`stand`; a custom emoji, its key), a poster goes, and so does everything in
 * `DROPPED`; a video or audio left with no source of its own stands for the first that went. Markup that loads nothing
 * comes back as it is, unparsed. The rest is parsed in a `<template>`, whose content belongs to an inert document,
 * so nothing in it loads while this runs. `newTab`: a link made opens in a new tab, as an embed's do.
 */
function gateMedia(clean: string, media: MediaCheck, newTab: boolean): string {
	if (!LOADING.test(clean) && !(newTab && clean.includes('<a'))) return clean;
	const template = document.createElement('template');
	template.innerHTML = clean;
	const root = template.content;
	const doc = root.ownerDocument;
	/** Players whose sources went, each with its first. */
	const unsourced = new Map<Element, string>();
	for (const element of root.querySelectorAll<HTMLElement>('[src], [srcset], [poster], [background], [data], [ping]')) {
		for (const name of DROPPED) element.removeAttribute(name);
		const poster = element.getAttribute('poster');
		if (poster !== null) {
			const allowed = inline(poster) ?? media.src(poster);
			if (allowed === undefined) element.removeAttribute('poster');
			else element.setAttribute('poster', allowed);
		}
		const src = element.getAttribute('src');
		if (src === null) continue;
		const allowed = inline(src) ?? media.src(src);
		if (allowed !== undefined) element.setAttribute('src', allowed);
		// One of a video's or audio's sources, or its captions: the rest of it stands or goes on its own.
		else if (element.localName === 'source' || element.localName === 'track') {
			const player = element.parentElement;
			if (element.localName === 'source' && player && !unsourced.has(player)) unsourced.set(player, src);
			element.remove();
		} else element.replaceWith(stand(element, src, media, doc));
	}
	for (const [player, src] of unsourced) {
		if (root.contains(player) && !player.hasAttribute('src') && !player.querySelector('source')) player.replaceWith(stand(player, src, media, doc));
	}
	if (newTab) {
		for (const link of root.querySelectorAll('a[href]')) {
			link.setAttribute('target', '_blank');
			link.setAttribute('rel', 'noreferrer noopener');
		}
	}
	return template.innerHTML;
}

/**
 * Media in the markup itself (`data:`, which DOMPurify lets only media elements have): it loads from nowhere, so it
 * tells no one anything, whatever the viewer chose.
 */
function inline(url: string): string | undefined {
	return /^\s*data:/i.test(url) ? url : undefined;
}

const KINDS: Record<string, string> = { img: 'Image', video: 'Video', audio: 'Audio' };

/**
 * What shows in place of media that may not load: a custom emoji's key; where a click may load it, Load and Always
 * load (after the link it is in, if it is in one); else a link to it named by its alt text.
 */
function stand(element: Element, src: string, media: MediaCheck, doc: Document): Node {
	const alt = element.getAttribute('alt') ?? '';
	if (element.classList.contains('ap-cemoji')) return doc.createTextNode(alt);
	// Not one a click may open: its words alone, never what it pointed at.
	if (!/^https?:/i.test(src)) return doc.createTextNode(alt);
	const asked = media.ask?.(src);
	let link = element.closest('a');
	if (asked) {
		const box = askBox(alt || KINDS[element.localName] || 'Media', asked, doc);
		if (!link) return box;
		// A button can't be in a link: it goes after it, and after any put there before it.
		for (let outer = link.parentElement?.closest('a'); outer; outer = outer.parentElement?.closest('a')) link = outer;
		let after: Element = link;
		while (after.nextElementSibling?.classList.contains('ap-media-ask') && after.nextSibling === after.nextElementSibling) after = after.nextElementSibling;
		after.after(box);
		return doc.createTextNode(alt);
	}
	// In a link already: its words, else where it was.
	if (link) return doc.createTextNode(alt || src);
	const made = doc.createElement('a');
	made.setAttribute('href', src);
	made.setAttribute('target', '_blank');
	made.setAttribute('rel', 'noreferrer noopener');
	const title = element.getAttribute('title');
	if (title) made.setAttribute('title', title);
	made.textContent = alt || src;
	return made;
}

/** Media that waits for a click, as the design system's MediaAsk draws it: what it is and its full URL, then Load, Always load and Block. */
function askBox(what: string, asked: MediaAskAt, doc: Document): HTMLElement {
	const part = (tag: string, className: string, text = '') => {
		const node = doc.createElement(tag);
		node.className = className;
		node.textContent = text;
		return node;
	};
	const button = (text: string, name: string, value: string) => {
		const node = part('button', 'ap-btn ap-btn-quiet ap-btn-sm', text);
		node.setAttribute('type', 'button');
		node.setAttribute(name, value);
		return node;
	};
	const label = part('span', 'ap-media-ask-label');
	label.append(part('span', 'ap-media-ask-what', what), ' ', part('span', 'ap-media-ask-url', asked.url));
	const load = button('Load', 'data-media-load', asked.url);
	load.setAttribute('aria-label', `Load ${what} from ${asked.host}`);
	const actions = part('span', 'ap-media-ask-actions');
	actions.append(load);
	if (asked.origin) {
		const site = (text: string, name: string, list: string) => {
			const node = button('', name, asked.origin!);
			node.setAttribute('title', `Adds ${asked.host} to ${list}`);
			node.append(part('span', 'ap-media-ask-btntext', text));
			return node;
		};
		actions.append(site(`Always load from ${asked.host}`, 'data-media-trust', 'Trusted origins'), site(`Block ${asked.host}`, 'data-media-block', 'Blocked origins'));
	}
	const box = part('span', 'ap-media-ask');
	box.append(label, actions);
	return box;
}
