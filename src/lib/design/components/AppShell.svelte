<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		/** The BackendRail, in a column of its own at the left; omit it for one backend. Hidden under 720px. */
		rail?: Snippet;
		/** The rooms list: an `<aside class="ap-shell-side">` holding an `ap-shell-sidehead`, an `ap-shell-sidebody` and a ProfileBar. */
		side?: Snippet;
		/** The main pane's contents: a RoomHeader, the `ap-timeline`, a TypingIndicator, the Composer. */
		main?: Snippet;
		/** Names the main pane's `<main>` (its `aria-label`), such as "Conversation". */
		mainLabel?: string;
		/** An attachment for the main pane's `<main>`, such as one taking files dropped on it. */
		mainAttach?: Attachment<HTMLElement>;
		/** The MemberList: a column of its own with `membersWide`, else over the conversation, sliding in from the inline end (the right, or the left under `dir="rtl"`). */
		members?: Snippet;
		/** The rooms list's <PanelToggle>, at its inner edge: at the end of its header, or the start of the room's once it's shut, which keep clear of it. */
		sideToggle?: Snippet;
		/** The rooms list's <PanelHandle>, on its inner border (mirrored under `dir="rtl"`). */
		sideHandle?: Snippet;
		/** The member list's <PanelToggle>, at its inner edge: at the start of its header, or the end of the room's once it's shut; only with `membersWide`, since the room header toggles the overlay. */
		membersToggle?: Snippet;
		/** The member list's <PanelHandle>, on its inner border; only with `membersWide`. */
		membersHandle?: Snippet;
		/**
		 * An offer over the rooms list's foot, such as a <Nudge pointer> pointing at the gear that changes it later.
		 * It shows from 720px while the rooms list is open; put the same offer in an `ap-shell-nudge-inline` in the
		 * main pane, which shows otherwise.
		 */
		nudge?: Snippet;
		/** After the panels: dialogs, popovers, toasts. */
		children?: Snippet;
		/** The rooms list is shut: its column goes to nothing as it fades. */
		sideCollapsed?: boolean;
		/** The member list is showing. */
		membersOpen?: boolean;
		/** The member list has a column of its own (960px and up) rather than overlaying the conversation. */
		membersWide?: boolean;
		/** Under 720px one pane shows at a time: the rooms list, or the main pane. */
		pane?: 'rooms' | 'main';
		/**
		 * While the rooms list shows under 720px (`pane="rooms"`; set it only then, as the conversation goes inert), the room
		 * or thread it opened over: a sliver of it stays in view at the inline end, faded, and a tap there returns to it
		 * (`onpeek`). It's a reach-friendly twin of the list's own way back, so it is left out of the keyboard's and screen
		 * readers' way.
		 */
		peek?: boolean;
		/** Called when the conversation's sliver is tapped, or the rooms list swiped toward its far side (`peek`). */
		onpeek?: () => void;
		/** The rooms list's width while open, in px, such as dragged to; omit for `--sidebar-w`. */
		sideWidth?: number;
		/** The member list's width, in px; omit for `--member-list-w`. */
		membersWidth?: number;
		/** A panel's border is being dragged: the panels follow the pointer instead of sliding, and no text is selected. */
		resizing?: boolean;
		/**
		 * The panels slide as they open and shut (`--duration-slide`, `--ease-slide`): their columns move, and each one's
		 * contents keep their width against its inner edge, riding the moving border rather than squeezing, and fade.
		 * Turn it on once the page is up, so the layout it starts with doesn't animate in.
		 */
		slides?: boolean;
		/**
		 * Fill the window, rather than the parent. While an on-screen keyboard is up (`data-keyboard` on the root, with
		 * `--app-height` and `--app-top`), it fills the part above it instead: fixed there, its header at the top and the
		 * composer on the keyboard, rather than the browser panning the page up under the status bar.
		 */
		viewport?: boolean;
		/** Classes for the shell's grid, added to its own. */
		class?: ClassValue;
	}
	let {
		rail, side, main, mainLabel, mainAttach, members, sideToggle, sideHandle, membersToggle, membersHandle, nudge, children,
		sideCollapsed = false, membersOpen = false, membersWide = false, pane, peek = false, onpeek, sideWidth, membersWidth, resizing = false, slides = false, viewport = false,
		class: className
	}: Props = $props();

	/** The rooms list shows over a conversation whose sliver is in view. */
	const peeking = $derived(peek && pane === 'rooms' && Boolean(onpeek));

	/**
	 * A swipe across the rooms list toward the side away from the sliver (the left, or the right under `dir="rtl"`)
	 * returns to the conversation too: mostly sideways, and moving before a hold could lift a room to drag (its 350ms).
	 */
	const SWIPE_PX = 50;
	const SWIPE_HOLD_MS = 300;
	let swipe: { x: number; y: number; at: number; moved: boolean } | undefined;
	function swipeStart(event: TouchEvent): void {
		const target = event.target as Element;
		const touch = event.touches[0];
		swipe = peeking && event.touches.length === 1 && target.closest('.ap-shell-side') && !target.closest('[role="dialog"]')
			? { x: touch.clientX, y: touch.clientY, at: event.timeStamp, moved: false }
			: undefined;
	}
	function swipeMove(event: TouchEvent): void {
		if (!swipe || swipe.moved) return;
		const touch = event.touches[0];
		if (Math.hypot(touch.clientX - swipe.x, touch.clientY - swipe.y) < 10) return;
		swipe.moved = true;
		// Held still first: a room lifting to be dragged, not a swipe.
		if (event.timeStamp - swipe.at > SWIPE_HOLD_MS) swipe = undefined;
	}
	function swipeEnd(event: TouchEvent): void {
		const start = swipe;
		swipe = undefined;
		if (!start?.moved || event.type === 'touchcancel') return;
		const touch = event.changedTouches[0];
		const away = (start.x - touch.clientX) * (getComputedStyle(event.currentTarget as Element).direction === 'rtl' ? -1 : 1);
		if (away >= SWIPE_PX && away > 2 * Math.abs(touch.clientY - start.y)) onpeek?.();
	}
	/** The swipe's listeners, passive (it never stops a scroll): a touch shortcut beside the list's own › and the sliver. */
	const swipeBack: Attachment<HTMLElement> = (shell) => {
		const options = { passive: true };
		shell.addEventListener('touchstart', swipeStart, options);
		shell.addEventListener('touchmove', swipeMove, options);
		shell.addEventListener('touchend', swipeEnd, options);
		shell.addEventListener('touchcancel', swipeEnd, options);
		return () => {
			shell.removeEventListener('touchstart', swipeStart);
			shell.removeEventListener('touchmove', swipeMove);
			shell.removeEventListener('touchend', swipeEnd);
			shell.removeEventListener('touchcancel', swipeEnd);
		};
	};

	const px = (n: number | undefined) => (n === undefined ? undefined : `${n}px`);
	/** The member list's column: nothing while it's shut or overlaid, kept at 0 so it can slide. */
	const membersTrack = $derived(membersWide && membersOpen ? (px(membersWidth) ?? 'var(--member-list-w)') : '0px');
	/** The shell's own custom properties. */
	const shellStyle = $derived([
		['--side-col', sideCollapsed ? '0px' : px(sideWidth)], ['--rooms-w', px(sideWidth)], ['--member-list-w', px(membersWidth)], ['--member-list-track', membersTrack]
	].filter(([, value]) => value !== undefined).map(([name, value]) => `${name}: ${value}`).join('; ') || undefined);
