<script lang="ts">
	/*
	 * The message field and what sits above it until the message is sent: the message being replied to, the draft's files
	 * and its links' previews, and an autocomplete picker. The field is a textarea, or your own (`field`).
	 */
	import Mic from '@lucide/svelte/icons/mic';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Smile from '@lucide/svelte/icons/smile';
	import Square from '@lucide/svelte/icons/square';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Attachments from './Attachments.svelte';
	import Button from './Button.svelte';
	import Embed from './Embed.svelte';
	import EmbedRemove from './EmbedRemove.svelte';
	import { isCommand } from './compose';
	import type { ComposerField, EmbedProps } from './types';
	import { roomName } from './util';

	/**
	 * Other attributes (an `id`, `aria-*`, `data-*`, its event handlers, a `class`) go on the default field, the
	 * textarea; a `field` of your own takes them itself.
	 */
	interface Props extends Omit<HTMLAttributes<HTMLTextAreaElement>, 'oninput'> {
		room?: string;
		placeholder?: string;
		/** The draft; `bind:value` in Svelte. With your own `field`, keep it up to date from what the field shows. */
		value?: string;
		/** Change notification for callers that can't bind (plain pages); fires after `value` updates in the textarea. */
		oninput?: (value: string) => void;
		onsend?: () => void;
		/** Whether Send is enabled, when you decide it. By default, while the draft has text (`value`) or files (`attachments`). */
		canSend?: boolean;
		/** Cap `embed:upload`: the attach and microphone buttons. Attachments go out as `upload` embeds (§4.8.3). */
		canUpload?: boolean;
		/** Picked files: Attach opens the browser's file picker (a hidden file input) and hands them over. */
		onfiles?: (files: File[]) => void;
		disabled?: boolean;
		/** Hide the microphone (no getUserMedia, or a policy choice). */
		canRecord?: boolean;
		onrecord?: () => void;
		onstoprecording?: () => void;
		/** While true the field is replaced by a "Recording m:ss" line, the mic becomes Stop, and Attach, the emoji button and Send wait. */
		recording?: boolean;
		recordingTime?: string;
		/** Set when the main pane shows a thread: posts go to its `room_id` and the placeholder reads "Reply in …" (its `name`, or "Untitled"). */
		thread?: { thread: string; name?: string } | null;
		/** Cap `command` (§4.1): while `value` starts with one "/" (`//` posts a message), a Command tag shows, the field turns monospace and Send reads Run. */
		canCommand?: boolean;
		/**
		 * Your own field in place of the textarea, such as a ComposerEditable that shows mentions as chips. It gets the
		 * placeholder, whether the Composer is disabled and whether the draft is a command.
		 */
		field?: Snippet<[ComposerField]>;
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
		/** The draft's files, above the field (in an <Attachments>): AttachmentTiles, each removable and maybe renamable. */
		attachments?: Snippet;
		/** Previews of the draft's links, which go out with it as embeds; each can be removed first. */
		previews?: EmbedProps[];
		/** Replaces a preview's <Embed>, by its index in `previews`, such as with your own renderers. */
		preview?: Snippet<[number]>;
		/** A preview's (x) (an <EmbedRemove>): send the message without it. */
		onremovepreview?: (index: number) => void;
		/** An autocomplete picker (a <MentionPicker>), anchored above the field. */
		picker?: Snippet;
		/** `data-testid` on the reply above the field. */
		replyTestid?: string;
		/** `data-testid` on the row of files. */
		attachmentsTestid?: string;
		/** `data-testid` on the link previews. */
		previewsTestid?: string;
		/** `data-testid` on the hidden file input (`onfiles`). */
		fileInputTestid?: string;
		/** `data-testid` on the Command tag. */
		commandTestid?: string;
		/** `data-testid` on the emoji button. */
		emojiTestid?: string;
		/** `data-testid` on Send. */
		sendTestid?: string;
	}
	let {
		room, placeholder, value = $bindable(''), oninput, onsend, canSend, canUpload, onfiles, disabled, canRecord, onrecord, onstoprecording, recording, recordingTime, thread, canCommand,
		field, onemoji, emojiOpen, emojiButton = $bindable(), reply, replyText, oncancelreply, attachments, previews, preview, onremovepreview, picker,
		replyTestid, attachmentsTestid, previewsTestid, fileInputTestid, commandTestid, emojiTestid, sendTestid, class: className, ...rest
	}: Props = $props();

	const ph = $derived(placeholder || (thread ? `Reply in ${roomName(thread.name, thread.thread, { thread: true })}` : `Message ${room || ''}`));
	const cmd = $derived(!!canCommand && isCommand(value));
	const sendable = $derived(canSend ?? (!!value.trim() || !!attachments));
	let fileInput = $state<HTMLInputElement>();

	function picked(input: HTMLInputElement): void {
		const list = [...(input.files ?? [])];
		input.value = '';
		if (list.length) onfiles?.(list);
	}
