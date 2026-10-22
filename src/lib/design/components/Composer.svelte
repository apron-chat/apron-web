<script lang="ts">
	/*
	 * The message field and what sits above it until the message is sent: the message being replied to, the draft's files
	 * and its links' previews, and an autocomplete picker. Its parts carry `data-testid`s: reply-draft, staged-files,
	 * link-previews, attach-input, command-tag, emoji-button and send-button.
	 */
	import Mic from '@lucide/svelte/icons/mic';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Smile from '@lucide/svelte/icons/smile';
	import Square from '@lucide/svelte/icons/square';
	import X from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Attachments from './Attachments.svelte';
	import Button from './Button.svelte';
	import Embed from './Embed.svelte';
	import type { AttachmentFile, EmbedProps } from './types';

	interface Props {
		room?: string;
		placeholder?: string;
		/** The draft; `bind:value` in Svelte. */
		value?: string;
		/** Change notification for callers that can't bind (plain pages); fires after `value` updates. */
		oninput?: (value: string) => void;
		onsend?: () => void;
		/** False while there is nothing to send, which disables Send. By default, whether `value` has any text. */
		canSend?: boolean;
		/** Cap `embed:upload`: the attach and microphone buttons. Attachments go out as `upload` embeds (§4.8.3). */
		canUpload?: boolean;
		onattach?: () => void;
		/** Picked files. With it, Attach opens the browser's file picker (a hidden file input) instead of calling `onattach`. */
		onfiles?: (files: File[]) => void;
		disabled?: boolean;
		/** Hide the microphone (no getUserMedia, or a policy choice). */
		canRecord?: boolean;
		onrecord?: () => void;
		onstoprecording?: () => void;
		/** While true the field is replaced by a "Recording m:ss" line, the mic becomes Stop, and Attach, the emoji button and Send wait. */
		recording?: boolean;
		recordingTime?: string;
		/** Set when the main pane shows a thread: posts go to its `room_id` and the placeholder reads "Reply in …". */
		thread?: { thread: string; name?: string } | null;
		/** Cap `command` (§4.1): while `value` starts with one "/", a Command tag shows, the field turns monospace and Send reads Run. */
		canCommand?: boolean;
		/** Whether the draft is a command, when you decide it; by default `canCommand` and `value` as above. */
		command?: boolean;
		/**
		 * A rich field in place of the textarea: an empty `contenteditable` (plain text only) that you fill and read
		 * through `field`, such as to show mentions as chips. It shows the placeholder while `empty`.
		 */
		editable?: boolean;
		/** The editable field has nothing in it. */
		empty?: boolean;
		/** The field's element (the textarea, or the editable); `bind:field`. */
		field?: HTMLElement;
		/** Other attributes for the field: an `id`, `aria-*`, its event handlers. */
		fieldProps?: HTMLAttributes<HTMLElement>;
		/** The emoji button, after the field: it opens your emoji picker. Omit to hide it. */
		onemoji?: () => void;
		/** The emoji picker is open: the button reads as pressed. */
		emojiOpen?: boolean;
		/** The emoji button's element, where a picker anchors; `bind:emojiButton`. */
		emojiButton?: HTMLButtonElement;
		/** The message being replied to: "Replying to {name}: {text}" above the field, with Cancel reply. */
		reply?: { name?: string; text: string };
		/** Replaces the reply's text after the name, such as with its mentions drawn as chips. */
		replyText?: Snippet;
		oncancelreply?: () => void;
		/** The draft's files, above the field (an <Attachments>). */
		files?: AttachmentFile[];
		onremovefile?: (index: number) => void;
		onrenamefile?: (index: number, name: string) => void;
		/** Your own tiles in place of `files`', such as AttachmentTiles whose previews you manage. */
		attachments?: Snippet;
		/** Previews of the draft's links, which go out with it as embeds; each can be removed first. */
		previews?: EmbedProps[];
		/** Replaces a preview's <Embed>, by its index in `previews`, such as with your own renderers. */
		preview?: Snippet<[number]>;
		/** A preview's (x): send the message without it. */
		onremovepreview?: (index: number) => void;
		/** An autocomplete picker (a <MentionPicker>), anchored above the field. */
		picker?: Snippet;
	}
	let {
		room, placeholder, value = $bindable(''), oninput, onsend, canSend, canUpload, onattach, onfiles, disabled, canRecord, onrecord, onstoprecording, recording, recordingTime, thread, canCommand,
		command, editable, empty, field = $bindable(), fieldProps, onemoji, emojiOpen, emojiButton = $bindable(), reply, replyText, oncancelreply,
		files, onremovefile, onrenamefile, attachments, previews, preview, onremovepreview, picker
	}: Props = $props();

	const ph = $derived(placeholder || (thread ? `Reply in ${thread.name || thread.thread}` : `Message ${room || ''}`));
	/* "//" posts a message starting with "/" */
	const cmd = $derived(command ?? (!!canCommand && value.startsWith('/') && !value.startsWith('//')));
	const sendable = $derived(canSend ?? !!value.trim());
	let fileInput = $state<HTMLInputElement>();

	function attach(): void {
		if (onfiles) fileInput?.click();
		else onattach?.();
	}

	function picked(input: HTMLInputElement): void {
		const list = [...(input.files ?? [])];
		input.value = '';
		if (list.length) onfiles?.(list);
	}
