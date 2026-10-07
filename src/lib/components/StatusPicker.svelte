<script lang="ts">
	import { untrack } from 'svelte';
	import Callout from '$lib/design/components/Callout.svelte';
	import MenuButton from '$lib/design/components/MenuButton.svelte';
	import StatusDot from '$lib/design/components/StatusDot.svelte';
	import { OPTIONAL_STATUSES, STATUS_CHOICES, chosenStatusLabel, ownStatusLabel } from '$lib/ui/user-status';

	interface Props {
		/**
		 * Your `status` as `you` shows it (§4.5): the one you chose, or the one
		 * the server put in its place. Absent means the default, `online`.
		 */
		status?: string;
		/** Sets it with `me`; resolves with the `status` the server kept. */
		onchoose: (status: string) => Promise<string | undefined>;
		/**
		 * `server.status` (§3.1, §4.5): the optional statuses this server
		 * accepts, such as `dnd` and `invisible`. Absent: none.
		 */
		accepted?: readonly string[];
		/** The optional statuses this server answered something else for anyway: not offered again. */
		unsupported?: readonly string[];
		onunsupported?: (status: string) => void;
		/**
		 * Says what the server answered, when it isn't what was asked, in the
		 * dialog's one live region (undefined: nothing to say), since the
		 * callout comes and goes and wouldn't reliably be read as a live
		 * region itself.
		 */
		onannounce?: (text: string | undefined) => void;
		disabled?: boolean;
	}
	let { status, onchoose, accepted = [], unsupported = [], onunsupported, onannounce, disabled = false }: Props = $props();

	/** `""` (none) is a value too, so the picker keys it as `none`. */
	const NONE = 'none';
	const key = (value: string) => (value === '' ? NONE : value);
	const unkey = (value: string) => (value === NONE ? '' : value);

	let current = $derived(status ?? 'online');
	let known = $derived(STATUS_CHOICES.some((choice) => choice.value === current));
	/**
	 * Online and None always; Do not disturb and Invisible where `server.status`
	 * lists them, until this server answers something else for one. The current
	 * status stays listed, so it shows as checked.
	 */
	let offered = (value: string) => !OPTIONAL_STATUSES.includes(value) || (accepted.includes(value) && !unsupported.includes(value));
	let choices = $derived(STATUS_CHOICES.filter((choice) => offered(choice.value) || choice.value === current).map((choice) => ({ value: key(choice.value), label: choice.label, hint: choice.hint })));
	let busy = $state(false);
	/** What the server answered for the last choice, when it isn't what was asked. */
	let answer = $state<{ asked: string; kept: string | undefined } | { asked: string; error: string } | undefined>();
	/** The answer in words: the callout's title and text, which the live region says too. */
	let answered = $derived.by(() => {
		if (!answer) return undefined;
		if ('error' in answer) return { title: 'Your status didn’t change', text: `The server declined ${chosenStatusLabel(answer.asked)}${answer.error ? ` (${answer.error})` : ''}.` };
		return {
			title: OPTIONAL_STATUSES.includes(answer.asked) ? `This server doesn’t offer ${chosenStatusLabel(answer.asked)}` : 'The server chose another status',
			text: `Your status is ${answer.kept === undefined ? 'unchanged' : chosenStatusLabel(answer.kept)}.`
		};
	});
	$effect(() => {
		const text = answered ? `${answered.title}. ${answered.text}` : undefined;
		untrack(() => onannounce?.(text));
	});

	let hint = $derived.by(() => {
		if (!known) return `Set by the server. Choose another to replace it.`;
		switch (current) {
			case 'dnd': return 'Others see Do not disturb while you’re connected, and offline otherwise. Your notifications are silenced.';
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
			<strong>Status</strong>
			<p class="ap-profedit-hint" data-testid="status-hint">{hint}</p>
		</div>
		<span class="ap-status-pick-action">
			<span class="ap-status-pick-dot"><StatusDot status={current} label={ownStatusLabel(current)} decorative /></span>
			<MenuButton
				label={busy ? 'Saving…' : known ? chosenStatusLabel(current) : `“${current}”`}
				ariaLabel={`Status: ${known ? chosenStatusLabel(current) : current}`}
				selected={known ? key(current) : undefined}
				{choices}
				{disabled}
				{busy}
				onselect={(value) => void choose(value)}
			>
				{#snippet lead(value)}
					<StatusDot status={unkey(value)} decorative />
				{/snippet}
			</MenuButton>
		</span>
	</div>
	{#if answered}
		<div class="ap-status-pick-answer">
			<Callout title={answered.title}>
				<p>{answered.text}</p>
			</Callout>
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
