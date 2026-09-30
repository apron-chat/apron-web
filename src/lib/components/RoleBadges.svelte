<script lang="ts">
	import type { Identity } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';

	/**
	 * A user's `roles` (PROTOCOL.md §3.3) as the design system's badges, from
	 * the kept user object (else the recorded one): beside the name, never part
	 * of it, so no display name can pass as a role. They grant nothing here.
	 */
	let { user }: { user: Identity | undefined } = $props();
	let roles = $derived.by(() => {
		const listed = directory.person(user)?.roles;
		return Array.isArray(listed) ? [...new Set(listed.filter((role): role is string => typeof role === 'string' && role.trim() !== ''))] : [];
	});
</script>

{#if roles.length}
	<span class="ap-roles" data-testid="roles">{#each roles as role (role)}<span class="ap-role" class:ap-role-admin={role === 'admin'} class:ap-role-bot={role === 'bot'} title="Role: {role}">{role}</span>{/each}</span>
{/if}
