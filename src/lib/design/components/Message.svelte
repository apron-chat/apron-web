<script lang="ts">
	import type { Snippet } from 'svelte';
	import Avatar from './Avatar.svelte';
	import Embed from './Embed.svelte';
	import ReactionBar from './ReactionBar.svelte';
	import ReplyPreview from './ReplyPreview.svelte';
	import RoleBadges from './RoleBadges.svelte';
	import type { EmbedProps, ReactionChip, ReplyPreviewProps, Sender } from './types';
	import { times, uid } from './util';

	interface Props {
		/** Omit only for a system line about the room itself (room records carry no sender). A `~private` notice has no `messageId`: render it, never store it (§3.5). */
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
		/** Render as a system message. Defaults to true when `sender.user_id` starts with "~" (Appendix A.1). */
		system?: boolean;
		/** Who else received a system notice (Appendix A.1); derived from `~server`, `~room`, `~private`. */
		scope?: 'server' | 'room' | 'private';
		/** `body.mentions` lists the viewer's `user_id` (§3.5) — never decided from the text. */
		mention?: boolean;
		/** First render after the mention ARRIVED: one ring pulse. */
		pinged?: boolean;
		highlighted?: boolean;
		density?: 'cozy' | 'compact';
		/** Hover/focus toolbar, usually a <MessageActions>. Omit when the server allows nothing. */
		actions?: Snippet;
		/** Under the body — such as the <ThreadMarker> card of a thread started from this message. */
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
	let {
		messageId, sender, handle, text, children, embeds, timestamp, time, grouped, status = 'sent', onretry, edited, deleted,
		system: systemProp, scope: scopeProp, mention, pinged, highlighted, density = 'cozy', actions, footer, replyTo, onjumpto,
		reactions, reacting, palette, canReact, onreact, onopenreact, onclosereact, selectMode, selected, onselect
	}: Props = $props();

	const s = $derived(sender || ({} as Partial<Sender>));
	const sid = $derived(uid(s));
	const name = $derived(s.name || sid);
	const system = $derived(systemProp ?? String(sid || '').startsWith('~'));
	const scope = $derived(scopeProp || (sid === '~server' ? 'server' : sid === '~room' ? 'room' : sid === '~private' ? 'private' : undefined));
	const showHandle = $derived(!!sid && sid !== name && (handle ?? density !== 'compact'));
	const t = $derived(times(timestamp, time));
	const sel = $derived(!!selectMode);
	const noticeTitle = $derived(s.name && s.name !== sid ? `${s.name} (${sid})` : sid);
	const cls = $derived(['ap-msg', grouped && 'ap-msg-grouped', status === 'pending' && 'ap-msg-pending', mention && 'ap-msg-mention', pinged && 'ap-msg-pinged', highlighted && 'ap-msg-highlighted', sel && 'ap-msg-selectable', sel && selected && 'ap-msg-selected', density === 'compact' && 'ap-msg-compact']);
	const hasMeta = $derived((edited && !deleted) || status === 'pending');

	function rowClick(e: MouseEvent) {
		if (!sel) return;
		if ((e.target as Element)?.closest?.('a, button, input, textarea')) return;
		onselect?.(e);
	}
	function checkKey(e: KeyboardEvent) {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			onselect?.(e);
		}
	}
</script>

