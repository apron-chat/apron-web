import type { Snippet } from 'svelte';
import type { HTMLAttributes, HTMLButtonAttributes } from 'svelte/elements';
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
	/** upload, sender side only: 0–1 while the HTTP write to `write_url` is in flight (§4.8.3); `failed` if it never completed, a string saying why. */
	progress?: number;
	failed?: boolean | string;
	/** upload: a detail line under the file name: what it is (size, type) on a file card without og media, or ahead of Uploading… while pending. */
	detail?: string;
	/** upload with og.image: false hides the caption under the picture. */
	caption?: boolean;
	/**
	 * upload with og.image: a plain click (`plainClick`) on the picture calls this instead of following the link,
	 * to show it full screen in a MediaViewer. Other clicks still open the link in a new tab or window.
	 */
	onview?: (event: MouseEvent) => void;
	/** upload with og.image: more attributes for the link around the picture, such as the `data-*` a viewer pages through. */
	link?: HTMLAttributes<HTMLAnchorElement>;
	/** stream (§4.8.5): `format` plain | markdown | terminal. Live while `url` is set and not `done`. */
	format?: string;
	text?: string;
	done?: boolean;
	truncated?: boolean;
	/** stream: what the header says once it isn't live, in place of Finished (such as Ended). */
	status?: string;
	/** stream: the body's content, such as rendered and sanitized Markdown or colored terminal spans; `text` otherwise. */
	children?: Snippet;
	/** stream with format markdown: an attachment for the body, such as one that highlights its code blocks. */
	attach?: (body: HTMLElement) => void | (() => void);
	/** iframe: `height` is a suggestion, clamped to iframe-max-h; `live` false shows the paused placeholder. */
	height?: number;
	live?: boolean;
	onactivate?: () => void;
	/** html: ALREADY SANITIZED markup (DOMPurify or equivalent). */
	html?: string;
}

/** Attributes for an Embed component's root (`data-testid`, `class`, …), beside the embed's own fields. */
export type EmbedAttributes = Omit<HTMLAttributes<HTMLElement>, keyof EmbedProps>;

/** An Embed component's props: the embed's fields, and attributes for its root. */
export type EmbedComponentProps = EmbedProps & EmbedAttributes;

/** One chip per emoji, aggregated by you from the reaction sets (§4.7). */
export interface ReactionChip {
	emoji: string;
	count: number;
	mine?: boolean;
	/** "You, Ada and Bob" for the tooltip */
	who?: string;
	/** The whole tooltip, in place of the one made from `who`. */
	title?: string;
	/** What a screen reader hears, in place of the emoji, count and what a click does. */
	label?: string;
}

/**
 * A quoted message: who wrote it and a one-line snippet (you shorten it — ~120 chars, first line, no Markdown). Other
 * attributes (`data-*`, `class`, …) go on ReplyPreview's button.
 */
export interface ReplyPreviewProps extends HTMLButtonAttributes {
	messageId: string;
	sender: Sender;
	snippet?: string;
	deleted?: boolean;
	/** A click on it, after your `onclick`, which can `preventDefault()` to keep it from jumping. */
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

/** Where a Popover sits, in viewport px: beside what opened it on wide screens, a bottom sheet on narrow ones. */
export interface PopoverPlacement {
	/** `popover`: at `top` and `left`, `width` wide. `sheet`: along the bottom, full width, rounded only where it meets the page. */
	mode?: 'popover' | 'sheet';
	top?: number;
	left?: number;
	/** As a popover; a sheet is full width. */
	width?: number;
	/** Either way; omitted, it fits its content. */
	height?: number;
}

/** Someone who reacted, in a ReactorsPopover. */
export interface Reactor extends Sender {
	/** The viewer: "(you)" follows the name. */
	you?: boolean;
	/** Show `@user_id` under the name, where it tells people apart: another user listed or shown has the same name. Off by default. */
	handle?: boolean;
}

/** A file on a draft (§4.8.4), as Attachments shows it. */
export interface AttachmentFile {
	name: string;
	/** The size it goes out at, after an image is shrunk; until it is known pass `preparing`. */
	size?: string;
	preparing?: boolean;
	kind?: 'image' | 'audio' | 'file';
	/** Previews an image or audio clip (an object URL). */
	src?: string;
}

/** What a Composer hands its `field` snippet: how your own field reads, as its textarea would. */
export interface ComposerField {
	/** The placeholder: the Composer's `placeholder`, else "Message {room}" or "Reply in {thread}". */
	placeholder: string;
	disabled: boolean;
	/** The draft is a command (`canCommand`): the field is set in monospace by the Composer. */
	command: boolean;
}

/** A room or thread a `#` can name, in the MentionPicker. */
export interface PickerRoom {
	id: string;
	title: string;
}

/** An emoji a `:shortcode` can put in, in the MentionPicker. */
export interface PickerEmoji {
	/** The shortcode, without its colons. */
	id: string;
	/** The emoji itself. */
	native: string;
	name: string;
}

/** Someone in a MemberList (§4.2.1). */
export interface MemberListPerson {
	user_id: string;
	/** Falls back to `user_id`. */
	name?: string;
	avatar?: string;
	/** Their `status` (§4.5): a dot on the avatar; offline (or invisible) dims the row. */
	status?: Presence | (string & {});
	/** The status in words, instead of its own, such as for your own ("Invisible · others see you as offline"). */
	statusLabel?: string;
	roles?: string[];
	/** Show `@user_id` after the name, where someone else has the same one (§3.3). */
	handle?: boolean;
	/** You: marked "(you)", and never offered for removal. */
	you?: boolean;
}

/** One group of a MemberList: Online, Offline, or with key `members` the one list of a server without status (§4.5), which has no heading and never folds. */
export interface MemberListSection {
	key: string;
	label: string;
	people: MemberListPerson[];
}
