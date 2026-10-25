<script module lang="ts">
	import type { MessageHandlers } from './types';

	const LONG_PRESS_MS = 500;
	const NONE: MessageHandlers = {};
	/** The one touch long press in progress, page-wide: a second finger elsewhere starts over. */
	let press: ReturnType<typeof setTimeout> | undefined;

	function cancelPress(): void {
		if (!press) return;
		clearTimeout(press);
		press = undefined;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import Avatar from './Avatar.svelte';
	import MessageActions from './MessageActions.svelte';
	import MessageEmbeds from './MessageEmbeds.svelte';
	import ReactionBar from './ReactionBar.svelte';
	import LinkCard from './LinkCard.svelte';
	import ReplyPreview from './ReplyPreview.svelte';
	import RoleBadges from './RoleBadges.svelte';
	import type { MessageAction, MessageEmbed, MessageTestids, MessageView } from './types';
	import { times } from './util';

	/**
	 * One message row, drawn from a MessageView. The header, body and reactions are its own; the quote, the messages,
	 * rooms and threads its links point to, the embeds, the hover toolbar and the editor are parts it adds only to the
	 * rows that have them. The toolbar is built the first time a pointer or focus reaches the row, since it only shows
	 * then.
	 */
	interface Props {
		view: MessageView;
		on?: MessageHandlers;
		testids?: MessageTestids;
		/** In place of the body while the message is being edited, such as your MessageEditor. Pass it to that row only. */
		editor?: Snippet<[MessageView]>;
		/** Draws one embed, in place of the design system's Embed. */
		embed?: Snippet<[MessageEmbed]>;
	}
	let { view, on = NONE, testids, editor, embed }: Props = $props();

	let engaged = $state(false);
	/** Whether the last press on the row was a touch, which leaves it hovered and focused: the toolbar sticks. */
	let touched = false;
	/** A tap showed the toolbar; the next one on the row hides it again, with `dismissed`, until a tap after that. */
	let tapped = false;
	let dismissed = $state(false);

	const t = $derived(times(view.timestamp, view.time));
	const quoted = $derived(Boolean(view.reply) && !view.deleted);
	const grouped = $derived(view.grouped && !quoted);
	/** A check column: select mode, on a message you may pick. */
	const checkable = $derived(Boolean(view.selecting && view.caps?.select));
	const caps = $derived(view.caps);
	const toolbar = $derived(engaged && !view.editing && !view.selecting && caps !== undefined && (caps.reply || caps.edit || caps.removeReply || caps.react || caps.startThread || caps.link));

	/** The toolbar's actions, in order; the rarer ones wait behind ⋯. */
	function actions(): { items: MessageAction[]; more?: MessageAction[] } {
		const can = caps!;
		const items: MessageAction[] = [];
		if (view.deleted && can.removeReply) items.push({ id: 'unreply', label: 'Remove reply reference', glyph: 'Remove reply', onclick: () => on.removeReply?.(view) });
		if (can.reply) items.push({ id: 'reply', label: 'Reply to message', glyph: 'Reply', onclick: () => on.reply?.(view) });
		if (can.react && !view.deleted) {
			items.push({ id: 'react', label: 'React', title: 'React', popup: true, expanded: on.picking?.(view), attach: on.pickAnchor, onclick: (event) => on.pick?.(view, event.currentTarget as HTMLElement) });
		}
		if (can.startThread) items.push({ id: 'thread', label: 'Start thread', title: 'Start thread', onclick: () => on.startThread?.(view) });
		if (can.edit) items.push({ id: 'edit', label: 'Edit message', title: 'Edit', glyph: 'Edit', onclick: () => on.edit?.(view) });
		if (!can.edit && !can.link) return { items };
		const more: MessageAction[] = [];
		if (can.edit && view.reply) more.push({ id: 'unreply', label: 'Remove reply reference', glyph: 'Remove reply', onclick: () => on.removeReply?.(view) });
		if (can.edit && can.select) more.push({ id: 'select', label: 'Select message', title: 'Select', glyph: 'Select', testid: testids?.select, onclick: () => on.beginSelect?.(view) });
		if (can.link) more.push({ id: 'link', label: 'Copy link to message', title: 'Copy link', glyph: 'Copy link', done: { label: 'Link copied', glyph: 'Copied' }, onclick: () => on.copyLink?.(view) });
		if (can.edit) more.push({ id: 'delete', label: 'Delete message', title: 'Delete', glyph: 'Delete', danger: true, onclick: () => on.delete?.(view) });
		return { items, more };
	}

	/**
	 * A click: a room mention opens it; outside select mode a person (a mention, the sender's name or avatar) opens
	 * their profile; in select mode it picks the message, a shift-click filling the range; else a shift-click starts
	 * select mode with it picked.
	 */
	function click(event: MouseEvent): void {
		const target = event.target as HTMLElement | null;
		const room = target?.closest?.<HTMLElement>('[data-room-id]');
		if (room?.dataset.roomId) {
			on.openRoom?.(room.dataset.roomId);
			return;
		}
		if (!view.selecting && on.openProfile?.(event.target)) return;
		if (target?.closest?.('a, button:not([data-user-id]), input, textarea, select')) return;
		if (view.selecting) {
			if (!view.caps?.select) return;
			event.preventDefault();
			on.select?.(view, event.shiftKey);
			return;
		}
		if (event.shiftKey && view.caps?.select) on.beginSelect?.(view);
		else if (touched) tap(event.currentTarget as HTMLElement);
	}

	/** A tap on the row, off its controls: it toggles the toolbar, which touch can't hover away from. */
	function tap(row: HTMLElement): void {
		tapped = !tapped;
		dismissed = !tapped;
		if (dismissed && row.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
	}

	/** Focus leaving the row, for another message or anywhere else, takes the toolbar away; the next tap shows it. */
	function focusout(event: FocusEvent): void {
		if (event.relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(event.relatedTarget)) return;
		tapped = false;
	}

	/** Keyboard: `x` on a focused message picks it, the same as a shift-click. */
	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'x' || event.metaKey || event.ctrlKey || event.altKey || !view.caps?.select) return;
		if ((event.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
		event.preventDefault();
		if (view.selecting) on.select?.(view, false);
		else on.beginSelect?.(view);
	}

	function checkKey(event: KeyboardEvent): void {
		if (event.key !== ' ' && event.key !== 'Enter') return;
		event.preventDefault();
		on.select?.(view, false);
	}

	/** Touch has no hover or shift: a long press starts select mode instead, unless it's on a chip, which lists who reacted. */
	function pointerdown(event: PointerEvent): void {
		cancelPress();
		touched = event.pointerType === 'touch';
		if (event.pointerType !== 'touch' || view.selecting || view.editing || !view.caps?.select) return;
		if ((event.target as HTMLElement | null)?.closest?.('.ap-rchip')) return;
		const row = event.currentTarget as HTMLElement;
		press = setTimeout(() => {
			press = undefined;
			if (row.isConnected) on.beginSelect?.(view);
		}, LONG_PRESS_MS);
	}

	function engage(event: Event): void {
		engaged = true;
		if ((event as PointerEvent).pointerType === 'mouse') dismissed = false;
	}

	/** Its code blocks, decorated by `on.code` (a notice's get Copy buttons), again whenever the body changes. */
	function code(node: HTMLElement): void | (() => void) {
		void view.body?.html;
		return on.code?.(node, Boolean(view.system && view.scope));
	}
</script>

<!-- Every row marks itself a timeline item, for whoever scrolls the timeline. -->
{#if view.system && view.scope}
	<!-- A scoped notice: a left-aligned card titled by its sender as the server names it (§3.3). -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<article class={['ap-notice', view.scope === 'private' && 'ap-notice-private']} data-message-id={view.id} data-scope={view.scope} data-timeline-item="" data-testid={testids?.row} tabindex="-1" onclick={click}>
		<div class="ap-notice-head"><span class="ap-notice-title">{view.sender.name}</span>{#if t.short}<time class="ap-notice-time" datetime={t.iso} title={t.exact}>{t.short}</time>{/if}</div>
		<div class="ap-notice-body">{#if view.deleted}<span class="ap-msg-tomb">Message deleted</span>{:else}<div class={['ap-msg-text', !view.body?.markdown && 'ap-msg-plain']} {@attach view.body?.code && code}>{@html view.body?.html ?? ''}</div>{/if}</div>
	</article>
{:else if view.system}
	<!-- Another system identity (Appendix A.1): a quiet centered line, no avatar, actions or grouping. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<article class="ap-msg ap-msg-system" data-message-id={view.id} data-timeline-item="" data-testid={testids?.row} tabindex="-1" onclick={click}>
		<span class="ap-msg-system-who">{view.sender.name}</span>
		<div class="ap-msg-system-body">{#if view.deleted}<span class="ap-msg-tomb">Message deleted</span>{:else}<div class={['ap-msg-text', !view.body?.markdown && 'ap-msg-plain']} {@attach view.body?.code && code}>{@html view.body?.html ?? ''}</div>{/if}</div>
		{#if t.short}<time class="ap-msg-system-time" datetime={t.iso} title={t.exact}>{t.short}</time>{/if}
	</article>
{:else}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<article
		class={['ap-msg', grouped && 'ap-msg-grouped', view.mention && 'ap-msg-mention', view.pinged && 'ap-msg-pinged', view.highlighted && 'ap-msg-highlighted', checkable && 'ap-msg-selectable', checkable && view.selected && 'ap-msg-selected', dismissed && !view.selecting && 'ap-msg-dismissed']}
		data-message-id={view.id}
		data-timeline-item=""
		data-testid={testids?.row}
		tabindex="-1"
		onclick={click}
		onkeydown={keydown}
		onpointerenter={engage}
		onfocusin={engage}
		onfocusout={focusout}
		onpointerdown={pointerdown}
		onpointerup={cancelPress}
		onpointermove={cancelPress}
		onpointercancel={cancelPress}
	>
		{#if quoted}<div class="ap-msg-reply"><ReplyPreview reply={view.reply!} onjump={on.jump} data-testid={testids?.reply} /></div>{/if}
		{#if checkable}<span class="ap-msg-check" role="checkbox" aria-checked={Boolean(view.selected)} aria-label="Select message" tabindex="0" onkeydown={checkKey}>{view.selected ? '✓' : ''}</span>{/if}
		<div class="ap-msg-gutter">
			{#if grouped}<time class="ap-msg-hovertime" datetime={t.iso} title={t.exact}>{t.compact}</time>
			{:else}
				<!-- The sender's name and avatar open their profile (`on.openProfile`): the name is the keyboard's way in; the avatar is a second target for the pointer. -->
				<button class="ap-msg-who" type="button" tabindex="-1" aria-hidden="true" data-user-id={view.sender.user_id}><Avatar name={view.sender.name} src={view.sender.avatar} hue={view.sender.hue} /></button>
			{/if}
		</div>
		<div class="ap-msg-main">
			{#if !grouped}
				<header class="ap-msg-head">
					<button class="ap-msg-sender ap-msg-who" type="button" data-user-id={view.sender.user_id} aria-haspopup="dialog" title="Show profile">{view.sender.name}</button>
					{#if view.sender.handle}<span class="ap-msg-handle" data-testid={testids?.handle}>@{view.sender.handle}</span>{/if}
					{#if view.sender.roles?.length}<RoleBadges roles={view.sender.roles} />{/if}
					<span class="ap-msg-meta">{#if t.short}<time datetime={t.iso} title={t.exact}>{t.short}</time>{/if}</span>
				</header>
			{/if}
			{#if view.deleted}<div class="ap-msg-tomb">Message deleted</div>
			{:else if editor}{@render editor(view)}
			{:else}
				<!-- An absent format is plain (§3.5); only an explicit `markdown` body is rendered as Markdown. -->
				{#if view.body}<div class={['ap-msg-text', view.body.markdown ? 'ap-msg-markdown' : 'ap-msg-plain']} {@attach view.body.code && code}>{@html view.body.html}</div>{/if}
				{#if view.linkCards?.length}<div class="ap-msg-linkcards">{#each view.linkCards as card (card.href)}<LinkCard {card} data-testid={testids?.linkCard} />{/each}</div>{/if}
				{#if view.embeds?.length}<MessageEmbeds embeds={view.embeds} {embed} onremove={(item) => on.removeEmbed?.(view, item)} />{/if}
			{/if}
			{#if !view.deleted && view.reactions?.length}<ReactionBar reactions={view.reactions} disabled={!caps?.react} add={false} ontoggle={(emoji) => on.react?.(view, emoji)} onreactors={(emoji, chip) => on.reactors?.(view, emoji, chip)} data-testid={testids?.reactions} chipTestid={testids?.chip} />{/if}
		</div>
		{#if toolbar}
			{@const { items, more } = actions()}
			<div class="ap-msg-actions"><MessageActions {items} {more} /></div>
		{/if}
	</article>
{/if}