</script>

{#if reply}
	<div class="ap-composer-reply" data-testid="reply-draft" role="status">
		<span class="ap-composer-reply-text">Replying to {#if reply.name}{reply.name}: {#if replyText}{@render replyText()}{:else}{reply.text}{/if}{:else}{reply.text}{/if}</span>
		<Button variant="ghost" size="sm" aria-label="Cancel reply" onclick={oncancelreply} label="Cancel reply" />
	</div>
{/if}
<Attachments files={files} onremove={onremovefile} onrename={onrenamefile} children={attachments} data-testid="staged-files" />
{#if previews && previews.length > 0}
	<div class="ap-composer-previews" data-testid="link-previews" aria-label="Link previews to send">
		{#each previews as embed, index (embed.url ?? index)}
			<div class="ap-composer-preview">
				{#if preview}{@render preview(index)}{:else}<Embed {...embed} />{/if}
				{#if onremovepreview}
					<button class="ap-embed-remove" type="button" aria-label="Remove preview" title="Remove preview" onclick={() => onremovepreview(index)}>
						<X size={12} strokeWidth={2.5} aria-hidden="true" />
					</button>
				{/if}
			</div>
		{/each}
	</div>
{/if}
<!-- The picker anchors to the field's row and grows upward. -->
<div class="ap-composer-wrap">
	{@render picker?.()}
	<form class={['ap-composer', disabled && 'ap-composer-disabled', cmd && 'ap-composer-cmd']} aria-label="Send a message" onsubmit={(e) => { e.preventDefault(); onsend?.(); }}>
		{#if canUpload}
			<span class="ap-composer-tools">
				<button type="button" class="ap-iconbtn" onclick={attach} disabled={disabled || recording} aria-label="Attach a file" title="Attach a file">
					<Paperclip size={18} aria-hidden="true" />
				</button>
				{#if canRecord !== false}
					<button type="button" class={['ap-iconbtn', recording && 'ap-iconbtn-rec']} onclick={recording ? onstoprecording : onrecord} {disabled} aria-label={recording ? 'Stop recording' : 'Record a voice message'} aria-pressed={!!recording} title={recording ? 'Stop recording' : 'Record a voice message'}>
						{#if recording}<Square size={12} fill="currentColor" stroke="currentColor" strokeWidth={0} aria-hidden="true" />
						{:else}<Mic size={18} aria-hidden="true" />{/if}
					</button>
				{/if}
			</span>
			{#if onfiles}<input class="ap-sr" type="file" multiple tabindex="-1" aria-hidden="true" data-testid="attach-input" bind:this={fileInput} onchange={(e) => picked(e.currentTarget)} />{/if}
		{/if}
		{#if recording}
			<span class="ap-composer-recording" role="status"><span class="ap-composer-recdot" aria-hidden="true"></span>Recording <span class="ap-composer-rectime">{recordingTime || '0:00'}</span></span>
		{:else}
			{#if cmd}<span class="ap-composer-cmdtag" data-testid="command-tag" title="Sent to the server, not posted">Command</span>{/if}
			{#if editable}
				<div
					class={['ap-composer-field', 'ap-composer-editable', empty && 'ap-composer-editable-empty']}
					role="textbox"
					aria-label="Message"
					aria-multiline="true"
					aria-placeholder={ph}
					aria-disabled={disabled}
					data-placeholder={ph}
					tabindex={disabled ? -1 : 0}
					contenteditable={disabled ? 'false' : 'plaintext-only'}
					spellcheck="true"
					{...fieldProps}
					bind:this={field}
				></div>
			{:else}
				<textarea class="ap-composer-field" rows="1" placeholder={ph} bind:value={() => value, (v) => { value = v; oninput?.(v); }} {disabled} aria-label={cmd ? 'Command' : 'Message'} {...fieldProps} bind:this={field}></textarea>
			{/if}
		{/if}
		{#if onemoji}
			<span class="ap-composer-tools">
				<button type="button" class={['ap-iconbtn', emojiOpen && 'ap-iconbtn-on']} data-testid="emoji-button" aria-label="Insert emoji" title="Insert emoji" aria-haspopup="dialog" aria-expanded={!!emojiOpen} disabled={disabled || recording} bind:this={emojiButton} onclick={onemoji}>
					<Smile size={18} aria-hidden="true" />
				</button>
			</span>
		{/if}
		<!-- Pressing Send leaves the focus in the field, so a phone's keyboard stays up between messages rather than dropping and coming back. -->
		<Button type="submit" size="sm" variant="primary" data-testid="send-button" onmousedown={(e) => e.preventDefault()} aria-label={cmd ? 'Run command' : 'Send message'} disabled={disabled || recording || !sendable} label={cmd ? 'Run' : 'Send'} />
	</form>
</div>
