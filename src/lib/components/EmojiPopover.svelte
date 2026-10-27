<script lang="ts">
	import { untrack } from 'svelte';
	import { NARROW_MAX } from '$lib/ui/breakpoints';
	import { currentTheme, pickerColors, placePicker } from '$lib/ui/emoji';
	import { emojiPicker, loadEmojiMart } from '$lib/ui/emoji-picker.svelte';
	import { customEmoji } from '$lib/ui/custom-emoji.svelte';
	import { pickerCategories } from '$lib/ui/emoji';
	import EmojiPopover from '$lib/design/components/EmojiPopover.svelte';

	/**
	 * The one full emoji picker (emoji-mart), drawn for whichever trigger opened
	 * it, in the design system's EmojiPopover. It lives outside the app shell
	 * and is fixed to the viewport, so the timeline's overflow and containment
	 * never clip it: a popover beside the
	 * trigger on wide screens, a bottom sheet on narrow ones. emoji-mart and its
	 * data load the first time it opens, from this app's origin: it gets its
	 * data, strings and native glyphs passed in, so it fetches nothing. The
	 * server's custom emoji (`ext:emoji`) come first, in their categories,
	 * once their catalog has arrived; picking one picks its key.
	 */

	type PickerElement = HTMLElement & { update: (props: Record<string, unknown>) => void };

	let box = $state<HTMLDivElement | undefined>();
	let mount = $state<HTMLDivElement | undefined>();
	let status = $state<'loading' | 'ready' | 'failed'>('loading');
	/** Bumped on scroll and resize, so the popover follows its trigger. */
	let reflowed = $state(0);

	let request = $derived(emojiPicker.current);
	let placement = $derived.by(() => {
		void reflowed;
		return request ? placePicker(request.anchor.getBoundingClientRect(), { width: innerWidth, height: innerHeight }) : undefined;
	});

	function theme(): 'light' | 'dark' {
		return currentTheme(document.documentElement.dataset.theme, matchMedia('(prefers-color-scheme: light)').matches);
	}

	/** emoji-mart's `--rgb-*` colors from the app's tokens, for the current theme. */
	function paint(picker: HTMLElement): void {
		const style = getComputedStyle(document.documentElement);
		for (const [property, value] of Object.entries(pickerColors((token) => style.getPropertyValue(token)))) picker.style.setProperty(property, value);
	}

	// Opening the picker is when the server's custom emoji are first needed.
	$effect(() => {
		if (request) customEmoji.need();
	});

	/** The custom emoji the picker offers (none `hidden`), in emoji-mart's categories, and the key each of its IDs picks. */
	let custom = $derived(pickerCategories(customEmoji.catalog, (emoji) => customEmoji.image(emoji).src));

	// Builds the picker for each request, once emoji-mart has loaded, and again when the custom emoji arrive.
	$effect(() => {
		const current = request;
		const target = mount;
		const offered = custom;
		if (!current || !target) return;
		const sheet = untrack(() => placement?.mode === 'sheet');
		let cancelled = false;
		let picker: PickerElement | undefined;
		status = 'loading';
		// Focus moves in at once, so Escape works while it loads; emoji-mart then focuses its search.
		untrack(() => box)?.focus({ preventScroll: true });
		loadEmojiMart().then(
			({ Picker, data, i18n }) => {
				if (cancelled) return;
				picker = new Picker({
					data,
					i18n,
					locale: 'en',
					// System glyphs: no spritesheet or image, and the URL hooks answer nothing should one be asked for.
					set: 'native',
					getImageURL: () => '',
					getSpritesheetURL: () => '',
					theme: theme(),
					previewPosition: 'none',
					skinTonePosition: 'search',
					searchPosition: 'sticky',
					navPosition: 'top',
					perLine: 9,
					maxFrequentRows: 2,
					dynamicWidth: sheet,
					// A touch keyboard would cover the sheet; there, search is a tap away.
					autoFocus: !matchMedia('(pointer: coarse)').matches,
					// emoji-mart lists custom categories after its own, and takes any it had before away first.
					custom: offered.categories,
					onEmojiSelect: (emoji: { native?: string; id?: string }) => {
						const key = emoji.id === undefined ? undefined : offered.keys.get(emoji.id);
						if (key) emojiPicker.pick(key);
						else if (emoji.native) emojiPicker.pick(emoji.native);
					}
				}) as unknown as PickerElement;
				paint(picker);
				target.replaceChildren(picker);
				status = 'ready';
			},
			() => {
				if (!cancelled) status = 'failed';
			}
		);
		return () => {
			cancelled = true;
			picker?.remove();
		};
	});

	// While open: follow the trigger, close on a press outside, and follow the system theme.
	$effect(() => {
		const current = request;
		if (!current) return;
		const outside = (event: PointerEvent) => {
			const path = event.composedPath();
			if ((box && path.includes(box)) || path.includes(current.anchor)) return;
			emojiPicker.close();
		};
		const reflow = () => {
			// The trigger left the page, or the layout switched between popover and sheet: start over.
			if (!current.anchor.isConnected || (innerWidth < NARROW_MAX) !== (placement?.mode === 'sheet')) {
				emojiPicker.close();
				return;
			}
			reflowed++;
		};
		const scheme = matchMedia('(prefers-color-scheme: light)');
		const repaint = () => {
			const picker = mount?.firstElementChild as PickerElement | null | undefined;
			if (!picker?.update) return;
			picker.update({ theme: theme() });
			paint(picker);
		};
		document.addEventListener('pointerdown', outside, true);
		addEventListener('resize', reflow);
		addEventListener('scroll', reflow, true);
		scheme.addEventListener('change', repaint);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			removeEventListener('resize', reflow);
			removeEventListener('scroll', reflow, true);
			scheme.removeEventListener('change', repaint);
		};
	});

	/**
	 * Escape closes the picker, back on its trigger. It listens on the way in:
	 * emoji-mart's search field swallows its keys. Escape in the skin tone
	 * menu is left to close just that menu.
	 */
	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		if (event.composedPath().some((node) => node instanceof Element && node.classList.contains('menu'))) return;
		event.preventDefault();
		event.stopPropagation();
		emojiPicker.close(true);
	}

	/** Tabbing out of the picker closes it, as a press outside does. */
	function focusout(event: FocusEvent): void {
		const next = event.relatedTarget;
		if (!(next instanceof Node) || !box || box.contains(next) || request?.anchor.contains(next)) return;
		emojiPicker.close();
	}
</script>

{#if request && placement}
	<EmojiPopover
		mode={placement.mode}
		top={placement.mode === 'popover' ? placement.top : undefined}
		left={placement.mode === 'popover' ? placement.left : undefined}
		width={placement.mode === 'popover' ? placement.width : undefined}
		height={placement.height}
		caption={request.caption}
		{status}
		testid="emoji-picker"
		bind:element={box}
		bind:mount
		onkeydowncapture={keydown}
		onfocusout={focusout}
	/>
{/if}
