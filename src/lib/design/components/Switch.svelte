<script lang="ts">
	interface Props {
		checked: boolean;
		/** What it turns on, for screen readers: the visible title beside it. */
		label: string;
		/** It can't change now: it stays focusable (`aria-disabled`), and `describedby` should say why. */
		locked?: boolean;
		/** The id of the note that explains it. */
		describedby?: string;
		/** Called with the value asked for; the owner decides whether `checked` follows. */
		onchange: (checked: boolean) => void;
	}
	let { checked, label, locked = false, describedby, onchange }: Props = $props();
</script>

<button class="ap-switch" type="button" role="switch" aria-checked={checked} aria-label={label} aria-disabled={locked || undefined} aria-describedby={describedby} onclick={() => { if (!locked) onchange(!checked); }}><span></span></button>
