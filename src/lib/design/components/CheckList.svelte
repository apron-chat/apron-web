<script lang="ts">
	/** One option of a CheckList: its value, a title and a line saying what it does. */
	interface CheckOption {
		value: string;
		title: string;
		text?: string;
		/** Can't be changed here; `note` can say why. */
		disabled?: boolean;
		/** A short note under it, such as why it is disabled, or what it does here. */
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
	}
	let { label, options, value = $bindable([]), min = 0, disabled = false, onchange }: Props = $props();

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
		<label class={['ap-choice-item', 'ap-checklist-item', checked && 'ap-choice-on', (option.disabled || kept) && 'ap-checklist-item-locked']}>
			<input class="ap-checklist-box" type="checkbox" {checked} disabled={disabled || option.disabled || kept} onchange={(event) => toggle(option.value, event.currentTarget.checked)} />
			<span class="ap-checklist-label">
				<span class="ap-choice-title">{option.title}</span>
				{#if option.text}<span class="ap-choice-text">{option.text}</span>{/if}
				{#if option.note}<span class="ap-checklist-note">{option.note}</span>{/if}
			</span>
		</label>
	{/each}
</fieldset>
