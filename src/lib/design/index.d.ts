/* Apron components (Svelte 5) for the Apron Chat Protocol. Section numbers (§, Appendix) refer to PROTOCOL.md.
 * Source: apron-chat/apron-web src/lib/design/components — this file documents their props. In Svelte, import them from
 * '$lib/design/components'; in any page, components/bundle.js sets window.Apron (see the bottom of this file). */
import type { Component, Snippet } from 'svelte';
import type { HTMLButtonAttributes } from 'svelte/elements';

/** A user object (§3.3). `user_id` is stable; `name` falls back to it; `avatar` is optional (§4.6.6). */
export interface Sender {
  user_id: string;
  name?: string;
  avatar?: string;
  ext?: Record<string, unknown>;
  /** @deprecated alias of user_id */
  id?: string;
}

/** OpenGraph description of an embed (§4.6.1), `og:` prefix dropped, structured properties nested. */
export interface OG {
  title?: string;
  description?: string;
  site_name?: string;
  image?: { url: string; type?: string; width?: number; height?: number; alt?: string };
  video?: { url: string; type?: string; width?: number; height?: number };
  audio?: { url: string; type?: string };
}

/** One entry of `body.embeds` (§4.6). `kind` picks the renderer; unknown kinds render from `og`, else EmbedFallback (§3.5). */
export interface EmbedProps {
  embed_id?: string;
  kind: 'upload' | 'stream' | 'iframe' | 'html' | (string & {});
  url?: string;
  title?: string;
  og?: OG;
  /** upload, sender side only: 0–1 while the HTTP write to `write_url` is in flight (§4.6.3); `failed` if it never completed. */
  progress?: number;
  failed?: boolean;
  /** upload without og media: a detail line under the file name (size, type). */
  detail?: string;
  /** upload with og.image: false hides the caption under the picture. */
  caption?: boolean;
  /** stream (§4.6.5): `format` plain | markdown | terminal. Live while `url` is set and not `done`. */
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

/** One chip per emoji, aggregated by you from the reaction sets (§4.5). */
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

export interface AvatarProps {
  name?: string;
  user_id?: string;
  src?: string;
  size?: 'lg' | 'md' | 'sm';
}
export declare const Avatar: Component<AvatarProps>;

export type BackendRailProps = { backends: BackendEntry[]; active?: string; onselect?: (id: string) => void; onadd?: () => void };
export declare const BackendRail: Component<BackendRailProps>;

export interface ButtonProps extends HTMLButtonAttributes {
  variant?: 'quiet' | 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  /** Plain label; `children` wins when both are given. */
  label?: string;
  children?: Snippet;
}
export declare const Button: Component<ButtonProps>;

export interface ComposerProps {
  room?: string;
  placeholder?: string;
  /** The draft; `bind:value` in Svelte. */
  value?: string;
  oninput?: (value: string) => void;
  onsend?: () => void;
  /** Cap `embed:upload`: the attach and microphone buttons. Attachments go out as `upload` embeds (§4.6.3). */
  canUpload?: boolean;
  onattach?: () => void;
  disabled?: boolean;
  /** Hide the microphone (no getUserMedia, or a policy choice). */
  canRecord?: boolean;
  onrecord?: () => void;
  onstoprecording?: () => void;
  /** While true the field is replaced by a "Recording m:ss" line and the mic becomes Stop. */
  recording?: boolean;
  recordingTime?: string;
  /** Set when the main pane shows a thread: posts go to its `room_id` and the placeholder reads "Reply in …". */
  thread?: { thread: string; name?: string } | null;
  /** Cap `command` (§4.8): while `value` starts with one "/", a Command tag shows, the field turns monospace and Send reads Run. */
  canCommand?: boolean;
}
export declare const Composer: Component<ComposerProps>;

export interface ConnectScreenProps {
  status?: 'idle' | 'connecting' | 'authing';
  /** `bind:url`, `bind:name`, `bind:scheme`, `bind:token` */
  url?: string;
  /** Sent as `name` in the `auth` request (§3.2); `you.name` is the answer. */
  name?: string;
  /** Defaults to guest / token / webauthn. Narrow it to the `server` frame's `auth`, in its order, once known. */
  schemes?: string[];
  scheme?: string;
  token?: string;
  onconnect?: () => void;
  /** The server's error `message` when it gave one (§1.1). */
  error?: string;
  recent?: Array<{ url: string; label?: string }>;
  onpickrecent?: (r: { url: string; label?: string }) => void;
}
export declare const ConnectScreen: Component<ConnectScreenProps>;

export declare const Embed: Component<EmbedProps>;

export declare const EmbedCard: Component<EmbedProps>;

export declare const EmbedFallback: Component<EmbedProps>;

export declare const EmbedFrame: Component<EmbedProps>;

export declare const EmbedHtml: Component<EmbedProps>;

export declare const EmbedStream: Component<EmbedProps>;

export declare const EmbedUpload: Component<EmbedProps>;

export interface JumpBarProps {
  /** Default: the round `fab`, or the rust `bar` when there are `mentions`. */
  variant?: 'bar' | 'fab';
  count?: number;
  onjump?: () => void;
  /** unread mentions below the fold */
  mentions?: number;
  onjumpmention?: () => void;
}
export declare const JumpBar: Component<JumpBarProps>;

export interface MentionProps {
  user_id?: string;
  name?: string;
  me?: boolean;
  roomId?: string;
  title?: string;
  onopen?: () => void;
  unknown?: boolean;
}
export declare const Mention: Component<MentionProps>;

export interface MentionPickerProps {
  query?: string;
  people: Sender[];
  active?: number;
  onpick?: (p: Sender) => void;
  onhover?: (i: number) => void;
}
export declare const MentionPicker: Component<MentionPickerProps>;

export interface MessageProps {
  /** Omit only for a system line about the room itself (room records carry no sender). A `@private` notice has no `messageId`: render it, never store it (§3.5). */
  messageId?: string;
  sender?: Sender;
  /** Show `@user_id` beside the name, the protocol's `Name (@user_id)` (§3.3). Defaults to on in cozy and off in compact. */
  handle?: boolean;
  /** Plain text body. For Markdown, render + sanitize yourself and pass `children`. */
  text?: string;
  children?: Snippet;
  embeds?: EmbedProps[];
  /** Epoch ms of the creation `log_id` (the `message_id`). */
  timestamp?: number;
  /** Pre-formatted time; overrides the short time `timestamp` renders. */
  time?: string;
  /** Continuation of the previous sender's group: no avatar or name. */
  grouped?: boolean;
  status?: 'sent' | 'pending' | 'failed';
  onretry?: () => void;
  /** `log_id !== message_id`: the snapshot is not the creation. */
  edited?: boolean;
  /** Tombstone (§4.2): body and reactions hidden. */
  deleted?: boolean;
  /** Render as a system message. Defaults to true when `sender.user_id` starts with "@" (Appendix A.1). */
  system?: boolean;
  /** Who else received a system notice (Appendix A.1); derived from `@server`, `@room`, `@private`. */
  scope?: 'server' | 'room' | 'private';
  /** `body.mentions` lists the viewer's `user_id` (§3.5) — never decided from the text. */
  mention?: boolean;
  /** First render after the mention ARRIVED: one ring pulse. */
  pinged?: boolean;
  highlighted?: boolean;
  density?: 'cozy' | 'compact';
  /** Hover/focus toolbar, usually a <MessageActions>. Omit when the server allows nothing. */
  actions?: Snippet;
  /** Under the body — the <ThreadMarker> card when this message is a thread's `intro_message`. */
  footer?: Snippet;
  /** The message `reply_to` names (§3.5), resolved by you — may be in another room. */
  replyTo?: ReplyPreviewProps;
  onjumpto?: () => void;
  reactions?: ReactionChip[];
  reacting?: boolean;
  palette?: string[];
  canReact?: boolean;
  onreact?: (emoji: string) => void;
  onopenreact?: () => void;
  onclosereact?: () => void;
  /** Bulk-select mode: a check column appears, the whole row toggles, hover actions hide. Pair with <SelectionBar>. */
  selectMode?: boolean;
  selected?: boolean;
  onselect?: (e: Event) => void;
}
export declare const Message: Component<MessageProps>;

export type MessageActionsProps = { items: MessageAction[]; onmore?: () => void };
export declare const MessageActions: Component<MessageActionsProps>;

export interface ProfileBarProps {
  /** Your identity on the active backend: `you` from `auth`, merged with every later `user` notification carrying `you` (§3.3). */
  you: Sender;
  backend?: string;
  open?: boolean;
  onedit?: () => void;
  /** Usually a <ProfileEditor>; shown in a popover above the bar while `open`. */
  editor?: Snippet;
}
export declare const ProfileBar: Component<ProfileBarProps>;

export interface ProfileEditorProps {
  userId: string;
  /** Display name — sent as `me` `{name}` (§3.3); `you.name` in the result is the answer. `bind:name` in Svelte. */
  name?: string;
  oninput?: (name: string) => void;
  avatar?: string;
  /** Caps `command` and `embed:upload`: a `/avatar` command with one `upload` embed (§4.6.6). */
  canUpload?: boolean;
  onchangeavatar?: () => void;
  /** Sends `me` `{avatar: ""}`. */
  onremoveavatar?: () => void;
  /** The request went out but `you.avatar` didn't change. */
  avatarKept?: boolean;
  /** saving · altered: `you.name` differs from what you asked (`serverName`) · declined */
  status?: 'idle' | 'saving' | 'altered' | 'declined';
  serverName?: string;
  onsave?: () => void;
  oncancel?: () => void;
  /** `server.auth` lists `webauthn` and this session isn't one: "Add passkey" runs `auth` action "register" (§4.9). */
  canPasskey?: boolean;
  onaddpasskey?: () => void;
  passkey?: 'idle' | 'waiting' | 'done' | 'declined' | 'cancelled';
}
export declare const ProfileEditor: Component<ProfileEditorProps>;

export interface ReactionBarProps {
  reactions: ReactionChip[];
  /** The palette is open under the message. */
  open?: boolean;
  palette?: string[];
  /** No cap `reactions`, or the session can't send now: chips render but don't toggle. */
  disabled?: boolean;
  /** Toggle your own emoji; send your complete set with `reactions`. */
  ontoggle?: (emoji: string) => void;
  onopen?: () => void;
  onclose?: () => void;
}
export declare const ReactionBar: Component<ReactionBarProps>;

export declare const ReplyPreview: Component<ReplyPreviewProps>;

export interface RoomHeaderProps {
  room: string;
  /** the room record's `title`, falling back to `room_id` (§3.4) */
  name?: string;
  /** first line of the room's `intro_message` */
  topic?: string;
  /** names from live `activity` typing; replaces the topic while present */
  typing?: string[];
  onback?: () => void;
  children?: Snippet;
  /** A thread is open in the main pane: shows `Parent › Thread`; the parent's title goes back via onroom. */
  thread?: string;
  threadName?: string;
  onroom?: () => void;
  /** Cap `rooms` and/or `edit`: an Edit button that opens a <ThreadEditor>. */
  onedit?: () => void;
}
export declare const RoomHeader: Component<RoomHeaderProps>;

export interface RoomItemProps {
  room: string;
  /** `title`, falling back to `room_id` */
  name?: string;
  /** first line of `intro_message` */
  topic?: string;
  unread?: number;
  /** unread messages whose `body.mentions` lists the viewer; an @ badge that quiets the plain count. */
  mentions?: number;
  active?: boolean;
  /** a thread (room with `parent_room_id`) indented under its parent */
  nested?: boolean;
  onselect?: () => void;
  /** Cap `rooms`: a door button titled "Exit" on hover/focus. Sends `room_leave` (§4.3.2). */
  onleave?: (e: MouseEvent) => void;
}
export declare const RoomItem: Component<RoomItemProps>;

export interface SelectionBarProps {
  count: number;
  threads?: Array<{ thread: string; name?: string }>;
  onmove?: (thread: string) => void;
  onnewthread?: () => void;
  oncancel?: () => void;
  onselectrange?: () => void;
  status?: 'idle' | 'saving';
}
export declare const SelectionBar: Component<SelectionBarProps>;

export interface SidebarSectionProps {
  title: string;
  /** Controlled; omit to let the section keep its own state. `bind:open` works too. */
  open?: boolean;
  ontoggle?: (open: boolean) => void;
  action?: Snippet;
  children?: Snippet;
}
export declare const SidebarSection: Component<SidebarSectionProps>;

export interface StatusBannerProps {
  /** waiting: `retry_after` · denied: don't reconnect until the user acts (§1.1) · reconnecting: also when a `pong` stops coming (§1) */
  state: 'connected' | 'connecting' | 'reconnecting' | 'waiting' | 'offline' | 'denied' | 'error';
  /** The server's error `message`, shown as is (§1.1). */
  message?: string;
  children?: Snippet;
  /** Seconds left from `data.retry_after`. */
  retryIn?: number;
  action?: Snippet;
}
export declare const StatusBanner: Component<StatusBannerProps>;

export interface ThreadEditorProps {
  /** Title: a `room_set` (cap `rooms`, §4.3.4). `bind:name`. */
  name?: string;
  /** Summary: a `message` save of the intro (cap `edit`, §4.2). `bind:summary`. */
  summary?: string;
  status?: 'idle' | 'saving' | 'declined';
  onsave?: () => void;
  oncancel?: () => void;
}
export declare const ThreadEditor: Component<ThreadEditorProps>;

export interface ThreadMarkerProps {
  /** The thread's `room_id` (a room with `parent_room_id`, §3.4). */
  thread: string;
  name?: string;
  count?: number;
  /** The thread's `intro_message` text, when it's a written summary rather than the message that started it. */
  summary?: string;
  /** The thread's members or recent senders, most recent first; up to 4 are shown. */
  participants?: Sender[];
  /** Pre-formatted time of the newest message, e.g. "14:32". */
  lastReply?: string;
  /** The newest message, shown as the preview line when there is no summary. Shorten `text` yourself. */
  latest?: { sender: Sender; text: string };
  /** Render the "Moved to …" marker where a moved message used to be. */
  moved?: boolean;
  onopen?: () => void;
}
export declare const ThreadMarker: Component<ThreadMarkerProps>;

export type ThreadSummaryProps = { summary?: string; children?: Snippet };
export declare const ThreadSummary: Component<ThreadSummaryProps>;

export interface TimelineDividerProps {
  /** date: between days · new: above the first message after your `read_message_id` · gap: history unavailable before here. */
  kind?: 'date' | 'new' | 'gap';
  label?: string;
  /** date only; default true */
  sticky?: boolean;
  /** Sticky date pills show only while the timeline is scrolled away from the live end. Caught up → hidden, space kept. */
  scrolling?: boolean;
}
export declare const TimelineDivider: Component<TimelineDividerProps>;

export type TypingIndicatorProps = { names?: string[] };
export declare const TypingIndicator: Component<TypingIndicatorProps>;

/** The bundle's global. */
export interface RenderHandle<P> { props: P; set(patch: Partial<P>): void; destroy(): void }
declare global { interface Window { Apron: {
  Avatar: typeof Avatar;
  BackendRail: typeof BackendRail;
  Button: typeof Button;
  Composer: typeof Composer;
  ConnectScreen: typeof ConnectScreen;
  Embed: typeof Embed;
  EmbedCard: typeof EmbedCard;
  EmbedFallback: typeof EmbedFallback;
  EmbedFrame: typeof EmbedFrame;
  EmbedHtml: typeof EmbedHtml;
  EmbedStream: typeof EmbedStream;
  EmbedUpload: typeof EmbedUpload;
  JumpBar: typeof JumpBar;
  Mention: typeof Mention;
  MentionPicker: typeof MentionPicker;
  Message: typeof Message;
  MessageActions: typeof MessageActions;
  ProfileBar: typeof ProfileBar;
  ProfileEditor: typeof ProfileEditor;
  ReactionBar: typeof ReactionBar;
  ReplyPreview: typeof ReplyPreview;
  RoomHeader: typeof RoomHeader;
  RoomItem: typeof RoomItem;
  SelectionBar: typeof SelectionBar;
  SidebarSection: typeof SidebarSection;
  StatusBanner: typeof StatusBanner;
  ThreadEditor: typeof ThreadEditor;
  ThreadMarker: typeof ThreadMarker;
  ThreadSummary: typeof ThreadSummary;
  TimelineDivider: typeof TimelineDivider;
  TypingIndicator: typeof TypingIndicator;
  /** Mount a component; change `handle.props.x` or call `handle.set({...})` and it re-renders. */
  render<P extends Record<string, any>>(C: Component<P>, target: Element, props?: P): RenderHandle<P>;
  /** A snippet prop from markup you trust (already rendered and sanitized). */
  html(markup: string): Snippet;
  /** A snippet prop that renders another component. */
  part<P extends Record<string, any>>(C: Component<P>, props?: P): Snippet;
  /** Several snippets in a row, for one snippet prop. */
  parts(...snippets: Snippet[]): Snippet;
} } }
