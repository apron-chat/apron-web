<script lang="ts">
	import { directory } from '$lib/ui/directory.svelte';
	import { NARROW_MAX } from '$lib/ui/breakpoints';
	import { placePicker } from '$lib/ui/emoji';
	import { reactorsList } from '$lib/ui/reactors.svelte';
	import Avatar from './Avatar.svelte';

	/**
	 * Who reacted with an emoji, for the chip long-pressed or right-clicked:
	 * each person's avatar, name and `@user_id`, you first. Fixed to the
	 * viewport so the timeline never clips it: a popover beside the chip on
	 * wide screens, a bottom sheet on narrow ones.
	 */

	const WIDTH = 260;
	/** The list scrolls past this, so a crowd doesn't run off the screen. */
	const MAX_HEIGHT = 320;

	let box = $state<HTMLDivElement | undefined>();
	let measured = $state(0);
	/** Bumped on scroll and resize, so the popover follows its chip. */
	let reflowed = $state(0);

	let request = $derived(reactorsList.current);
	let reactors = $derived(request?.reactors() ?? []);
	let placement = $derived.by(() => {
		void reflowed;
		if (!request) return undefined;
		return placePicker(request.anchor.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, { width: WIDTH, height: measured || 120 });
	});
	let count = $derived(`${reactors.length} ${reactors.length === 1 ? 'reaction' : 'reactions'}`);
	let heading = $derived(request ? `${count} with ${request.emoji}` : '');

	// The last reaction taken back leaves nobody to list, and its chip goes with it.
	$effect(() => {
		if (request && reactors.length === 0) reactorsList.close();
	});

	// Focus moves in when it opens, so Escape and Tab work from the keyboard.
	$effect(() => {
		if (request && box) box.focus({ preventScroll: true });
	});

	// While open: follow the chip, and close on a press outside.
	$effect(() => {
		const current = request;
		if (!current) return;
		const outside = (event: PointerEvent) => {
			const path = event.composedPath();
			if ((box && path.includes(box)) || path.includes(current.anchor)) return;
			reactorsList.close();
		};
		const reflow = () => {
			if (!current.anchor.isConnected || (innerWidth < NARROW_MAX) !== (placement?.mode === 'sheet')) {
				reactorsList.close();
				return;
			}
			reflowed++;
		};
		document.addEventListener('pointerdown', outside, true);
		addEventListener('resize', reflow);
		addEventListener('scroll', reflow, true);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			removeEventListener('resize', reflow);
			removeEventListener('scroll', reflow, true);
		};
	});

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		reactorsList.close(true);
	}

	/** Tabbing out closes it, as a press outside does. */
	function focusout(event: FocusEvent): void {
		const next = event.relatedTarget;
		if (!(next instanceof Node) || !box || box.contains(next) || request?.anchor.contains(next)) return;
		reactorsList.close();
	}
</script>

{#if request && placement}
	<div
		class="reactors"
		class:sheet={placement.mode === 'sheet'}
		role="dialog"
		aria-label={heading}
		tabindex="-1"
		data-testid="reactors"
		style:top={placement.mode === 'popover' ? `${placement.top}px` : undefined}
		style:left={placement.mode === 'popover' ? `${placement.left}px` : undefined}
		style:width={placement.mode === 'popover' ? `${WIDTH}px` : undefined}
		bind:this={box}
		bind:offsetHeight={measured}
		onkeydown={keydown}
		onfocusout={focusout}
	>
		<div class="head"><span class="emoji" aria-hidden="true">{request.emoji}</span><span class="count">{count}</span></div>
		<ul class="list" style:max-height={`${MAX_HEIGHT}px`}>
			{#each reactors as user (user.user_id)}
				{@const id = directory.person(user)?.user_id ?? user.user_id}
				{@const name = directory.name(user)}
				<li class="row" data-testid="reactor" data-user-id={id}>
					<Avatar {name} {id} src={directory.avatar(user)} />
					<div class="names">
						<div class="name-line"><span class="name">{name}</span>{#if directory.isMe(id)}<span class="muted">(you)</span>{/if}</div>
						{#if id !== name || directory.sharesName(user)}<div class="muted handle">@{id}</div>{/if}
					</div>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	/* A popover: raised ground, hairline, popover shadow, large radius. */
	.reactors {
		position: fixed; z-index: var(--z-sheet); box-sizing: border-box; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3);
		background: var(--bg-200); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-popover);
		font-family: var(--font-sans); color: var(--ink);
	}
	.reactors:focus { outline: none; }
	/* Narrow screens: a bottom sheet, full width, rounded only where it meets the page. */
	.sheet { left: 0; right: 0; bottom: 0; border-bottom: 0; border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom)); }
	.head { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-ui); line-height: var(--leading-ui); color: var(--ink-muted); }
	.head .emoji { font-family: var(--font-emoji); font-size: var(--text-title); line-height: var(--leading-title); }
	.list { margin: 0; padding: 0; list-style: none; overflow-y: auto; overscroll-behavior: contain; }
	.row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; padding: var(--space-1) 0; font-size: var(--text-ui); line-height: var(--leading-ui); }
	.names { display: flex; flex-direction: column; min-width: 0; }
	.name-line { display: flex; align-items: baseline; gap: var(--space-1); min-width: 0; }
	.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
	.muted { flex: none; color: var(--ink-muted); }
	.handle { font-size: var(--text-sm); line-height: var(--leading-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
