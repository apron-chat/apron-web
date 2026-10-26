import type { Snippet } from 'svelte';
import type { ClassValue } from 'svelte/elements';
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
	/**
	 * upload with og.image: a plain click (`plainClick`) on the picture calls this instead of following the link,
	 * to show it full screen in a MediaViewer. Other clicks still open the link in a new tab or window.
	 */
	onview?: (event: MouseEvent) => void;
	/**
	 * upload with og.image: what a MediaViewer shows of the picture, on the link around it as `data-viewer-src`,
	 * `-title`, `-alt`, `-detail`, `-width` and `-height`, which a viewer reads to page through a timeline's images.
	 */
	viewer?: Partial<Omit<MediaItem, 'href'>>;
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

/** What an Embed component takes for its root, beside the embed's own fields. */
export interface EmbedAttributes {
	/** Classes for its root, added to its own. */
	class?: ClassValue;
	/** A `data-testid` for its root. */
	testid?: string;
}

/** An Embed component's props: the embed's fields, and its root's class and test id. */
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

/** One button of a MessageActions toolbar. */
export interface MessageAction {
	id?: string;
	/** What a screen reader hears. */
	label: string;
	/** A short text glyph; omitted, the label shows. */
	glyph?: string;
	/** The tooltip; none when omitted. */
	title?: string;
	/** A press. One that returns a promise resolving true, on an action with `done`, says so for a moment. */
	onclick?: (event: MouseEvent) => unknown;
	/** What the button says for a moment after its press worked, before the ⋯ actions close (Copy link: Copied). */
	done?: { label: string; glyph?: string };
	/** It opens a dialog beside it (`aria-haspopup`); `expanded` says whether that is open. */
	popup?: boolean;
	expanded?: boolean;
	/** An attachment for the button, such as one that closes the popup it opened when the button goes. */
	attach?: (button: HTMLElement) => void | (() => void);
	testid?: string;
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

/** What the viewer may do to a message, from the server's capabilities and who sent it: only real actions show. */
export interface MessageCaps {
	reply: boolean;
	edit: boolean;
	startThread: boolean;
	/** Pick it in select mode, to move it. */
	select: boolean;
	removeReply: boolean;
	/** Capability `reactions`: the React action and chips that toggle. */
	react: boolean;
	/** Copy link, under ⋯: a URL that opens this message where it is. */
	link: boolean;
}

/** Who sent a message, as its row shows them (§3.3): the kept user object, else the one it was posted under. */
export interface MessageSender {
	user_id: string;
	/** The display name; for a scoped notice, its title as the server names its sender. */
	name: string;
	/** `@user_id` beside the name, set only where it tells people apart: another user shows under the same name. */
	handle?: string;
	/** Badges beside the name (never part of it); absent when there are none. */
	roles?: string[];
	/** An avatar this client will load (§4.8.6); without one, initials. */
	avatar?: string;
	/** The initials' tint, 0–360; absent keeps the denim placeholder. */
	hue?: number;
}

/** A mention in a reply's snippet (Appendix A.3), as a Mention that only reads: a user, or a room. */
export type MessageMention = { user_id: string; name: string; me?: boolean } | { roomId: string; name?: string; thread?: boolean; hash?: boolean };

/** The message a reply quotes (§3.5), resolved by you, maybe in another room. Without `id` it couldn't be found: "Message unavailable". */
export interface MessageReply {
	/** The quoted message's `message_id`, to jump to. */
	id?: string;
	name?: string;
	avatar?: string;
	hue?: number;
	/** One line of its text (~120 chars, first line, no Markdown), mentions picked out. */
	snippet?: (string | MessageMention)[];
	deleted?: boolean;
}

/**
 * A link in a message to a message, room or thread (Appendix A.4), as a card under its text in the shape of a link
 * preview (EmbedCard): where it is as a path, server › room › what it is, then what you already know of it. Nothing
 * is fetched to draw it; one that would be its path alone is left to the link's chip. Following the link opens it.
 */
export interface MessageLinkCard {
	/** The link, in the https form with its server, also the list's key. */
	href: string;
	kind: 'message' | 'room' | 'thread';
	/** The server's host, first on the path. */
	server: string;
	/** The room a message, or a thread, is in: next on the path. */
	in?: LinkCardPlace;
	/** A room or thread itself: its name is the title. */
	room?: LinkCardPlace;
	/** Who sent a message, once it's loaded here: the title. */
	sender?: { name: string; avatar?: string; hue?: number };
	/** Epoch ms of a loaded message's `message_id`: the tooltip on `time`. */
	timestamp?: number;
	/** When a loaded message was, pre-formatted, with its day when that isn't today. */
	time?: string;
	/** Up to three lines of a loaded message's text (no Markdown), mentions picked out. */
	snippet?: (string | MessageMention)[];
	deleted?: boolean;
	/** A room's or thread's description (§3.4) as plain text. */
	description?: string;
	members?: number;
	/** Only its members see it (§4.2.4). */
	private?: boolean;
}

/** A room or thread on a card's path or as its title, by the one rule (`roomName`); one not known here is its `room_id`. */
export interface LinkCardPlace {
	id: string;
	title?: string;
	thread?: boolean;
	unknown?: boolean;
}

/** A file being written to an upload embed, sender side (§4.8.3). */
export interface MessageUpload {
	name: string;
	width?: number;
	height?: number;
	/** 0–1 once the write started. */
	progress?: number;
	/** Why the write failed. */
	failed?: string;
}

/** One of a message's embeds (§4.8), as its row lists it. */
export interface MessageEmbed {
	/** Keys the list: the `embed_id`, else its place. */
	key: string;
	embed: EmbedProps;
	upload?: MessageUpload;
	/** Who sent it and when, for an image shown full screen. */
	detail?: string;
	/** Your own, and not the last thing in the message nor still being written: an (x) on its corner takes it off. */
	removable?: boolean;
}

/**
 * A message as its row draws it, plain data made from the record and what the viewer knows (who people are, what
 * they may do, what is selected). Build it once per change and pass it whole: nothing in it is derived again.
 */
export interface MessageView {
	/** The `message_id`; absent on a transient notice (§3.5), which is rendered, never stored. */
	id?: string;
	sender: MessageSender;
	/** Epoch ms of the creation `log_id` (the `message_id`): the time and its tooltip. */
	timestamp?: number;
	/** The short time, pre-formatted; without a timestamp it's all that shows. */
	time?: string;
	/** ALREADY SANITIZED markup of the text; absent when a message has none. `code` when it holds code blocks to decorate. */
	body?: { html: string; markdown?: boolean; code?: boolean };
	reply?: MessageReply;
	/** The messages, rooms and threads its links point to, as cards under its text; none on a tombstone. */
	linkCards?: MessageLinkCard[];
	embeds?: MessageEmbed[];
	/** Chips under the message; none on a tombstone. */
	reactions?: ReactionChip[];
	/** Continuation of the previous sender's group: no avatar or header, the time on hover. Ignored on a reply. */
	grouped?: boolean;
	/** Tombstone (§4.4): body and reactions hidden. */
	deleted?: boolean;
	/** A system message (Appendix A.1): a quiet line, or with `scope` a card titled by its sender. Neither has actions. */
	system?: boolean;
	/** Who else got a system message: everyone on the server, the room, or only you. */
	scope?: 'server' | 'room' | 'private';
	/** `body.mentions` lists the viewer (§3.5). */
	mention?: boolean;
	/** First render after the mention arrived: one ring pulse. */
	pinged?: boolean;
	highlighted?: boolean;
	/** Select mode is on for the pane: a message you may `select` shows a check, and clicks pick it. */
	selecting?: boolean;
	selected?: boolean;
	/** Its editor is open: no toolbar. */
	editing?: boolean;
	caps?: MessageCaps;
}

/**
 * What a Message's controls do, one object for every row. Each gets the row's view; leave out what you don't offer.
 * The rest is yours to wire up: what a click on a person or a room opens, and how code blocks are decorated.
 */
export interface MessageHandlers {
	reply?: (view: MessageView) => void;
	/** Toggle your reaction with this emoji (a chip, or a pick). */
	react?: (view: MessageView, emoji: string) => void;
	/** The React action: open your picker beside its button. */
	pick?: (view: MessageView, anchor: HTMLElement) => void;
	/** Whether that picker is open for this message, for the button's `aria-expanded`. */
	picking?: (view: MessageView) => boolean;
	/** An attachment for the React action's button, such as one that closes your picker when the button goes. */
	pickAnchor?: (button: HTMLElement) => void | (() => void);
	/** A right-click or long press on a chip: show who reacted, beside it. */
	reactors?: (view: MessageView, emoji: string, chip: HTMLElement) => void;
	edit?: (view: MessageView) => void;
	delete?: (view: MessageView) => void;
	startThread?: (view: MessageView) => void;
	/** Copy the message's link; resolves whether it was copied, and Copy link says so for a moment. */
	copyLink?: (view: MessageView) => Promise<boolean>;
	/** In select mode: toggle this message, or with `range` fill the selection to it. */
	select?: (view: MessageView, range: boolean) => void;
	/** Enter select mode with this message picked: Select under ⋯, a shift-click, `x`, or a long press. */
	beginSelect?: (view: MessageView) => void;
	removeReply?: (view: MessageView) => void;
	removeEmbed?: (view: MessageView, embed: EmbedProps) => void;
	/** A room mention was clicked (Appendix A.3). */
	openRoom?: (roomId: string) => void;
	/** A click outside select mode, such as on a mention or the sender: open their profile if it names someone, and say whether it did. */
	openProfile?: (target: EventTarget | null) => boolean;
	/** The reply's quote: go to the message it quotes. */
	jump?: (messageId: string) => void;
	/** Decorate the code blocks in a body (highlighting; `copy` adds Copy buttons, on a notice). Runs again when the body changes. */
	code?: (body: HTMLElement, copy: boolean) => void | (() => void);
}

/** The `data-testid`s a Message puts on its parts, for whoever queries them. */
export interface MessageTestids {
	row?: string;
	handle?: string;
	reply?: string;
	/** Each card for a message, room or thread its links point to. */
	linkCard?: string;
	reactions?: string;
	chip?: string;
	select?: string;
}

/** A status line's tone: StatusBanner colors its line with it. */
export type Tone = 'ok' | 'warn' | 'danger';

/** One option of a CheckList: its value, a title, and optionally a line saying what it does (without one, the row is a single line). */
export interface CheckOption {
	value: string;
	title: string;
	text?: string;
	/** Can't be changed here; `note` can say why. */
	disabled?: boolean;
	/** A short muted note beside the title, such as why it is disabled, or "Desktop only". */
	note?: string;
}

/** One choice of a MenuButton: its value, a label, and an optional muted hint after it. */
export interface MenuChoice {
	value: string;
	label: string;
	hint?: string;
	/** A `data-testid` for its item. */
	testid?: string;
}

/** What a wait the server asked for (`retry_after`, §1.1) holds back: pages of history (`history`), sending (`message`), or files (`upload`). */
export type LimitScope = 'history' | 'message' | 'upload';

/** A person's face, in Faces: their avatar, or initials tinted by `hue`, and their `status` where one face shows alone. */
export interface Face {
	user_id: string;
	/** Falls back to `user_id`. */
	name?: string;
	/** An avatar this client will load (§4.8.6). */
	src?: string;
	/** The initials' tint, 0–360, such as one made from the `user_id`. */
	hue?: number;
	/** Their `status` (§4.5), on a face shown alone. */
	status?: Presence | (string & {});
	/** The status's words instead of its own. */
	statusLabel?: string;
}

/** Someone in a PrivateRoomForm's list of people to pick. */
export interface PickPerson extends Face {
	/** Shown under the name, such as why they can't be picked. Defaults to `@user_id`. */
	detail?: string;
	/** You already have a conversation with just them: picking them alone opens it ("Already talking · Open"). */
	existing?: boolean;
}

/** One of your private rooms, offered to leave in a PrivateRoomForm at the limit. */
export interface PickRoom {
	id: string;
	name: string;
	faces: Face[];
	/** One more line, such as when it was last active. */
	detail?: string;
	/** Leaving it is in flight. */
	leaving?: boolean;
}
