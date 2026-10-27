<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArchiveError, parseArchive, type Archive } from '$lib/archive/archive';
	import { ArchiveServer } from '$lib/archive/archive-server';
	import Button from '$lib/design/components/Button.svelte';
	import ConnectPage from '$lib/design/components/ConnectPage.svelte';
	import TypingDots from '$lib/design/components/TypingDots.svelte';
	import { keepSettingsInMemory } from '$lib/ui/storage';
	import AppPage from '../+page.svelte';

	// Before the app mounts, so nothing it saves while reading an export replaces the real settings.
	keepSettingsInMemory();

	/** The export being read, and the server in this page that serves it. */
	let reading = $state<{ archive: Archive; server: ArchiveServer } | undefined>();
	let error = $state('');
	let busy = $state(false);
	let input = $state<HTMLInputElement | undefined>();

	async function read(file: File | undefined): Promise<void> {
		if (!file || busy) return;
		busy = true;
		error = '';
		try {
			const archive = parseArchive(await file.text());
			reading = { archive, server: new ArchiveServer(archive) };
		} catch (cause) {
			error = cause instanceof ArchiveError ? cause.message : 'This file couldn’t be read.';
		} finally {
			busy = false;
		}
	}

	function dropped(event: DragEvent): void {
		event.preventDefault();
		void read(event.dataTransfer?.files[0]);
	}
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
	{#if !reading}<title>Read an export · Apron</title>{/if}
</svelte:head>

{#if reading}
	<AppPage webSocketFactory={reading.server.factory} archive={{ server: reading.archive.server, exportedAt: reading.archive.exportedAt }} />
{:else}
	<ConnectPage page>
		<!-- A file dropped anywhere on the card is read like one chosen. -->
		<form class="ap-connect-card" aria-label="Read an export" onsubmit={(event) => { event.preventDefault(); input?.click(); }} ondragover={(event) => event.preventDefault()} ondrop={dropped}>
			<h1 class="ap-connect-title">Apron</h1>
			<p class="ap-connect-tag">Read an export</p>
			<p class="ap-form-hint">Choose a .jsonl file saved from Preferences, under Export. Or drop it here. It opens in this tab, read-only, without signing in to its server.</p>
			<input bind:this={input} class="ap-sr" type="file" accept=".jsonl,.ndjson,application/jsonl,application/x-ndjson" tabindex="-1" aria-hidden="true" data-testid="archive-file"
				onchange={(event) => void read(event.currentTarget.files?.[0])} />
			{#if error}<p class="ap-form-note ap-tone-danger" role="alert">{error}</p>{/if}
			<div class="ap-connect-actions">
				{#if busy}<TypingDots />{/if}
				<Button variant="ghost" label="Back to Apron" onclick={() => window.location.assign(resolve('/'))} />
				<Button type="submit" variant="primary" disabled={busy} label="Choose a file…" />
			</div>
		</form>
	</ConnectPage>
{/if}
