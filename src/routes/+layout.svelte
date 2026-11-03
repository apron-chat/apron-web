<script lang="ts">
	import { onMount } from 'svelte';
	import { appearanceSettings } from '$lib/ui/appearance.svelte';
	import { prefetchLazy } from '$lib/ui/lazy.svelte';
	import { startupMark } from '$lib/startup-marks';
	import '$lib/design/tokens.css';
	import '$lib/design/apron.css';
	import '$lib/design/fonts.css';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { emojiPopover, mediaViewerHost } from '$lib/components/overlays-lazy';
	import { emojiPicker } from '$lib/ui/emoji-picker.svelte';
	import { mediaViewer } from '$lib/ui/media-viewer.svelte';
	import TerminalViewerHost from '$lib/components/TerminalViewerHost.svelte';
	import UpdateNotice from '$lib/components/UpdateNotice.svelte';

	let { children } = $props();

	// The app's code has loaded and started (`$lib/startup-marks`).
	startupMark('app');

	onMount(() => {
		appearanceSettings.load();
		// What the page renders only on demand (dialogs, editors) loads apart from it, in the background once it settles.
		prefetchLazy();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
<!-- The one full emoji picker, outside the shell so nothing in it clips the popover. This and the image viewer load on
     demand (`overlays.ts`) and mount once first opened: the state that opens them is here from the start. -->
{#if emojiPopover.once(Boolean(emojiPicker.current), () => emojiPicker.close())}{@const EmojiPopover = emojiPopover.component!}<EmojiPopover />{/if}
<!-- The one image viewer, full screen over everything. -->
{#if mediaViewerHost.once(mediaViewer.open, () => mediaViewer.closed())}{@const MediaViewerHost = mediaViewerHost.component!}<MediaViewerHost />{/if}
<!-- The one terminal viewer, a terminal embed full screen. -->
<TerminalViewerHost />
<UpdateNotice />
