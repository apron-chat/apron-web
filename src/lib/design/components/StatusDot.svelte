<script lang="ts">
	import type { Presence } from './types';
	import { presence, presenceLabel } from './util';

	interface Props {
		/**
		 * A user's `status` (§4.5) from the kept current object: `online`, `idle`, `dnd` or `offline`, or your own
		 * `invisible` (a hollow ring, as others see you). Any other value is unknown: a placeholder, a dashed ring, whose
		 * words carry the value. Absent or empty (no status) draws nothing.
		 */
		status?: Presence | (string & {});
		/** The avatar size it sits on: `sm` 20px, `md` 32px, `lg` 56px. */
		size?: 'sm' | 'md' | 'lg';
		/** Words for the tooltip and screen readers, instead of the status's own ("Invisible · others see you as offline"). */
		label?: string;
		/** Beside words that already say the status (or on an avatar the name follows): hidden from screen readers, tooltip kept. */
		decorative?: boolean;
	}
	let { status, size = 'md', label, decorative = false }: Props = $props();

	const shown = $derived(presence(status));
	const words = $derived(shown ? label || presenceLabel(status) || '' : '');
</script>

{#if shown}
	<!-- Shape and color both say the status: a dot, a crescent, a dot with a bar, a hollow ring (offline or invisible), a dashed ring (unknown). -->
	<span class="ap-presence ap-presence-{size} ap-presence-{shown}" title={words} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : words} aria-hidden={decorative ? 'true' : undefined}></span>
{/if}
