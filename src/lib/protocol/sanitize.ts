/**
 * The one way markup from anyone else reaches the page (Svelte's `@html`): a message's body, a description, a bio, a
 * server's welcome, an HTML embed. DOMPurify keeps only what each allows, then every URL that would load
 * (an image's, a video's, its poster's) is asked of `media`, the page's media gate (`$lib/ui/media-gate`): one
 * that may not load becomes a link to it, so media loads from where the viewer chose and from nowhere else,
 * whatever the markup is. Nothing is fetched while that is decided: the check works in an inert document.
 */
import DOMPurify, { type Config } from 'dompurify';

/** Where media may load from, as `$lib/ui/media-gate`'s gates answer: `key` changes whenever the answers do. */
export interface MediaCheck {
	readonly key: string;
	src(value: unknown): string | undefined;
}

/** Lets no media load: where nothing is known of where it may. */
export const NO_MEDIA: MediaCheck = { key: 'none', src: () => undefined };

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
	embed: { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button'], FORBID_ATTR: ['style'] }
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
 * Clean markup with each URL that would load asked of `media`. An image, video or audio that may not load becomes a
 * link to it (a custom emoji, its key), a poster goes, and so does everything in `DROPPED`. Markup that loads nothing
 * comes back as it is, unparsed. The rest is parsed in a `<template>`, whose content belongs to an inert document,
 * so nothing in it loads while this runs. `newTab`: a link made opens in a new tab, as an embed's do.
 */
function gateMedia(clean: string, media: MediaCheck, newTab: boolean): string {
	if (!LOADING.test(clean) && !(newTab && clean.includes('<a'))) return clean;
	const template = document.createElement('template');
	template.innerHTML = clean;
	const root = template.content;
	for (const element of root.querySelectorAll<HTMLElement>('[src], [srcset], [poster], [background], [data], [ping]')) {
		for (const name of DROPPED) element.removeAttribute(name);
		const poster = element.getAttribute('poster');
		if (poster !== null) {
			const allowed = media.src(poster);
			if (allowed === undefined) element.removeAttribute('poster');
		}
		const src = element.getAttribute('src');
		if (src === null) continue;
		const allowed = media.src(src);
		if (allowed !== undefined) element.setAttribute('src', allowed);
		// One of a video's or audio's sources, or its captions: the rest of it stands or goes on its own.
		else if (element.localName === 'source' || element.localName === 'track') element.remove();
		else element.replaceWith(stand(element, src, root.ownerDocument));
	}
	if (newTab) {
		for (const link of root.querySelectorAll('a[href]')) {
			link.setAttribute('target', '_blank');
			link.setAttribute('rel', 'noreferrer noopener');
		}
	}
	return template.innerHTML;
}

/** What shows in place of media that may not load: a custom emoji's key, else a link to it named by its alt text. */
function stand(element: HTMLElement, src: string, doc: Document): Node {
	const alt = element.getAttribute('alt') ?? '';
	if (element.classList.contains('ap-cemoji')) return doc.createTextNode(alt);
	// In a link already, or not one a click may open: its words alone.
	if (!/^https?:/i.test(src) || element.closest('a')) return doc.createTextNode(alt || src);
	const link = doc.createElement('a');
	link.setAttribute('href', src);
	link.setAttribute('target', '_blank');
	link.setAttribute('rel', 'noreferrer noopener');
	const title = element.getAttribute('title');
	if (title) link.setAttribute('title', title);
	link.textContent = alt || src;
	return link;
}
