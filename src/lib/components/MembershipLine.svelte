<script lang="ts">
	import type { Identity } from '$lib/protocol/types';
	import SystemLine from '$lib/design/components/SystemLine.svelte';
	import { directory } from '$lib/ui/directory.svelte';
	import { membershipSummary } from '$lib/ui/membership';
	import { idMillis } from '$lib/ui/time';

	/**
	 * Who joined and left the room between two other timeline items
	 * (PROTOCOL.md §4.2.2), netted out, with those you added said so: "You added
	 * Dee · Ada and Bob joined · Carol left". The
	 * quietest system line: no avatar, no actions, and its time only on hover.
	 */
	let { joined, left, added = [], logId }: { joined: Identity[]; left: Identity[]; added?: Identity[]; logId: string } = $props();

	/** A user as every other row renders them (§3.3), with the handle when someone else shows under the same name. */
	function label(user: Identity): string {
		const name = directory.name(user);
		return directory.sharesName(user) ? `${name} (@${directory.person(user)?.user_id ?? user.user_id})` : name;
	}

	let summary = $derived(membershipSummary(joined.map(label), left.map(label), added.map(label)));
</script>

<SystemLine quiet text={summary.text} timestamp={idMillis(logId)} timelineItem testid="membership-line" {logId} title={summary.title} />
