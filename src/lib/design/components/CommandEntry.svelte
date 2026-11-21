<script lang="ts">
	import type { ReferenceCommand } from './types';

	/**
	 * One command as a description list's entry (inside a `<dl>`), as the CommandReference and the composer's
	 * CommandCard show it: its `/name` and hint as code, its description, and a label of what it fails without
	 * ("Required: reply"). With `onuse`, the code is a button named for it ("Use /name hint"), styled as the text, that
	 * uses it. One `replaced` by the server's command of the same name is crossed out, says so, and isn't used.
	 */
	interface Props {
		command: ReferenceCommand;
		onuse?: (name: string) => void;
	}
	let { command, onuse }: Props = $props();
	const shown = $derived(`/${command.name}${command.hint ? ` ${command.hint}` : ''}`);
</script>

{#snippet code()}<code class="ap-cmdref-code"><bdi class="ap-cmdref-name">/{command.name}</bdi>{#if command.hint}{' '}<bdi>{command.hint}</bdi>{/if}</code>{/snippet}
<div>
	<dt>{#if command.replaced}<s>{@render code()}</s>{:else if onuse}<button type="button" class="ap-cmdref-use" aria-label="Use {shown}" onclick={() => onuse(command.name)}>{@render code()}</button>{:else}{@render code()}{/if}</dt>
	{#if command.description}<dd class="ap-cmdref-desc" dir="auto">{command.description}</dd>{/if}
	{#if command.replaced}<dd class="ap-cmdref-required">Replaced by the server’s /{command.name}</dd>{:else if command.required?.length}<dd class="ap-cmdref-required">Required: {command.required.join(', ')}</dd>{/if}
</div>
