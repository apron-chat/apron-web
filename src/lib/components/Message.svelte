<script lang="ts">
	import type { EmbedEdits, UploadState } from '$lib/protocol/client';
	import { renderMarkdown, renderPlain } from '$lib/protocol/markdown';
	import type { Embed as EmbedData, MessageRecord } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { emojiAnchor, emojiPicker } from '$lib/ui/emoji-picker.svelte';
	import { highlightCode } from '$lib/ui/highlight';
	import { openProfileFrom } from '$lib/ui/profile-card.svelte';
	import { embedsOf, isSystem, replySnippet, senderName, textOf } from '$lib/ui/messages';
	import type { ReactionChip } from '$lib/ui/reactions';
	import { eventTime, idMillis } from '$lib/ui/time';
	import { copyCode } from '$lib/ui/copy-code';
	import DesignMessage from '$lib/design/components/Message.svelte';
	import Avatar from './Avatar.svelte';
	import MentionText from './MentionText.svelte';
	import ReactionBar from './ReactionBar.svelte';
	import { systemScope } from '$lib/protocol/types';
	import Embed from './embeds/Embed.svelte';
	import EmbedRemove from '$lib/design/components/EmbedRemove.svelte';
	import MessageEditor from './MessageEditor.svelte';

	const LONG_PRESS_MS = 500;

	/** What the viewer may do to this message: built from the server's capabilities and ownership, so only real actions show. */
	export interface MessageCaps {
		reply: boolean;
		edit: boolean;
		startThread: boolean;
		select: boolean;
		removeReply: boolean;
		/** Cap `reactions`: the React action and clickable chips. */
		react: boolean;
		/** Copy link, under ⋯: a URL that opens this message where it is. */
		link: boolean;
	}

	interface Props {
		event: MessageRecord;
		/** A follower in a sender's group: no avatar or header, time on hover. */
		grouped: boolean;
		/** Looks up the quoted message of a reply, in any room (`reply_to` may cross rooms). */
		resolve: (messageId: string) => MessageRecord | undefined;
		/** Reaction chips under the message; empty for tombstones. */
		reactions: ReactionChip[];
		/** Files this client is writing to the message's upload embeds, by `embed_id`. */
		uploads: Record<string, UploadState>;
		mention: boolean;
		pinged: boolean;
		highlighted: boolean;
		/** Select mode is on for the pane. */
		selecting: boolean;
		selected: boolean;
		editing: boolean;
		caps: MessageCaps;
		onreply: () => void;
		onjump: (id: string) => void;
		/** A room mention was clicked (Appendix A.3). */
		onopenroom: (roomId: string) => void;
		onedit: () => void;
		/** The edit's new text, and its embed changes if any. */
		onsave: (text: string, edits?: EmbedEdits) => void;
		oncanceledit: () => void;
		ondelete: () => void;
		onremovereply: () => void;
		/** Edit the message to drop this embed. */
		onremoveembed: (embed: EmbedData) => void;
		onstartthread: () => void;
		/** Copies the message's link; resolves whether it was copied. */
		oncopylink: () => Promise<boolean>;
		/** Toggle your reaction with this emoji. */
		onreact: (emoji: string) => void;
		/** Enter select mode with this message picked. */
		onbeginselect: () => void;
		/** In select mode: toggle this message, or fill the range to it. */
		onselect: (range: boolean) => void;
	}
	let {
		event, grouped, resolve, reactions, uploads, mention, pinged, highlighted, selecting, selected, editing, caps,
		onreply, onjump, onopenroom, onedit, onsave, oncanceledit, ondelete, onremovereply, onremoveembed, onstartthread, oncopylink, onreact, onbeginselect, onselect
	}: Props = $props();

	let moreOpen = $state(false);
	/**
	 * The hover toolbar is built the first time a pointer or focus reaches the
	 * row: it shows only then, and building it for every row made opening a
	 * room noticeably slower.
	 */
	let engaged = $state(false);
	/** The React action's button: the emoji picker opens beside it. */
	let reactButton = $state<HTMLButtonElement | undefined>();
	let reacting = $derived(emojiPicker.isOpenFor(reactButton));
	let longPress: ReturnType<typeof setTimeout> | undefined;

	let name = $derived(senderName(event));
	/**
	 * Name (@user_id) (§3.3): the handle shows only where it tells people
	 * apart, when another user shows under the same name; a handle that merely
	 * differs from the name adds nothing.
	 */
	let handle = $derived(directory.person(event.from)?.user_id ?? event.from.user_id);
	let showHandle = $derived(Boolean(handle) && directory.sharesName(event.from));
	/** Who else got a system message (Appendix A.1): everyone on the server, the room, or only you. */
	let scope = $derived(systemScope(event.from.user_id));
	let time = $derived(eventTime(event));
	let text = $derived(textOf(event));
	let embeds = $derived(embedsOf(event));
	let system = $derived(isSystem(event));
	/** A system message shows as a line, or as a card titled by its sender as the frame carries it (§3.3) when scoped; neither has actions or select gestures. */
	let systemShown = $derived(system && !selecting);
	let notice = $derived(systemShown && Boolean(scope));
	/** `roles` (§3.3) from the kept user object, else the recorded one: badges beside the name, never part of it. */
	let roles = $derived.by(() => {
		const listed = directory.person(event.from)?.roles;
		return Array.isArray(listed) ? listed : undefined;
	});
	let body = $derived(event.body?.format === 'markdown' ? renderMarkdown(text, directory.resolve, directory.resolveRoom) : renderPlain(text, directory.resolve, directory.resolveRoom));
	let selectable = $derived(selecting && caps.select);
	let picked = $derived(selectable && selected);
	let replyId = $derived(event.reply_to?.message_id);
	let replyTarget = $derived(replyId && !event.deleted ? resolve(replyId) : undefined);
	let chips = $derived(event.deleted ? [] : reactions);
	/**
	 * Your own embeds can be removed, but not the last thing in a message
	 * (§3.5: a message has text or embeds; delete it instead), nor an upload
	 * still being written.
	 */
	let canRemoveEmbeds = $derived(caps.edit && !selecting && (Boolean(text.trim()) || embeds.length > 1));
	const writing = (embed: EmbedData): boolean => Boolean(embed.embed_id && uploads[embed.embed_id] && !uploads[embed.embed_id].failed);
	let hasActions = $derived(!selecting && (caps.reply || caps.edit || caps.removeReply || caps.react || caps.startThread || caps.link));
	/** Copy link says it worked for a moment before ⋯ closes. */
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(copiedTimer));

	$effect(() => {
		if (!editing) moreOpen = false;
	});

	/** React opens the full picker; a pick toggles that reaction, as a chip does. */
	function openReact(): void {
		if (reactButton) emojiPicker.toggle({ anchor: reactButton, onpick: onreact, caption: { lead: `React to ${name}`, text: replySnippet(event) } });
	}

	function act(action: () => void): void {
		moreOpen = false;
		action();
	}

	async function copyLink(): Promise<void> {
		if (!(await oncopylink())) {
			moreOpen = false;
			return;
		}
		clearTimeout(copiedTimer);
		copied = true;
		copiedTimer = setTimeout(() => {
			copied = false;
			moreOpen = false;
		}, 1200);
	}

	/** Shift-click enters select mode with this message picked; inside it, plain clicks toggle. */
	function click(mouse: MouseEvent): void {
		const roomLink = (mouse.target as HTMLElement | null)?.closest<HTMLElement>('[data-room-id]');
		if (roomLink?.dataset.roomId) {
			onopenroom(roomLink.dataset.roomId);
			return;
		}
		// A user mention, or the sender's name or avatar, opens their profile card; in select mode it picks the message.
		if (!selecting && openProfileFrom(mouse.target)) return;
		if ((mouse.target as HTMLElement | null)?.closest('a, button:not([data-user-id]), input, textarea, select')) return;
		if (selecting) {
			if (!caps.select) return;
			// Handled here, with the range a shift-click fills: the design system's own toggle stands down.
			mouse.preventDefault();
			onselect(mouse.shiftKey);
			return;
		}
		if (mouse.shiftKey && caps.select) onbeginselect();
	}

	/** Keyboard: `x` on a focused message picks it, the same as a shift-click. */
	function keydown(key: KeyboardEvent): void {
		if (key.key !== 'x' || key.metaKey || key.ctrlKey || key.altKey || !caps.select) return;
		if ((key.target as HTMLElement | null)?.closest('input, textarea, select')) return;
		key.preventDefault();
		if (selecting) onselect(false);
		else onbeginselect();
	}

	/** Touch has no hover: a long press opens select mode instead. */
	function pointerdown(pointer: PointerEvent): void {
		cancelLongPress();
		if (pointer.pointerType !== 'touch' || selecting || editing || !caps.select) return;
		// A long press on a reaction chip lists who reacted instead.
		if ((pointer.target as HTMLElement | null)?.closest?.('[data-testid="reaction-chip"]')) return;
		longPress = setTimeout(() => {
			longPress = undefined;
			onbeginselect();
		}, LONG_PRESS_MS);
	}

	function cancelLongPress(): void {
		if (!longPress) return;
		clearTimeout(longPress);
		longPress = undefined;
	}

	$effect(() => cancelLongPress);