</script>

{#if reply}
	<div class="ap-composer-reply" data-testid={replyTestid} role="status">
		<span class="ap-composer-reply-text">Replying to {#if reply.name}<bdi>{reply.name}</bdi>: <bdi>{#if replyText}{@render replyText()}{:else}{reply.text}{/if}</bdi>{:else}<bdi>{reply.text}</bdi>{/if}</span>
		<Button variant="ghost" size="sm" aria-label="Cancel reply" onclick={oncancelreply} label="Cancel reply" />
	</div>
{/if}
{#if attachments}<Attachments data-testid={attachmentsTestid}>{@render attachments()}</Attachments>{/if}
{#if previews && previews.length > 0}
	<div class="ap-composer-previews" data-testid={previewsTestid} aria-label="Link previews to send">
		{#each previews as embed, index (embed.url ?? index)}
			<div class="ap-composer-preview">
				{#if preview}{@render preview(index)}{:else}<Embed {...embed} />{/if}
				{#if onremovepreview}<EmbedRemove label="Remove preview" onremove={() => onremovepreview(index)} />{/if}
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
				<button type="button" class="ap-iconbtn" onclick={() => fileInput?.click()} disabled={disabled || recording} aria-label="Attach a file" title="Attach a file">
					<Paperclip size={18} aria-hidden="true" />
				</button>
				{#if canRecord !== false}
					<button type="button" class={['ap-iconbtn', recording && 'ap-iconbtn-rec']} onclick={recording ? onstoprecording : onrecord} {disabled} aria-label={recording ? 'Stop recording' : 'Record a voice message'} aria-pressed={!!recording} title={recording ? 'Stop recording' : 'Record a voice message'}>
						{#if recording}<Square size={12} fill="currentColor" stroke="currentColor" strokeWidth={0} aria-hidden="true" />
						{:else}<Mic size={18} aria-hidden="true" />{/if}
					</button>
				{/if}
			</span>
			{#if onfiles}<input class="ap-sr" type="file" multiple tabindex="-1" aria-hidden="true" data-testid={fileInputTestid} bind:this={fileInput} onchange={(e) => picked(e.currentTarget)} />{/if}
		{/if}
		{#if recording}
			<span class="ap-composer-recording" role="status"><span class="ap-composer-recdot" aria-hidden="true"></span>Recording <span class="ap-composer-rectime">{recordingTime || '0:00'}</span></span>
		{:else}
			{#if cmd}<span class="ap-composer-cmdtag" data-testid={commandTestid} title="Sent to the server, not posted">Command</span>{/if}
			{#if field}{@render field({ placeholder: ph, disabled: !!disabled, command: cmd })}
			{:else}
				<textarea rows="1" dir="auto" placeholder={ph} {disabled} aria-label={cmd ? 'Command' : 'Message'} {...rest} class={['ap-composer-field', className]} bind:value={() => value, (v) => { value = v; oninput?.(v); }}></textarea>
			{/if}
		{/if}
		{#if onemoji}
			<span class="ap-composer-tools">
				<button type="button" class={['ap-iconbtn', emojiOpen && 'ap-iconbtn-on']} data-testid={emojiTestid} aria-label="Insert emoji" title="Insert emoji" aria-haspopup="dialog" aria-expanded={!!emojiOpen} disabled={disabled || recording} bind:this={emojiButton} onclick={onemoji}>
					<Smile size={18} aria-hidden="true" />
				</button>
			</span>
		{/if}
		<!-- Pressing Send leaves the focus in the field, so a phone's keyboard stays up between messages rather than dropping and coming back. -->
		<Button type="submit" size="sm" variant="primary" data-testid={sendTestid} onmousedown={(e) => e.preventDefault()} aria-label={cmd ? 'Run command' : 'Send message'} disabled={disabled || recording || !sendable} label={cmd ? 'Run' : 'Send'} />
	</form>
</div>
