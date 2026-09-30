<script lang="ts">
	/**
	 * A user's `roles` (§3.3): server-assigned labels, shown beside the name as
	 * badges and never as part of it. "admin" and "bot" have their own colors;
	 * other roles show as written. Roles grant nothing on the client.
	 */
	interface Props {
		roles?: string[];
	}
	let { roles = [] }: Props = $props();
	const shown = $derived([...new Set(roles.filter((role) => typeof role === 'string' && role.trim()))]);
</script>

{#if shown.length}
	<span class="ap-roles">{#each shown as role (role)}<span class={['ap-role', role === 'admin' && 'ap-role-admin', role === 'bot' && 'ap-role-bot']} title="Role: {role}">{role}</span>{/each}</span>
{/if}
