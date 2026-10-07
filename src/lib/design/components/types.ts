import type { Snippet } from 'svelte';
import type { Sender } from './util';
export type { Sender };

/** OpenGraph description of an embed (§4.8.1), `og:` prefix dropped, structured properties nested. */
export interface OG {
	title?: string;
	description?: string;
	site_name?: string;
	image?: { url: string; type?: string; width?: number; height?: number; alt?: string };
	video?: { url: string; type?: string; width?: number; height?: number };
	audio?: { url: string; type?: string };
}

/** One entry of `body.embeds` (§4.8). `kind` picks the renderer; unknown kinds render from `og`, else EmbedFallback (§3.5). */
export interface EmbedProps {
	embed_id?: string;
	kind: 'upload' | 'stream' | 'iframe' | 'html' | (string & {});
	url?: string;
	title?: string;
	og?: OG;
	/** upload, sender side only: 0–1 while the HTTP write to `write_url` is in flight (§4.8.3); `failed` if it never completed. */
	progress?: number;
	failed?: boolean;
	/** upload without og media: a detail line under the file name (size, type). */
	detail?: string;
	/** upload with og.image: false hides the caption under the picture. */
	caption?: boolean;
	/**
	 * upload with og.image: a plain click (`plainClick`) on the picture calls this instead of following the link,
	 * to show it full screen in a MediaViewer. Other clicks still open the link in a new tab or window.
	 */
	onview?: (event: MouseEvent) => void;
	/** stream (§4.8.5): `format` plain | markdown | terminal. Live while `url` is set and not `done`. */
	format?: string;
	text?: string;
	done?: boolean;
	truncated?: boolean;
	/** stream with format markdown: the rendered, sanitized body. */
	children?: Snippet;
	/** iframe: `height` is a suggestion, clamped to iframe-max-h; `live` false shows the paused placeholder. */
	height?: number;
	live?: boolean;
	onactivate?: () => void;
	/** html: ALREADY SANITIZED markup (DOMPurify or equivalent). */
	html?: string;
}

/** One chip per emoji, aggregated by you from the reaction sets (§4.7). */
export interface ReactionChip {
	emoji: string;
	count: number;
	mine?: boolean;
	/** "You, Ada and Bob" for the tooltip */
	who?: string;
}

/** A quoted message: who wrote it and a one-line snippet (you shorten it — ~120 chars, first line, no Markdown). */
export interface ReplyPreviewProps {
	messageId: string;
	sender: Sender;
	snippet?: string;
	deleted?: boolean;
	onjump?: () => void;
}

export interface MessageAction {
	id?: string;
	label: string;
	/** A short text glyph; omitted, the label shows. */
	glyph?: string;
	onclick?: () => void;
	danger?: boolean;
	hidden?: boolean;
}

/** A backend the viewer connected. `label` defaults to the `server` frame's `name` or the host; `icon` is a viewer setting. */
export interface BackendEntry {
	id: string;
	label: string;
	icon?: string;
	unread?: boolean;
	mentions?: number;
	state?: 'online' | 'offline';
}

/** waiting: `retry_after` · denied: don't reconnect until the user acts (§1.1) · reconnecting: also when a `pong` stops coming (§1) */
export type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'waiting' | 'offline' | 'denied' | 'error';

/**
 * A user's `status` (§4.5) as a StatusDot draws it: here now, connected but
 * not looking, do not disturb, or gone (others see an invisible user as
 * offline); `invisible` is your own choice as `you` shows it, and `unknown`
 * any value this client doesn't know.
 */
export type Presence = 'online' | 'idle' | 'dnd' | 'offline' | 'invisible' | 'unknown';

/** One image in the MediaViewer. */
export interface MediaItem {
	/** The image to show: the full file where it may load, else its preview. */
	src: string;
	alt?: string;
	/** What it is called, such as its file name. */
	title: string;
	/** One more line, such as who sent it and when. */
	detail?: string;
	/** The original, which Open original opens in a new tab. */
	href?: string;
	/** Its size, so the image keeps its shape while it loads. */
	width?: number;
	height?: number;
}