</script>

<div
	data-pane={pane}
	class={[
		'ap-shell', !rail && 'ap-shell-norail', viewport && 'ap-shell-viewport', slides && 'ap-shell-slides', sideCollapsed && 'ap-shell-side-shut',
		resizing && 'ap-shell-resizing', membersOpen && 'ap-shell-members-open', membersWide && 'ap-shell-members-wide',
		peeking && 'ap-shell-peeking', sideToggle && 'ap-shell-side-toggle', membersToggle && 'ap-shell-members-toggle', className
	]}
	style={shellStyle}
	{@attach swipeBack}
>
	{@render rail?.()}
	{@render sideToggle?.()}
	{@render side?.()}
	{@render sideHandle?.()}
	{#if nudge}<div class="ap-shell-nudge" aria-live="polite">{@render nudge()}</div>{/if}
	{#if main}<main aria-label={mainLabel} class="ap-shell-main" inert={peeking} {@attach mainAttach}>{@render main()}</main>{/if}
	<!-- A pointer's way back alone: the rooms list's › is the keyboard's and screen readers'. -->
	{#if peeking}<button type="button" class="ap-shell-peek" tabindex="-1" aria-hidden="true" onclick={onpeek}></button>{/if}
	{@render membersToggle?.()}
	{@render members?.()}
	{@render membersHandle?.()}
	{@render children?.()}
</div>
