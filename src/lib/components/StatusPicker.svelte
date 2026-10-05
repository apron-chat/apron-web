<script lang="ts">
	import Callout from '$lib/design/components/Callout.svelte';
	import MenuButton from '$lib/design/components/MenuButton.svelte';
	import StatusDot from '$lib/design/components/StatusDot.svelte';
	import { OPTIONAL_STATUSES, STATUS_CHOICES, chosenStatusLabel, ownStatusLabel } from '$lib/ui/user-status';

	interface Props {
		/**
		 * Your `status` as `you` shows it (§4.11): the one you chose, or the one
		 * the server put in its place. Absent means the default, `online`.
		 */
		status?: string;
		/** Sets it with `me`; resolves with the `status` the server kept. */
		onchoose: (status: string) => Promise<string | undefined>;
		/** The optional statuses this server answered something else for: not offered again. */
		unsupported?: readonly string[];
		onunsupported?: (status: string) => void;
		disabled?: boolean;
	}
	let { status, onchoose, unsupported = [], onunsupported, disabled = false }: Props = $props();

	/** `""` (none) is a value too, so the picker keys it as `none`. */
	const NONE = 'none';
	const key = (value: string) => (value === '' ? NONE : value);
	const unkey = (value: string) => (value === NONE ? '' : value);

	let current = $derived(status ?? 'online');
	let known = $derived(STATUS_CHOICES.some((choice) => choice.value === current));
	/** Online and None always; Do not disturb and Invisible until this server answers something else for one. */
	let choices = $derived(STATUS_CHOICES.filter((choice) => !unsupported.includes(choice.value) || choice.value === current).map((choice) => ({ value: key(choice.value), label: choice.label, hint: choice.hint })));
	let busy = $state(false);
	/** What the server answered for the last choice, when it isn't what was asked. */
	let answer = $state<{ asked: string; kept: string | undefined } | { asked: string; error: string } | undefined>();

	let hint = $derived.by(() => {
		if (!known) return `Set by the server. Choose another to replace it.`;
		switch (current) {
			case 'dnd': return 'Others see Do not disturb. Your notifications are silenced.';
			case 'invisible': return 'Others see you as offline.';
			case '': return 'Others see no status.';
			default: return 'Others see you online, idle or offline, as you come and go.';
		}
	});

	async function choose(value: string): Promise<void> {
		const asked = unkey(value);
		if (asked === current && !answer) return;
		busy = true;
		answer = undefined;
		try {
			const kept = await onchoose(asked);
			if ((kept ?? 'online') !== asked) {
				answer = { asked, kept };
				if (OPTIONAL_STATUSES.includes(asked)) onunsupported?.(asked);
			}
		} catch (cause) {
			answer = { asked, error: cause instanceof Error ? cause.message : '' };
		} finally {
			busy = false;
		}
	}
</script>

<div class="ap-status-pick">
	<div class="ap-status-pick-row">
		<div>
			<strong id="ap-status-pick-title">Status</strong>
			<p class="ap-profedit-hint" data-testid="status-hint">{hint}</p>
		</div>
		<span class="ap-status-pick-action">
			<span class="ap-status-pick-dot"><StatusDot status={current} label={ownStatusLabel(current)} decorative /></span>
			<MenuButton
				label={busy ? 'Saving…' : known ? chosenStatusLabel(current) : `“${current}”`}
				ariaLabel={`Status: ${known ? chosenStatusLabel(current) : current}`}
				selected={known ? key(current) : undefined}
				{choices}
				disabled={disabled || busy}
				onselect={(value) => void choose(value)}
			>
				{#snippet lead(value)}
					<StatusDot status={unkey(value)} decorative />
				{/snippet}
			</MenuButton>
		</span>
	</div>
	{#if answer}
		<div class="ap-status-pick-answer" role="status">
			{#if 'error' in answer}
				<Callout title="Your status didn’t change">
					<p>The server declined {chosenStatusLabel(answer.asked)}{answer.error ? ` (${answer.error})` : ''}.</p>
				</Callout>
			{:else}
				<Callout title={OPTIONAL_STATUSES.includes(answer.asked) ? `This server doesn’t offer ${chosenStatusLabel(answer.asked)}` : 'The server chose another status'}>
					<p>Your status is {answer.kept === undefined ? 'unchanged' : chosenStatusLabel(answer.kept)}.</p>
				</Callout>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* A row of the Preferences dialog, as Pause notifications is. */
	.ap-status-pick { padding: var(--space-4) 0; border-bottom: 1px solid var(--line); }
	.ap-status-pick-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
	.ap-status-pick strong { font-size: 14px; }
	.ap-status-pick p { max-width: 420px; margin: var(--space-1) 0 0; }
	.ap-status-pick-action { flex: none; display: inline-flex; align-items: center; gap: var(--space-2); }
	.ap-status-pick-dot { display: inline-grid; place-items: center; width: 12px; }
	.ap-status-pick-answer { max-width: 460px; margin-top: var(--space-3); }
</style>
