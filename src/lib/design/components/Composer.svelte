<script lang="ts">
	import Button from './Button.svelte';
	import { cx } from './util';

	interface Props {
		room?: string;
		placeholder?: string;
		/** The draft; `bind:value` in Svelte. */
		value?: string;
		oninput?: (value: string) => void;
		onsend?: () => void;
		/** Cap `embed:upload`: the attach and microphone buttons. Attachments go out as `upload` embeds (§4.6.3). */
		canUpload?: boolean;
		onattach?: () => void;
		disabled?: boolean;
		/** Hide the microphone (no getUserMedia, or a policy choice). */
		canRecord?: boolean;
		onrecord?: () => void;
		onstoprecording?: () => void;
		/** While true the field is replaced by a "Recording m:ss" line and the mic becomes Stop. */
		recording?: boolean;
		recordingTime?: string;
		/** Set when the main pane shows a thread: posts go to its `room_id` and the placeholder reads "Reply in …". */
		thread?: { thread: string; name?: string } | null;
		/** Cap `command` (§4.8): while `value` starts with one "/", a Command tag shows, the field turns monospace and Send reads Run. */
		canCommand?: boolean;
	}
	let { room, placeholder, value = $bindable(''), oninput, onsend, canUpload, onattach, disabled, canRecord, onrecord, onstoprecording, recording, recordingTime, thread, canCommand }: Props = $props();

	const ph = $derived(placeholder || (thread ? `Reply in ${thread.name || thread.thread}` : `Message ${room || ''}`));
	/* "//" posts a message starting with "/" */
	const cmd = $derived(!!canCommand && typeof value === 'string' && value.charAt(0) === '/' && value.charAt(1) !== '/');
</script>

<form class={cx('ap-composer', disabled && 'ap-composer-disabled', cmd && 'ap-composer-cmd')} onsubmit={(e) => { e.preventDefault(); onsend?.(); }}>
	{#if canUpload}
		<span class="ap-composer-tools">
			<button type="button" class="ap-iconbtn" onclick={onattach} {disabled} aria-label="Attach a file" title="Attach a file">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.8 8.8a5.5 5.5 0 0 1-7.8-7.8L13.6 3.3a3.5 3.5 0 0 1 5 5l-9.2 9.2a1.5 1.5 0 0 1-2.1-2.1L15.9 6.8" /></svg>
			</button>
			{#if canRecord !== false}
				<button type="button" class={cx('ap-iconbtn', recording && 'ap-iconbtn-rec')} onclick={recording ? onstoprecording : onrecord} {disabled} aria-label={recording ? 'Stop recording' : 'Record a voice message'} aria-pressed={!!recording} title={recording ? 'Stop recording' : 'Record a voice message'}>
					{#if recording}<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
					{:else}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></svg>{/if}
				</button>
			{/if}
		</span>
	{/if}
	{#if recording}
		<span class="ap-composer-recording" role="status"><span class="ap-composer-recdot" aria-hidden="true"></span>Recording <span class="ap-composer-rectime">{recordingTime || '0:00'}</span></span>
	{:else}
		{#if cmd}<span class="ap-composer-cmdtag" title="Sent to the server, not posted">Command</span>{/if}
		<textarea class="ap-composer-field" rows="1" placeholder={ph} bind:value oninput={() => oninput?.(value)} {disabled} aria-label={cmd ? 'Command' : 'Message'}></textarea>
	{/if}
	<Button type="submit" size="sm" variant="primary" {disabled} label={cmd ? 'Run' : 'Send'} />
</form>