</script>

<!-- The design system's Message draws the row; the app fills in who the sender is, the quote, the body and the toolbar. -->
{#snippet avatar()}
	<!-- The name beside it is the keyboard's way in; the avatar is a second target for the pointer. -->
	<button class="ap-msg-who" type="button" tabindex="-1" aria-hidden="true" data-user-id={handle}><Avatar {name} id={directory.person(event.from)?.user_id} src={directory.avatar(event.from)} /></button>
{/snippet}
{#snippet sender()}
	<button class="ap-msg-sender ap-msg-who" type="button" data-user-id={handle} aria-haspopup="dialog" title="Show profile">{name}</button>
	{#if showHandle}<span class="ap-msg-handle" data-testid="sender-handle">@{handle}</span>{/if}
{/snippet}
<!-- The quote has a row of its own above the sender's name, its spine leading down into the avatar (a reply never groups). -->
{#snippet reply()}
	{#if replyTarget}
		{@const targetName = senderName(replyTarget)}
		<button class="ap-reply" data-testid="reply-reference" type="button" aria-label={`Replying to ${targetName}. Jump to their message`} onclick={() => onjump(replyTarget.message_id)}>
			<Avatar name={targetName} id={directory.person(replyTarget.from)?.user_id} src={directory.avatar(replyTarget.from)} size="sm" />
			<span class="ap-reply-who">{targetName}</span>
			<span class="ap-reply-text">{#if replyTarget.deleted}<em>Message deleted</em>{:else}<MentionText text={replySnippet(replyTarget)} />{/if}</span>
		</button>
	{:else}
		<div class="ap-reply ap-reply-static" data-testid="reply-reference">
			<span class="ap-reply-text"><em>Message unavailable</em></span>
		</div>
	{/if}
{/snippet}
<!-- A scoped system message (Appendix A.1): a left-aligned card titled by who got it; code blocks in it get a Copy button. -->
{#snippet noticeText()}
	<div class="ap-msg-text" class:ap-msg-plain={event.body?.format !== 'markdown'} use:copyCode={body} use:highlightCode={body}>{@html body}</div>
{/snippet}
<!-- Another system identity (Appendix A.1): a quiet centered line, no avatar, actions or grouping. -->
{#snippet systemText()}
	<div class="ap-msg-text" class:ap-msg-plain={event.body?.format !== 'markdown'} use:highlightCode={body}>{@html body}</div>
{/snippet}
{#snippet content()}
	{#if editing}
		<MessageEditor {text} {embeds} {uploads} {onsave} oncancel={oncanceledit} />
	{:else}
		{#if text}
			<!-- An absent format is plain (§3.5); only an explicit `markdown` body is rendered as Markdown. -->
			{#if event.body?.format === 'markdown'}
				<div class="ap-msg-text ap-msg-markdown" use:highlightCode={body}>{@html body}</div>
			{:else}
				<div class="ap-msg-text ap-msg-plain">{@html body}</div>
			{/if}
		{/if}
		{#if embeds.length > 0}
			<div class="ap-msg-embeds">
				{#each embeds as embed, index (embed.embed_id ?? index)}
					<div class="ap-embed-slot">
						<Embed {embed} upload={embed.embed_id ? uploads[embed.embed_id] : undefined} detail={time ? `${name} · ${time}` : name} />
						{#if canRemoveEmbeds && !writing(embed)}
							<EmbedRemove label="Remove embed" onremove={() => onremoveembed(embed)} />
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
{/snippet}
{#snippet reactionBar()}
	{#if !event.deleted}<ReactionBar {chips} enabled={caps.react} ontoggle={onreact} />{/if}
{/snippet}
{#snippet toolbar()}
	<div class="ap-actions" role="toolbar" aria-label="Message actions">
		{#if event.deleted && caps.removeReply}
			<button class="ap-actions-btn" type="button" aria-label="Remove reply reference" onclick={() => act(onremovereply)}>Remove reply</button>
		{/if}
		{#if caps.reply}
			<button class="ap-actions-btn" type="button" aria-label="Reply to message" onclick={() => act(onreply)}>Reply</button>
		{/if}
		{#if caps.react && !event.deleted}
			<button
				class="ap-actions-btn"
				type="button"
				aria-label="React"
				title="React"
				aria-haspopup="dialog"
				aria-expanded={reacting}
				bind:this={reactButton}
				{@attach emojiAnchor}
				onclick={() => act(openReact)}
			>React</button>
		{/if}
		{#if caps.startThread}
			<button class="ap-actions-btn" type="button" aria-label="Start thread" title="Start thread" onclick={() => act(onstartthread)}>Start thread</button>
		{/if}
		{#if caps.edit}
			<button class="ap-actions-btn" type="button" aria-label="Edit message" title="Edit" onclick={() => act(onedit)}>Edit</button>
		{/if}
		<!-- ⋯ holds the rarer actions: Copy link on any message; on your own, Select and Delete too. -->
		{#if caps.edit || caps.link}
			{#if moreOpen}
				{#if caps.edit && replyId}
					<button class="ap-actions-btn" type="button" aria-label="Remove reply reference" onclick={() => act(onremovereply)}>Remove reply</button>
				{/if}
				{#if caps.edit && caps.select}
					<button class="ap-actions-btn" type="button" data-testid="select-message" aria-label="Select message" title="Select" onclick={() => act(onbeginselect)}>Select</button>
				{/if}
				{#if caps.link}
					<button class="ap-actions-btn" type="button" aria-label={copied ? 'Link copied' : 'Copy link to message'} title="Copy link" onclick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
				{/if}
				{#if caps.edit}
					<button class="ap-actions-btn ap-actions-danger" type="button" aria-label="Delete message" title="Delete" onclick={() => act(ondelete)}>Delete</button>
				{/if}
			{:else}
				<button class="ap-actions-btn" type="button" aria-label="More actions" aria-expanded="false" title="More" onclick={() => (moreOpen = true)}>⋯</button>
			{/if}
		{/if}
	</div>
{/snippet}

<DesignMessage
	data-timeline-item=""
	messageId={event.message_id}
	sender={notice ? event.from : { user_id: handle, name, roles }}
	timestamp={idMillis(event.message_id)}
	{grouped}
	deleted={event.deleted}
	system={systemShown}
	{scope}
	{mention}
	{pinged}
	{highlighted}
	selectMode={selectable}
	selected={picked}
	onselect={() => onselect(false)}
	avatar={avatar}
	name={sender}
	reply={replyId ? reply : undefined}
	body={notice ? noticeText : systemShown ? systemText : content}
	footer={reactionBar}
	actions={hasActions && engaged && !editing ? toolbar : undefined}
	onclick={click}
	onkeydown={systemShown ? undefined : keydown}
	onpointerenter={systemShown ? undefined : () => (engaged = true)}
	onfocusin={systemShown ? undefined : () => (engaged = true)}
	onpointerdown={systemShown ? undefined : pointerdown}
	onpointerup={systemShown ? undefined : cancelLongPress}
	onpointermove={systemShown ? undefined : cancelLongPress}
	onpointercancel={systemShown ? undefined : cancelLongPress}
/>

