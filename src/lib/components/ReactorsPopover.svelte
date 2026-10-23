<script lang="ts">
	import { directory } from '$lib/ui/directory.svelte';
	import { NARROW_MAX } from '$lib/ui/breakpoints';
	import { placePicker } from '$lib/ui/emoji';
	import { reactorsList } from '$lib/ui/reactors.svelte';
	import ReactorsPopover from '$lib/design/components/ReactorsPopover.svelte';
	import type { Reactor } from '$lib/design/components/types';
	import Avatar from '$lib/design/components/Avatar.svelte';
	import { hueOf } from '$lib/ui/messages';

	/**
	 * Who reacted with an emoji, for the chip long-pressed or right-clicked:
	 * the design system's ReactorsPopover, each person's avatar, name and
	 * `@user_id` from the directory, you first. Fixed to the viewport so the
	 * timeline never clips it: a popover beside the chip on wide screens, a
	 * bottom sheet on narrow ones.
	 */

	const WIDTH = 260;

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
	/** Each by the name they show as, with `@user_id` under it only where another user shares the name. */
	let rows = $derived(
		reactors.map((user): Reactor => {
			const id = directory.person(user)?.user_id ?? user.user_id;
			const name = directory.name(user);
			return { user_id: id, name, avatar: directory.avatar(user), you: directory.isMe(id), handle: directory.sharesName(user) };
		})
	);

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
	<ReactorsPopover
		mode={placement.mode}
		top={placement.mode === 'popover' ? placement.top : undefined}
		left={placement.mode === 'popover' ? placement.left : undefined}
		width={placement.mode === 'popover' ? WIDTH : undefined}
		emoji={request.emoji}
		reactors={rows}
		data-testid="reactors"
		rowTestid="reactor"
		bind:element={box}
		bind:offsetHeight={measured}
		onkeydown={keydown}
		onfocusout={focusout}
	>
		{#snippet avatar(reactor)}<Avatar name={reactor.name ?? reactor.user_id} hue={hueOf(reactor.user_id)} src={reactor.avatar} />{/snippet}
	</ReactorsPopover>
{/if}
