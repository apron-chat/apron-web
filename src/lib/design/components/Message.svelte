<script module lang="ts">
	import type { MessageHandlers } from './types';

	const LONG_PRESS_MS = 500;
	/** How far a held finger may drift before the press counts as a scroll: a finger is never quite still. */
	const SLOP_PX = 10;
	const NONE: MessageHandlers = {};
	/** The one touch long press in progress, page-wide, and where it began: a second finger elsewhere starts over. */
	let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined;

	function cancelPress(): void {
		if (!press) return;
		clearTimeout(press.timer);
		press = undefined;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import Avatar from './Avatar.svelte';
	import MessageActions from './MessageActions.svelte';
	import MessageEmbeds from './MessageEmbeds.svelte';
	import ReactionBar from './ReactionBar.svelte';
	import ReadReceipts from './ReadReceipts.svelte';
	import LinkCard from './LinkCard.svelte';
	import ReplyPreview from './ReplyPreview.svelte';
	import RoleBadges from './RoleBadges.svelte';
	import TypingDots from './TypingDots.svelte';
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
	/** The last press on the row was a touch: its toolbar shows only once a long press opens it (`held`). */
	let touch = $state(false);
	/** A long press opened the toolbar as touch's menu: larger, with Reply and React up front and the rest behind ⋯. */
	let held = $state(false);
	/** The click that ends a long press: the press opened the menu, so the click does nothing else. */
	let swallow = false;

	const t = $derived(times(view.timestamp, view.time));
	const quoted = $derived(Boolean(view.reply) && !view.deleted);
	const grouped = $derived(view.grouped && !quoted);
	/** A check column: select mode, on a message you may pick. */
	const checkable = $derived(Boolean(view.selecting && view.caps?.select));
	const caps = $derived(view.caps);
	const actionable = $derived(caps !== undefined && (caps.reply || caps.edit || caps.removeReply || caps.react || caps.startThread || caps.link || caps.select));
	const toolbar = $derived(engaged && !view.editing && !view.selecting && actionable);

	/**
	 * The toolbar's actions, in order; the rarer ones wait behind ⋯. Touch's menu (`held`) keeps only Reply and React
	 * up front, with everything else behind ⋯, and offers Copy text, since its rows take no text selection.
	 */
	function actions(): { items: MessageAction[]; more?: MessageAction[] } {
		const can = caps!;
		const unreplied: MessageAction | undefined = view.deleted && can.removeReply ? { id: 'unreply', label: 'Remove reply reference', glyph: 'Remove reply', onclick: () => on.removeReply?.(view) } : undefined;
		const reply: MessageAction | undefined = can.reply ? { id: 'reply', label: 'Reply to message', glyph: 'Reply', onclick: () => on.reply?.(view) } : undefined;
		const react: MessageAction | undefined = can.react && !view.deleted
			? { id: 'react', label: 'React', title: 'React', popup: true, expanded: on.picking?.(view), attach: on.pickAnchor, onclick: (event) => on.pick?.(view, event.currentTarget as HTMLElement) }
			: undefined;
		const thread: MessageAction | undefined = can.startThread ? { id: 'thread', label: 'Start thread', title: 'Start thread', onclick: () => on.startThread?.(view) } : undefined;
		const edit: MessageAction | undefined = can.edit ? { id: 'edit', label: 'Edit message', title: 'Edit', glyph: 'Edit', onclick: () => on.edit?.(view) } : undefined;
		const unreply: MessageAction | undefined = can.edit && view.reply ? { id: 'unreply', label: 'Remove reply reference', glyph: 'Remove reply', onclick: () => on.removeReply?.(view) } : undefined;
		const select: MessageAction | undefined = can.select ? { id: 'select', label: 'Select message', title: 'Select', glyph: 'Select', testid: testids?.select, onclick: () => on.beginSelect?.(view) } : undefined;
		const copy: MessageAction | undefined = held && view.body && on.copyText ? { id: 'copy', label: 'Copy text', glyph: 'Copy text', done: { label: 'Text copied', glyph: 'Copied' }, onclick: () => on.copyText?.(view) } : undefined;
		const link: MessageAction | undefined = can.link ? { id: 'link', label: 'Copy link to message', title: 'Copy link', glyph: 'Copy link', done: { label: 'Link copied', glyph: 'Copied' }, onclick: () => on.copyLink?.(view) } : undefined;
		const remove: MessageAction | undefined = can.edit ? { id: 'delete', label: 'Delete message', title: 'Delete', glyph: 'Delete', danger: true, onclick: () => on.delete?.(view) } : undefined;
		const present = (list: Array<MessageAction | undefined>) => list.filter((it): it is MessageAction => it !== undefined);
		if (held) {
			const front = present([reply, react]);
			const rest = present([unreplied, thread, edit, select, copy, link, unreply, remove]);
			return front.length ? { items: front, more: rest } : { items: rest };
		}
		const more = present([unreply, select, link, remove]);
		return { items: present([unreplied, reply, react, thread, edit]), ...(more.length ? { more } : {}) };
	}

	/** Where text is written, whose keys and clicks are its own: `x` there is a letter. */
	const FIELD = 'input, textarea, select, [contenteditable]';

	/**
	 * A click: a room mention opens it; outside select mode a person (a mention, the sender's name or avatar) opens
	 * their profile; in select mode it picks the message, a shift-click filling the range; else a shift-click starts
	 * select mode with it picked. The click that ends a long press does none of that, and a tap on the row while its
	 * touch menu is open puts the menu away.
	 */
	function click(event: MouseEvent): void {
		if (swallow) {
			swallow = false;
			event.preventDefault();
			return;
		}
		const target = event.target as HTMLElement | null;
		// A field (the editor's, rich or not) keeps its clicks: a shift-click there extends its selection, a chip in it stays put.
		if (target?.closest?.(FIELD)) return;
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
		else if (held) release(event.currentTarget as HTMLElement);
	}

	/** Puts touch's menu away, and the focus it took with it. */
	function release(row: HTMLElement): void {
		held = false;
		if (row.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
	}

	/** Focus leaving the row, for another message or anywhere else, puts touch's menu away. */
	function focusout(event: FocusEvent): void {
		if (event.relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(event.relatedTarget)) return;
		// A focused button taken out (⋯ as the rest show) blurs too, but focus hasn't left: that one is gone once this settles.
		const row = event.currentTarget as HTMLElement;
		const from = event.target as Node;
		queueMicrotask(() => {
			if (from.isConnected && !row.contains(document.activeElement)) held = false;
		});
	}

	/** Keyboard: `x` on a focused message picks it, the same as a shift-click; Escape puts touch's menu away. */
	function keydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && held) {
			event.preventDefault();
			release(event.currentTarget as HTMLElement);
			return;
		}
		if (event.key !== 'x' || event.metaKey || event.ctrlKey || event.altKey || !view.caps?.select) return;
		if ((event.target as HTMLElement | null)?.closest?.(FIELD)) return;
		event.preventDefault();
		if (view.selecting) on.select?.(view, false);
		else on.beginSelect?.(view);
	}

	function checkKey(event: KeyboardEvent): void {
		if (event.key !== ' ' && event.key !== 'Enter') return;
		event.preventDefault();
		on.select?.(view, false);
	}

	/**
	 * A press held where touch's menu may open: not in select mode or the editor, and not on a reaction chip (whose
	 * own long press lists who reacted) or on a link or media, whose long press is the browser's.
	 */
	function holdable(target: EventTarget | null): boolean {
		return !view.selecting && !view.editing && actionable && !(target as HTMLElement | null)?.closest?.('.ap-rchip, a, img, video, audio');
	}

	/** Touch has no hover or right-click: a long press opens the toolbar as its menu. A tap doesn't, so a stray one can't. */
	function pointerdown(event: PointerEvent): void {
		cancelPress();
		swallow = false;
		touch = event.pointerType === 'touch';
		if (!touch || held || !holdable(event.target)) return;
		const row = event.currentTarget as HTMLElement;
		press = {
			timer: setTimeout(() => {
				press = undefined;
				if (row.isConnected) hold(row);
			}, LONG_PRESS_MS),
			x: event.clientX,
			y: event.clientY
		};
	}

	/** A finger that drifts past SLOP_PX is scrolling, not holding. */
	function pointermove(event: PointerEvent): void {
		if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP_PX) cancelPress();
	}

	/** Android's own long press, which would select the text under the finger: it opens the menu in its place. */
	function contextmenu(event: MouseEvent): void {
		if (!touch || !holdable(event.target)) return;
		event.preventDefault();
		cancelPress();
		if (!held) hold(event.currentTarget as HTMLElement);
	}

	/** Opens touch's menu on the row, focused so that focus leaving it (a tap elsewhere, another's menu) puts it away. */
	function hold(row: HTMLElement): void {
		held = true;
		engaged = true;
		swallow = true;
		row.focus({ preventScroll: true });
	}

	function engage(event: Event): void {
		engaged = true;
		if ((event as PointerEvent).pointerType === 'mouse') touch = false;
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
		class={['ap-msg', grouped && 'ap-msg-grouped', view.mention && 'ap-msg-mention', view.pinged && 'ap-msg-pinged', view.highlighted && 'ap-msg-highlighted', checkable && 'ap-msg-selectable', checkable && view.selected && 'ap-msg-selected', touch && !held && !view.selecting && 'ap-msg-dismissed', held && 'ap-msg-held']}
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
		onpointermove={pointermove}
		onpointercancel={cancelPress}
		oncontextmenu={contextmenu}
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
			<!-- Floated to the end of the first line (the header, or a follower's first line of text), so it adds no height. Decorative inside the timeline's live log. -->
			{#if view.seenBy?.length && !view.editing}<ReadReceipts people={view.seenBy} decorative class="ap-msg-receipts" testid={testids?.receipts} />{/if}
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
				{#if view.writing}<div class="ap-msg-writing" role="status" data-testid={testids?.writing}><TypingDots />Writing…</div>{/if}
				{#if view.linkCards?.length}<div class="ap-msg-linkcards">{#each view.linkCards as card (card.href)}<LinkCard {card} data-testid={testids?.linkCard} />{/each}</div>{/if}
				{#if view.embeds?.length}<MessageEmbeds embeds={view.embeds} {embed} onremove={(item) => on.removeEmbed?.(view, item)} />{/if}
			{/if}
			{#if !view.deleted && view.reactions?.length}<ReactionBar reactions={view.reactions} disabled={!caps?.react} add={false} ontoggle={(emoji) => on.react?.(view, emoji)} onreactors={(emoji, chip) => on.reactors?.(view, emoji, chip)} data-testid={testids?.reactions} chipTestid={testids?.chip} />{/if}
		</div>
		{#if toolbar}
			{@const { items, more } = actions()}
			<div class="ap-msg-actions"><MessageActions {items} {more} touch={held} /></div>
		{/if}
	</article>
{/if}
