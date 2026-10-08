<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Shown as a modal while true; bindable, and set false however it closes (Escape, the close button, the backdrop). */
		open?: boolean;
		title: string;
		/** One line under the title. */
		subtitle?: string;
		/** `sm` for a short question, `md` for a form with room to write (RoomForm), `lg` for a settings panel of fixed height. */
		size?: 'sm' | 'md' | 'lg';
		/** Words for the close button. */
		closeLabel?: string;
		/** Working, such as a request in flight: Escape, the close button and the backdrop do nothing. */
		locked?: boolean;
		/** A click on the backdrop closes it, as the close button does. */
		backdropCloses?: boolean;
		/** The body and footer are a form, and this handles its submit. */
		onsubmit?: (event: SubmitEvent) => void;
		/** It closed, whichever way. */
		onclose?: () => void;
		/** The content. Padded, unless `flush`. */
		children: Snippet;
		/** Actions at the end, such as Cancel and a primary button. */
		footer?: Snippet;
		/** The body without padding, for content that lays itself out (a section nav beside a pane). */
		flush?: boolean;
		testid?: string;
	}
	let { open = $bindable(false), title, subtitle, size = 'sm', closeLabel = 'Close', locked = false, backdropCloses = false, onsubmit, onclose, children, footer, flush = false, testid }: Props = $props();

	let dialog = $state<HTMLDialogElement | undefined>();
	const uid = $props.id();
	const titleId = `${uid}-title`;

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	function closed(): void {
		open = false;
		onclose?.();
	}

	function cancel(event: Event): void {
		if (locked) event.preventDefault();
	}

	/** Whether the press started on the backdrop, so a selection dragged out of the panel doesn't close it. */
	let pressedBackdrop = false;

	/** The panel's content fills the dialog, so only the backdrop targets the dialog itself. */
	function click(event: MouseEvent): void {
		if (backdropCloses && !locked && event.target === dialog && pressedBackdrop) dialog?.close();
		pressedBackdrop = false;
	}
</script>

<dialog bind:this={dialog} class={['ap-dialog', 'ap-dialog-' + size]} aria-labelledby={titleId} data-testid={testid} oncancel={cancel} onclose={closed} onpointerdown={(event) => (pressedBackdrop = event.target === dialog)} onclick={click}>
	<svelte:element this={onsubmit ? 'form' : 'div'} class="ap-dialog-frame" role={onsubmit ? undefined : 'presentation'} {onsubmit}>
		<header class="ap-dialog-head">
			<div class="ap-dialog-heading">
				<h2 class="ap-dialog-title" id={titleId}>{title}</h2>
				{#if subtitle}<p class="ap-dialog-sub">{subtitle}</p>{/if}
			</div>
			<button class="ap-iconbtn ap-dialog-close" type="button" aria-label={closeLabel} disabled={locked} onclick={() => dialog?.close()}>
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
			</button>
		</header>
		<div class={['ap-dialog-body', flush && 'ap-dialog-body-flush']}>{@render children()}</div>
		{#if footer}<div class="ap-dialog-foot">{@render footer()}</div>{/if}
	</svelte:element>
</dialog>
