<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import type { ClassValue } from 'svelte/elements';
	import Faces from './Faces.svelte';
	import type { Face } from './types';

	/**
	 * The start of a private room's timeline (§4.2.4), once its history reaches back to it: who is in it, and what
	 * private means: only members and the server host can read its messages, and only members can add others.
	 */
	interface Props {
		/** Its name: the room's title, or its other members' names. */
		name: string;
		/** Who it is with (Faces): one person, with their status, or two of a group. */
		faces?: Face[];
		/** One line under the name, such as a person's `@user_id` and bio. */
		detail?: string;
		/** Classes for its `<section>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for its `<section>`. */
		testid?: string;
	}
	let { name, faces = [], detail, class: className, testid }: Props = $props();
</script>

<section class={['ap-dmintro', className]} aria-label="About this private room" data-testid={testid}>
	<div class="ap-dmintro-who">
		<Faces people={faces} size="lg" />
		<div class="ap-dmintro-names">
			<h2 class="ap-dmintro-name">{name}</h2>
			{#if detail}<p class="ap-dmintro-detail">{detail}</p>{/if}
		</div>
	</div>
	<p class="ap-dmintro-text"><span class="ap-dmintro-private"><Lock size={13} aria-hidden="true" />Private room.</span> Only members and the server host can read messages here. Only members can add others.</p>
</section>