{#snippet textBody(tag: 'div' | 'span')}
	<svelte:element this={tag} class="ap-msg-text">{#if children}{@render children()}{:else}{text}{/if}</svelte:element>
{/snippet}
{#snippet tomb()}<span class="ap-msg-tomb">Message deleted</span>{/snippet}
{#snippet timeEl(text: string | undefined, className?: string)}
	{#if text}<time class={className} datetime={t.iso} title={t.exact}>{text}</time>{/if}
{/snippet}
{#snippet meta()}{#if edited && !deleted}<span>edited</span>{/if}{#if status === 'pending'}<span>Sending…</span>{/if}{/snippet}
{#snippet quote()}{#if replyTo && !deleted}<ReplyPreview onjump={onjumpto} {...replyTo} />{/if}{/snippet}
{#snippet embedList()}
	{#if embeds && embeds.length}<div class="ap-msg-embeds">{#each embeds as e, i (e.embed_id || i)}<Embed {...e} />{/each}</div>{/if}
{/snippet}
{#snippet failed()}
	{#if status === 'failed'}<div class="ap-msg-failed">Not sent · <button type="button" class="ap-link" onclick={onretry}>Retry</button></div>{/if}
{/snippet}
{#snippet check()}
	{#if sel}<span class="ap-msg-check" role="checkbox" aria-checked={!!selected} aria-label="Select message" tabindex="0" onkeydown={checkKey}>{selected ? '✓' : ''}</span>{/if}
{/snippet}
{#snippet actionBar()}
	{#if actions && !deleted && !sel}<div class="ap-msg-actions">{@render actions()}</div>{/if}
{/snippet}

{#if system && !sel && scope}
	<!-- A scoped notice: a left-aligned card titled by its sender as the server names it (§3.3). -->
	<article class={['ap-notice', scope === 'private' && 'ap-notice-private']} data-message-id={messageId} data-scope={scope} tabindex="-1">
		<div class="ap-notice-head"><span class="ap-notice-title">{noticeTitle}</span>{@render timeEl(t.short, 'ap-notice-time')}</div>
		<div class="ap-notice-body">{#if deleted}{@render tomb()}{:else}{@render textBody('div')}{/if}</div>
	</article>
{:else if system && !sel}
	<article class="ap-msg ap-msg-system" data-message-id={messageId} tabindex="-1">
		{#if sender}<span class="ap-msg-system-who">{name}</span>{/if}
		<div class="ap-msg-system-body">{#if deleted}{@render tomb()}{:else}{@render textBody('div')}{/if}</div>
		{@render timeEl(t.short, 'ap-msg-system-time')}
	</article>
{:else if density === 'compact'}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<article class={cls} data-message-id={messageId} tabindex="-1" onclick={rowClick}>
		{@render check()}
		<time class="ap-msg-ctime" datetime={t.iso} title={t.exact}>{t.short}</time>
		<div class="ap-msg-main">
			<span class="ap-msg-sender">{name}</span>
			{#if showHandle}<span class="ap-msg-handle">@{sid}</span>{/if}
			<RoleBadges roles={s.roles} />
			{#if deleted}{@render tomb()}{:else}
				{@render quote()}
				{@render textBody('span')}
				{#if hasMeta}<span class="ap-msg-meta">{@render meta()}</span>{/if}
				{@render embedList()}
				{@render failed()}
			{/if}
			{@render footer?.()}
		</div>
		{@render actionBar()}
	</article>
{:else}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<article class={cls} data-message-id={messageId} tabindex="-1" onclick={rowClick}>
		{@render check()}
		<div class="ap-msg-gutter">
			{#if grouped}<time class="ap-msg-hovertime" datetime={t.iso} title={t.exact}>{t.compact}</time>
			{:else}<Avatar {name} src={s.avatar} />{/if}
		</div>
		<div class="ap-msg-main">
			{#if !grouped}
				<header class="ap-msg-head">
					<span class="ap-msg-sender">{name}</span>
					{#if showHandle}<span class="ap-msg-handle">@{sid}</span>{/if}
					<RoleBadges roles={s.roles} />
					<span class="ap-msg-meta">{@render timeEl(t.short)}{@render meta()}</span>
				</header>
			{:else if hasMeta}<div class="ap-msg-meta">{@render meta()}</div>{/if}
			{#if deleted}<div class="ap-msg-tomb">Message deleted</div>{:else}
				{@render quote()}
				{#if children || text != null}{@render textBody('div')}{/if}
				{@render embedList()}
				{@render failed()}
				{#if (reactions && reactions.length) || reacting}
					<ReactionBar reactions={reactions || []} open={reacting} palette={palette} disabled={canReact === false} ontoggle={onreact} onopen={onopenreact} onclose={onclosereact} />
				{/if}
			{/if}
			{@render footer?.()}
		</div>
		{@render actionBar()}
	</article>
{/if}
