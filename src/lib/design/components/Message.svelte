<script module lang="ts">
	import type { MessageHandlers } from './types';
	import { longPress } from './hold';

	const NONE: MessageHandlers = {};
	const NO_QUICK: readonly string[] = [];
</script>

<script lang="ts">
	import { flushSync, type Snippet } from 'svelte';
	import Avatar from './Avatar.svelte';
	import MessageEmbeds from './MessageEmbeds.svelte';
	import ReactionBar from './ReactionBar.svelte';
	import ReadReceipts from './ReadReceipts.svelte';
	import LinkCard from './LinkCard.svelte';
	import ReplyPreview from './ReplyPreview.svelte';
	import RoleBadges from './RoleBadges.svelte';
	import TypingDots from './TypingDots.svelte';
	import * as icons from './ActionIcons.svelte';
	import { messageDock, type DockClaim } from './message-dock.svelte';
	import type { MessageAction, MessageEmbed, MessageTestids, MessageView } from './types';
	import { times } from './util';

	/**
	 * One message row, drawn from a MessageView. The header, body and reactions are its own; the quote, the messages,
	 * rooms and threads its links point to, the embeds, the hover toolbar and the editor are parts it adds only to the
	 * rows that have them. The toolbar is the dock's (`message-dock.svelte.ts`), the only one, moved into whichever row a
	 * pointer, focus or long press reaches; a row reached while another is using it shows none until reached again.
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

	/**
	 * It holds the dock: its toolbar is in the row, in its slot. Not state: moving the toolbar between rows changes
	 * neither row's markup, so going back and forth costs only what differs between their toolbars.
	 */
	let docked = false;
	/** The row has held the dock: its slot is drawn, and stays for the next time (`dockSlot`). */
	let reached = $state(false);
	/** That slot, while drawn. */
	let slot: HTMLElement | undefined;
	/** Its hold on the dock, made the first time it's reached. */
	let claim: DockClaim | undefined;
	/** The last press on the row was a touch: its toolbar shows only once a long press opens it (`held`). */
	let touch = $state(false);
	/**
	 * A long press opened the toolbar as touch's menu: larger, with Reply and React up front and the rest behind ⋯.
	 * Choosing Select or Edit from it puts it away (the toolbar goes with them), so it isn't back when they end.
	 */
	let held = $state(false);
	/** The click that ends a long press: the press opened the menu, so the click does nothing else. */
	let swallow = false;
	/** The long press this row started (`longPress`). */
	let pressed: object | undefined;
	/** The toolbar's quick reactions (`on.quick`), read as the pointer or focus arrives, so a press doesn't reorder them under it. */
	let quickEmoji = $state<readonly string[]>(NO_QUICK);

	function readQuick(): void {
		const next = on.quick?.() ?? NO_QUICK;
		if (next === quickEmoji) return;
		if (next.length !== quickEmoji.length || next.some((emoji, i) => emoji !== quickEmoji[i])) quickEmoji = next;
	}

	const t = $derived(times(view.timestamp, view.time));
	const quoted = $derived(Boolean(view.reply) && !view.deleted);
	const grouped = $derived(view.grouped && !quoted);
	/** A check column: select mode, on a message you may pick. */
	const checkable = $derived(Boolean(view.selecting && view.caps?.select));
	const caps = $derived(view.caps);
	const actionable = $derived(caps !== undefined && (caps.reply || caps.edit || caps.removeReply || caps.react || caps.startThread || caps.link || caps.select));
	/** It has a toolbar to show: not in select mode or the editor, and something it may do. */
	const showable = $derived(!view.editing && !view.selecting && actionable);

	/** The row was reached while another was using the dock: the pointer moving over it asks again. */
	let wanting = false;

	/** Takes the dock for the row, unless another row is using it; `taking` (a long press) takes it all the same. */
	function takeBar(taking = false): void {
		if (docked || !showable) return;
		claim ??= { bar: () => (showable ? { ...actions(), touch: held } : undefined), pinned: () => held, lost: () => (docked = false) };
		docked = messageDock.claim(claim, taking);
		wanting = !docked;
		if (!docked) return;
		messageDock.place();
		// Into its slot now, from the event that reached it; the first time, the slot takes it as it's drawn.
		if (slot) slot.append(messageDock.host);
		else reached = true;
	}

	/**
	 * The dock's slot in the row, drawn the first time the row holds it and kept: the toolbar moves in whenever the row
	 * takes it, and is let go should the row go while holding it, so a picker its React opened closes.
	 */
	function dockSlot(node: HTMLElement): () => void {
		const mine = claim!;
		slot = node;
		if (docked) node.append(messageDock.host);
		return () => {
			slot = undefined;
			messageDock.release(mine);
		};
	}

	/**
	 * The toolbar's actions, in order: React first, beside the quick reactions; the rarer ones wait behind ⋯. Each
	 * shows as its icon, its `key` (Reply's `r`, Edit's `e`, which `keydown` handles) badged for the keyboard. Touch's
	 * menu (`held`) keeps only React and Reply up front, with everything else behind ⋯, and offers Copy text, since its
	 * rows take no text selection.
	 */
	function actions(): { quick: MessageAction[]; items: MessageAction[]; more?: MessageAction[] } {
		const can = caps!;
		// One press reacts, as a chip does: pressed where the reaction is already yours (❤ and ❤️ are one).
		const bare = (emoji: string) => emoji.replace(/\uFE0F/g, '');
		const mine = new Set((view.reactions ?? []).filter((c) => c.mine).map((c) => bare(c.emoji)));
		const quick: MessageAction[] = can.react && !view.deleted
			? quickEmoji.map((emoji) => ({ id: `quick:${emoji}`, label: `React with ${emoji}`, title: emoji, glyph: emoji, pressed: mine.has(bare(emoji)), onclick: (event: MouseEvent) => {
				on.react?.(view, emoji);
				// On touch's menu, reacting is done with it, as a pick from the picker is.
				const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('.ap-msg');
				if (held && row) release(row);
			} }))
			: [];
		const unreplied: MessageAction | undefined = view.deleted && can.removeReply ? { id: 'unreply', label: 'Remove reply reference', title: 'Remove reply', glyph: 'Remove reply', icon: icons.unlink, onclick: () => on.removeReply?.(view) } : undefined;
		const reply: MessageAction | undefined = can.reply ? { id: 'reply', label: 'Reply to message', title: 'Reply', glyph: 'Reply', icon: icons.reply, key: 'R', onclick: () => on.reply?.(view) } : undefined;
		const react: MessageAction | undefined = can.react && !view.deleted
			? { id: 'react', label: 'React', title: 'React', icon: icons.smilePlus, popup: true, expanded: on.picking?.(view), attach: on.pickAnchor, onclick: (event) => on.pick?.(view, event.currentTarget as HTMLElement) }
			: undefined;
		const thread: MessageAction | undefined = can.startThread ? { id: 'thread', label: 'Start thread', title: 'Thread', glyph: 'Thread', icon: icons.thread, onclick: () => on.startThread?.(view) } : undefined;
		const edit: MessageAction | undefined = can.edit ? { id: 'edit', label: 'Edit message', title: 'Edit', glyph: 'Edit', icon: icons.pencil, key: 'E', onclick: () => ((held = false), on.edit?.(view)) } : undefined;
		const unreply: MessageAction | undefined = can.edit && !can.textOnly && view.reply ? { id: 'unreply', label: 'Remove reply reference', title: 'Remove reply', glyph: 'Remove reply', icon: icons.unlink, onclick: () => on.removeReply?.(view) } : undefined;
		const select: MessageAction | undefined = can.select ? { id: 'select', label: 'Select message', title: 'Select', glyph: 'Select', icon: icons.squareCheck, testid: testids?.select, onclick: () => ((held = false), on.beginSelect?.(view)) } : undefined;
		const copy: MessageAction | undefined = held && view.body && on.copyText ? { id: 'copy', label: 'Copy text', title: 'Copy text', glyph: 'Copy text', icon: icons.copy, done: { label: 'Text copied', glyph: 'Copied' }, onclick: () => on.copyText?.(view) } : undefined;
		const link: MessageAction | undefined = can.link ? { id: 'link', label: 'Copy link to message', title: 'Copy link', glyph: 'Copy link', icon: icons.link, done: { label: 'Link copied', glyph: 'Copied' }, onclick: () => on.copyLink?.(view) } : undefined;
		const remove: MessageAction | undefined = can.edit && !can.textOnly ? { id: 'delete', label: 'Delete message', title: 'Delete', glyph: 'Delete', icon: icons.trash, danger: true, onclick: () => on.delete?.(view) } : undefined;
		const present = (list: Array<MessageAction | undefined>) => list.filter((it): it is MessageAction => it !== undefined);
		if (held) {
			const front = present([react, reply]);
			const rest = present([unreplied, thread, edit, select, copy, link, unreply, remove]);
			return front.length ? { quick, items: front, more: rest } : { quick, items: rest };
		}
		const more = present([unreply, select, link, remove]);
		return { quick, items: present([unreplied, react, reply, thread, edit]), ...(more.length ? { more } : {}) };
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

	/**
	 * Keyboard, on a focused message: `x` picks it, the same as a shift-click; `r` replies to it and `e` edits it, as
	 * their buttons do, outside select mode; Escape puts touch's menu away, or leaves its toolbar for the row. Moving
	 * between messages is the timeline's (the page's `timelineKey`).
	 */
	function keydown(event: KeyboardEvent): void {
		// The keyboard on a row whose toolbar the pointer took elsewhere: it comes back, drawn now, for → to step into.
		if (!docked && showable) {
			readQuick();
			takeBar();
			if (docked) flushSync();
		}
		if (event.key === 'Escape' && held) {
			event.preventDefault();
			release(event.currentTarget as HTMLElement);
			return;
		}
		// Escape in its toolbar (gone into with Enter) gives the keyboard back to the row; an open menu's own Escape comes first.
		if (event.key === 'Escape' && !event.defaultPrevented && event.target !== event.currentTarget && (event.target as HTMLElement | null)?.closest?.('.ap-msg-actions')) {
			event.preventDefault();
			(event.currentTarget as HTMLElement).focus();
			return;
		}
		const key = event.key;
		if (event.metaKey || event.ctrlKey || event.altKey || (key !== 'x' && key !== 'r' && key !== 'e')) return;
		if ((event.target as HTMLElement | null)?.closest?.(FIELD)) return;
		if (key === 'x') {
			if (!view.caps?.select) return;
			event.preventDefault();
			if (view.selecting) on.select?.(view, false);
			else on.beginSelect?.(view);
			return;
		}
		if (view.selecting || view.editing) return;
		const action = key === 'r' ? (view.caps?.reply ? on.reply : undefined) : view.caps?.edit ? on.edit : undefined;
		if (!action) return;
		event.preventDefault();
		action(view);
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
		swallow = false;
		touch = event.pointerType === 'touch';
		if (!touch || held || !holdable(event.target)) return;
		const row = event.currentTarget as HTMLElement;
		const target = event.target;
		// Held where it still may open: the row may have gone into select mode or the editor meanwhile.
		pressed = longPress.start(event, () => {
			if (row.isConnected && !held && holdable(target)) hold(row);
		});
	}

	/** A finger that drifts is scrolling, not holding (`longPress`). */
	function pointermove(event: PointerEvent): void {
		longPress.move(event);
		// The row the pointer is on once another's picker or menu shuts: its toolbar, without leaving and coming back.
		if (wanting && event.pointerType === 'mouse') takeBar();
	}

	/** The finger lifted: this row's long press, if one is under way, doesn't fire. */
	function cancelPress(): void {
		longPress.cancel(pressed);
		pressed = undefined;
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
		readQuick();
		takeBar(true);
		swallow = true;
		row.focus({ preventScroll: true });
	}

	function engage(event: Event): void {
		readQuick();
		takeBar();
		if ((event as PointerEvent).pointerType === 'mouse') touch = false;
	}

	// What its body's decorations follow, each a value of its own: a new view with the same body (select mode, a
	// reaction) changes none of them, so the code blocks aren't decorated again.
	const bodyHtml = $derived(view.body?.html);
	const bodyCode = $derived(Boolean(view.body?.code));
	const bodyTasks = $derived(Boolean(view.body?.tasks));
	const notice = $derived(Boolean(view.system && view.scope));

	/** Its code blocks, decorated by `on.code` (a notice's get Copy buttons), again whenever the body changes. */
	function code(node: HTMLElement): void | (() => void) {
		void bodyHtml;
		return on.code?.(node, notice);
	}

	/**
	 * A message's body: its code blocks and its task list checkboxes, in one attachment, so a row with neither runs
	 * none. The checkboxes follow what may tick them in an effect of their own, so a change there (select mode, caps)
	 * leaves the code blocks as they are; both start over when the body does.
	 */
	function decorate(node: HTMLElement): (() => void) | void {
		const undo = bodyCode ? code(node) : undefined;
		if (bodyTasks) $effect(() => tasks(node));
		return typeof undo === 'function' ? undo : undefined;
	}

	/**
	 * Its task list checkboxes, rendered disabled: enabled where you may tick them (`caps.check`: yours, or one that
	 * shares its text with you, `ext:editors`) and `on.toggleTask` saves them, again whenever the body changes. A box that fails to save goes back as it was.
	 */
	function tasks(node: HTMLElement): void | (() => void) {
		void bodyHtml;
		const toggle = on.toggleTask;
		if (!toggle || !view.caps?.check || view.deleted || view.selecting) return;
		const boxes = node.querySelectorAll<HTMLInputElement>('input.ap-task');
		for (const box of boxes) box.disabled = false;
		const change = (event: Event): void => {
			const box = event.target as HTMLInputElement;
			if (!box.matches?.('input.ap-task')) return;
			const line = Number(box.dataset.taskLine);
			const checked = box.checked;
			if (!Number.isInteger(line)) return;
			// Its item looks done (or not) at once; the saved body, drawn again, says the same.
			const item = box.closest('.ap-task-item');
			item?.classList.toggle('ap-task-done', checked);
			void Promise.resolve(toggle(view, line, checked)).then((saved) => {
				if (saved || !box.isConnected || box.checked !== checked) return;
				box.checked = !checked;
				item?.classList.toggle('ap-task-done', !checked);
			});
		};
		node.addEventListener('change', change);
		return () => {
			node.removeEventListener('change', change);
			for (const box of boxes) box.disabled = true;
		};
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
				{#if view.body}<div class={['ap-msg-text', view.body.markdown ? 'ap-msg-markdown' : 'ap-msg-plain']} {@attach (view.body.code || view.body.tasks) && decorate}>{@html view.body.html}</div>{/if}
				<!-- Who else saved its text (`ext:editors`): never while its live text is still coming, which no one else may save over. -->
				{#if view.writing}<div class="ap-msg-writing" role="status" data-testid={testids?.writing}><TypingDots />Writing…</div>
				{:else if view.waiting}<div class="ap-msg-writing" role="status" data-testid={testids?.waiting}>Waiting to stream…</div>
				{:else if view.editedBy}<div class="ap-msg-edited" data-testid={testids?.editedBy}>edited by {view.editedBy}</div>{/if}
				{#if view.linkCards?.length}<div class="ap-msg-linkcards">{#each view.linkCards as card (card.href)}<LinkCard {card} data-testid={testids?.linkCard} />{/each}</div>{/if}
				{#if view.embeds?.length}<MessageEmbeds embeds={view.embeds} {embed} onremove={(item) => on.removeEmbed?.(view, item)} />{/if}
			{/if}
			{#if !view.deleted && view.reactions?.length}<ReactionBar reactions={view.reactions} disabled={!caps?.react} add={Boolean(on.pick) && !view.editing && !view.selecting} adding={on.picking?.(view)} addAnchor={on.pickAnchor} onopen={(anchor) => on.pick?.(view, anchor)} ontoggle={(emoji) => on.react?.(view, emoji)} onreactors={(emoji, chip) => on.reactors?.(view, emoji, chip)} data-testid={testids?.reactions} chipTestid={testids?.chip} />{/if}
		</div>
		{#if reached}<div class="ap-msg-dock" {@attach dockSlot}></div>{/if}
	</article>
{/if}
