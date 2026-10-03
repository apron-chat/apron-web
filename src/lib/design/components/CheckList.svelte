<script lang="ts">
	/** One option of a CheckList: its value, a title, and optionally a line saying what it does (without one, the row is a single line). */
	interface CheckOption {
		value: string;
		title: string;
		text?: string;
		/** Can't be changed here; `note` can say why. */
		disabled?: boolean;
		/** A short muted note beside the title, such as why it is disabled, or "Desktop only". */
		note?: string;
	}

	interface Props {
		/** Names the group (its legend). */
		label: string;
		options: CheckOption[];
		/** The checked values. */
		value?: string[];
		/** Keeps at least this many checked: the last ones can't be unchecked. */
		min?: number;
		/** Disables every option. */
		disabled?: boolean;
		/** Called with the new checked values, in the options' order. */
		onchange?: (value: string[]) => void;
		/** Says why the last checked ones can't be unchecked (read to screen readers). */
		minNote?: string;
	}
	let { label, options, value = $bindable([]), min = 0, disabled = false, onchange, minNote = 'At least one stays checked.' }: Props = $props();
	const uid = $props.id();

	function toggle(option: string, checked: boolean): void {
		const next = options.map((entry) => entry.value).filter((entry) => (entry === option ? checked : value.includes(entry)));
		value = next;
		onchange?.(next);
	}
</script>

<fieldset class="ap-checklist" {disabled}>
	<legend class="ap-checklist-legend">{label}</legend>
	{#each options as option (option.value)}
		{@const checked = value.includes(option.value)}
		{@const kept = checked && value.length <= min}
		{@const locked = Boolean(option.disabled) || kept}
		{@const noteId = `${uid}-${option.value}-note`}
		<label class={['ap-choice-item', 'ap-checklist-item', checked && 'ap-choice-on', locked && 'ap-checklist-item-locked', option.disabled && 'ap-checklist-item-off']}>
			<!-- Locked boxes stay focusable and say why (aria-disabled with the note), rather than vanishing from the tab order. -->
			<input class="ap-checklist-box" type="checkbox" {checked} aria-disabled={locked || undefined}
				aria-describedby={[option.note && noteId, kept && `${uid}-min`].filter(Boolean).join(' ') || undefined}
				onclick={(event) => { if (locked) event.preventDefault(); }}
				onchange={(event) => toggle(option.value, event.currentTarget.checked)} />
			<span class="ap-checklist-label">
				<span class="ap-checklist-head">
					<span class="ap-choice-title">{option.title}</span>
					{#if option.note}<span class="ap-checklist-note" id={noteId}>{option.note}</span>{/if}
				</span>
				{#if option.text}<span class="ap-choice-text">{option.text}</span>{/if}
			</span>
		</label>
	{/each}
	{#if min > 0}<span class="ap-sr" id={`${uid}-min`}>{minNote}</span>{/if}
</fieldset>
