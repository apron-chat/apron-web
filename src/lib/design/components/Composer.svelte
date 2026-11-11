<script lang="ts">
	/*
	 * The message field and what sits above it until the message is sent: the message being replied to, the draft's files
	 * and its links' previews, and an autocomplete picker. The field is a textarea, or your own (`field`).
	 */
	import FileText from '@lucide/svelte/icons/file-text';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import Maximize from '@lucide/svelte/icons/maximize-2';
	import Minimize from '@lucide/svelte/icons/minimize-2';
	import Mic from '@lucide/svelte/icons/mic';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Smile from '@lucide/svelte/icons/smile';
	import Square from '@lucide/svelte/icons/square';
	import { untrack, type Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Attachments from './Attachments.svelte';
	import Button from './Button.svelte';
	import Embed from './Embed.svelte';
	import EmbedRemove from './EmbedRemove.svelte';
	import WritePreview from './WritePreview.svelte';
	import { secondNow } from './clock.svelte';
	import { isCommand } from './compose';
	import type { ComposerField, EmbedProps } from './types';
	import { LONG_WAIT_MS, roomName, waitLabel, waitWords } from './util';

	interface Props {
		room?: string;
		placeholder?: string;
		/** The draft; `bind:value` in Svelte. With your own `field`, keep it up to date from what the field shows. */
		value?: string;
		/** Change notification for callers that can't bind (plain pages); fires after `value` updates in the textarea. */
		oninput?: (value: string) => void;
		onsend?: () => void;
		/** Whether Send is enabled, when you decide it. By default, while the draft has text (`value`) or files (`attachments`). */
		canSend?: boolean;
		/**
		 * Sending waits until then, as the server asked (`retry_after`), in epoch milliseconds: Send is off and shows an
		 * hourglass and the time left in place of its label, and comes back at zero. The draft stays; nothing is sent by itself.
		 */
		waitUntil?: number;
		/** Cap `embed:upload`: the attach and microphone buttons. Attachments go out as `upload` embeds (§4.8.3). */
		canUpload?: boolean;
		/** Picked files: Attach opens the browser's file picker (a hidden file input) and hands them over. */
		onfiles?: (files: File[]) => void;
		/** The types the file picker offers, as its `accept`, such as `image/*,audio/*`. Omit for any file. */
		accept?: string;
		/**
		 * Long text was pasted into the draft: "Attach as file instead" beside Attach calls this, to send the pasted
		 * text as a file rather than in the message. `attachPasteTitle` is its tooltip, which assistive tech reads as
		 * its description, saying what it does (such as which file, and how large).
		 */
		onattachpaste?: () => void;
		attachPasteTitle?: string;
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
		 * Live typing: the draft is already a message that others see as it is typed (an `append` embed, §4.8.5). A Live
		 * tag shows in place of the Command tag, and Send, which finishes the message, stays on while the field is empty.
		 */
		live?: boolean;
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
		/** `data-testid` on the Live tag. */
		liveTestid?: string;
		/** `data-testid` on the emoji button. */
		emojiTestid?: string;
		/** `data-testid` on Send. */
		sendTestid?: string;
		/** Classes for the default field, the textarea, added to its own; a `field` of your own takes its own. */
		class?: ClassValue;
		/**
		 * Offers the full panel: an Expand button (its glyph alone) beside the field, for writing at length with
		 * formatting; it flashes as it appears. It doesn't show while recording, or for a command or live text. Omit to
		 * hide it, as the app does until a draft has a second line.
		 */
		onexpand?: () => void;
		/**
		 * The full panel, for writing at length: the Composer takes three quarters of its pane (the box it sits in, a
		 * column with the timeline above it), with `toolbar` along its top, the field filling the rest, and the attach,
		 * microphone and emoji buttons beside Send at its foot. It is the same form, laid out anew, so the field and its
		 * caret stay as they were as it opens and closes.
		 */
		expanded?: boolean;
		/** The full panel's Collapse button, back to the compact composer with the same draft. */
		oncollapse?: () => void;
		/** The full panel's formatting buttons, at its top. */
		toolbar?: Snippet;
		/** The draft as it will show once sent, which the full panel's Preview shows in place of the field. Omit for no Preview. */
		rendered?: Snippet;
		/** The full panel shows `rendered`, not the field: Write and Preview switch it (`onpreview`). */
		previewing?: boolean;
		onpreview?: (previewing: boolean) => void;
		/** The keys that send from the full panel, shown at its foot, such as `['Ctrl', 'Enter']`. */
		sendKeys?: string[];
		/**
		 * The draft has a line break, where your field can tell it more cheaply than `value`, which is read on every key
		 * otherwise. Past one line, by a break or by wrapping, the field takes the box's whole width and the buttons drop
		 * to a row under it.
		 */
		multiline?: boolean;
		/** `data-testid` on the Expand button. */
		expandTestid?: string;
		/** `data-testid` on the full panel. */
		panelTestid?: string;
	}
	let {
		room, placeholder, value = $bindable(''), oninput, onsend, canSend, waitUntil, canUpload, onfiles, accept, onattachpaste, attachPasteTitle, disabled, canRecord, onrecord, onstoprecording, recording, recordingTime, thread, canCommand, live,
		field, onemoji, emojiOpen, emojiButton = $bindable(), reply, replyText, oncancelreply, attachments, previews, preview, onremovepreview, picker,
		replyTestid, attachmentsTestid, previewsTestid, fileInputTestid, commandTestid, liveTestid, emojiTestid, sendTestid, class: className,
		onexpand, expanded = false, oncollapse, toolbar, rendered, previewing = false, onpreview, sendKeys, multiline, expandTestid, panelTestid
	}: Props = $props();

	const ph = $derived(placeholder || (thread ? `Reply in ${roomName(thread.name, thread.thread, { thread: true })}` : `Message ${room || ''}`));
	const cmd = $derived(!!canCommand && isCommand(value) && !live);
	/** Expand, where it's offered: not while recording, nor for a command or live text, which have no full panel. */
	const expandable = $derived(Boolean(onexpand) && !recording && !cmd && !live);
	/**
	 * What `field` is drawn with, kept as one object while its parts are the same: a snippet reads its arguments
	 * afresh at every use, and the field reads `disabled` several times a key.
	 */
	const fieldArgs = $derived({ placeholder: ph, disabled: !!disabled, command: cmd });
	const sendable = $derived(canSend ?? (!!value.trim() || !!attachments || !!live));
	/** What's left of a wait on sending, while there is one. */
	const waitLeft = $derived(waitUntil === undefined ? 0 : Math.max(0, waitUntil - secondNow()));
	let fileInput = $state<HTMLInputElement>();
	let form = $state<HTMLFormElement>();
	/**
	 * Past one line by wrapping, while the draft is at least this long (else 0): about what the narrow field held as it
	 * wrapped, so the wider field fitting the draft on one line again doesn't flip it back and forth. It is the draft's
	 * length as it wraps while typing; for a draft that arrives wrapped (pasted, or kept from another pane), or once that
	 * guess proved too long, the least that one line of it can hold, so deleting it doesn't flip it back on every key.
	 */
	let wrapAt = $state(0);
	/** The last `wrapAt`, once the draft got shorter than it: a wrap seen again below it means the guess was too long. */
	let lastWrapAt = 0;
	const wrapped = $derived(wrapAt > 0 && value.length >= wrapAt);
	const breaks = $derived(multiline ?? value.includes('\n'));
	/**
	 * Past one line, by a line break or by wrapping: the field takes the box's whole width and the buttons sit in a row
	 * under it (ap-composer-grown), as at the full panel's foot. Not while recording, whose line takes no typing.
	 */
	const grown = $derived(!expanded && !recording && (breaks || wrapped));
	$effect(() => {
		if (!wrapAt || wrapped) return;
		// Emptied (sent): the next wrap is a fresh one.
		lastWrapAt = untrack(() => value.length) ? wrapAt : 0;
		wrapAt = 0;
	});
	/** The field's line height, read once. */
	let lineHeight = 0;
	// The field wrapping onto a second line, seen by its size (a ResizeObserver: no layout read on any key).
	$effect(() => {
		if (expanded || recording || !form || typeof ResizeObserver !== 'function') return;
		const field = form.querySelector<HTMLElement>('.ap-composer-field');
		if (!field) return;
		lineHeight ||= parseFloat(getComputedStyle(field).lineHeight) || 22;
		const line = lineHeight;
		let frame = 0;
		/** The box's width, which growing doesn't change: another is the pane resizing, so whether a wrap still holds is asked again. */
		let boxWidth = 0;
		const box = form;
		/**
		 * A change of layout, drawn before this frame paints. The box and field are looked at again from the next frame, so
		 * their new sizes are no loop; the box's width is kept, so a resize in between is still seen then.
		 */
		const watch = (): void => {
			observer.observe(box, { box: 'border-box' });
			observer.observe(field);
		};
		const relayout = (change: () => void): void => {
			observer.disconnect();
			change();
			frame = requestAnimationFrame(watch);
		};
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				if (entry.target === box) {
					const width = entry.borderBoxSize?.[0]?.inlineSize;
					if (width === undefined) continue;
					const resized = boxWidth > 0 && width !== boxWidth;
					boxWidth = width;
					if (resized && wrapped && !breaks) return relayout(() => (wrapAt = lastWrapAt = 0));
					continue;
				}
				const { height } = entry.contentRect;
				const length = value.length;
				// An empty field taller than a line is its placeholder wrapping (the textarea's), not the draft.
				if (grown || !length || height <= line * 1.5) continue;
				const lines = Math.max(2, Math.round(height / line));
				return relayout(() => (wrapAt = lines > 2 || length < lastWrapAt ? Math.ceil(length / lines) : length));
			}
		});
		watch();
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	});

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		if (waitLeft <= 0) onsend?.();
	}

	function picked(input: HTMLInputElement): void {
		const list = [...(input.files ?? [])];
		input.value = '';
		if (list.length) onfiles?.(list);
	}
</script>

<!-- One form, compact or the full panel (ap-composer-full, laid out by the stylesheet), so the field is never drawn anew between them. -->
<div class={['ap-composer-box', expanded && 'ap-composer-full']} data-testid={expanded ? panelTestid : undefined}>
	{#if reply}
		<div class="ap-composer-reply" data-testid={replyTestid} role="status">
			<span class="ap-composer-reply-text">Replying to {#if reply.name}<bdi>{reply.name}</bdi>: <bdi>{#if replyText}{@render replyText()}{:else}{reply.text}{/if}</bdi>{:else}<bdi>{reply.text}</bdi>{/if}</span>
			<Button variant="ghost" size="sm" aria-label="Cancel reply" onclick={oncancelreply} label="Cancel reply" />
		</div>
	{/if}
	{#if attachments}<Attachments testid={attachmentsTestid}>{@render attachments()}</Attachments>{/if}
	{#if previews && previews.length > 0}
		<div class="ap-composer-previews" data-testid={previewsTestid} aria-label="Link previews to send">
			{#each previews as embed, index (embed.url ?? index)}
				<div class="ap-composer-preview">
					{#if preview}{@render preview(index)}{:else}<!-- spread: an embed record; its fields are Embed's own props --><Embed {...embed} />{/if}
					{#if onremovepreview}<EmbedRemove label="Remove preview" onremove={() => onremovepreview(index)} />{/if}
				</div>
			{/each}
		</div>
	{/if}
	<!-- The picker anchors to the field's row and grows upward. -->
	<div class="ap-composer-wrap">
		{@render picker?.()}
		<form class={['ap-composer', disabled && 'ap-composer-disabled', cmd && 'ap-composer-cmd', grown && 'ap-composer-grown', expanded && previewing && rendered && 'ap-composer-previewing']} aria-label="Send a message" onsubmit={submit} bind:this={form}>
			{#if expanded}
				<div class="ap-mdhead">
					{#if !previewing}{@render toolbar?.()}{/if}
					<span class="ap-mdhead-grow"></span>
					{#if rendered}
						<WritePreview {previewing} {onpreview} />
					{/if}
					{#if oncollapse}
						<button type="button" class="ap-iconbtn" aria-label="Collapse composer" title="Collapse (Esc)" onclick={oncollapse}>
							<Minimize size={16} aria-hidden="true" />
						</button>
					{/if}
				</div>
				{#if previewing && rendered}<div class="ap-composer-rendered">{@render rendered()}</div>{/if}
			{/if}
			{#if canUpload}
				<span class="ap-composer-tools ap-composer-tools-start">
					<button type="button" class="ap-iconbtn" onclick={() => fileInput?.click()} disabled={disabled || recording} aria-label="Attach a file" title="Attach a file">
						<Paperclip size={18} aria-hidden="true" />
					</button>
					{#if canRecord !== false}
						<button type="button" class={['ap-iconbtn', recording && 'ap-iconbtn-rec']} onclick={recording ? onstoprecording : onrecord} {disabled} aria-label={recording ? 'Stop recording' : 'Record a voice message'} aria-pressed={!!recording} title={recording ? 'Stop recording' : 'Record a voice message'}>
							{#if recording}<Square size={12} fill="currentColor" stroke="currentColor" strokeWidth={0} aria-hidden="true" />
							{:else}<Mic size={18} aria-hidden="true" />{/if}
						</button>
					{/if}
					{#if onattachpaste && !recording}
						<!-- Its words, shortened where the pane is narrow, as a phone's is: its name stays them in full. -->
						<button type="button" class="ap-btn ap-btn-quiet ap-btn-sm ap-composer-asfile" onclick={onattachpaste} {disabled} title={attachPasteTitle} aria-label="Attach as file instead">
							<FileText size={16} aria-hidden="true" /><span class="ap-composer-asfile-long">Attach as file instead</span><span class="ap-composer-asfile-short">As file</span>
						</button>
					{/if}
				</span>
				{#if onfiles}<input class="ap-sr" type="file" multiple {accept} tabindex="-1" aria-hidden="true" data-testid={fileInputTestid} bind:this={fileInput} onchange={(e) => picked(e.currentTarget)} />{/if}
			{/if}
			{#if recording}
				<span class="ap-composer-recording" role="status"><span class="ap-composer-recdot" aria-hidden="true"></span>Recording <span class="ap-composer-rectime">{recordingTime || '0:00'}</span></span>
			{:else}
				{#if cmd}<span class="ap-composer-cmdtag" data-testid={commandTestid} title="Sent to the server, not posted">Command</span>{/if}
				{#if live}<span class="ap-composer-cmdtag ap-composer-livetag" data-testid={liveTestid} title="Everyone sees this message as you type it; Send finishes it"><span class="ap-composer-livedot" aria-hidden="true"></span>Live</span>{/if}
				{#if field}{@render field(fieldArgs)}
				{:else}
					<textarea rows="1" dir="auto" placeholder={ph} {disabled} aria-label={cmd ? 'Command' : 'Message'} class={['ap-composer-field', className]} bind:value={() => value, (v) => { value = v; oninput?.(v); }}></textarea>
				{/if}
			{/if}
			{#if onemoji || expandable}
				<span class="ap-composer-tools ap-composer-tools-end">
					{#if expandable}
						<!-- Flashes as it appears (ap-composer-expand), so the way to more room is noticed. -->
						<button type="button" class="ap-iconbtn ap-composer-expand" data-testid={expandTestid} aria-label="Expand composer" title="Expand to the full panel" onmousedown={(e) => e.preventDefault()} onclick={onexpand}>
							<Maximize size={16} aria-hidden="true" />
						</button>
					{/if}
					{#if onemoji}
						<button type="button" class={['ap-iconbtn', emojiOpen && 'ap-iconbtn-on']} data-testid={emojiTestid} aria-label="Insert emoji" title="Insert emoji" aria-haspopup="dialog" aria-expanded={!!emojiOpen} disabled={disabled || recording} bind:this={emojiButton} onclick={onemoji}>
							<Smile size={18} aria-hidden="true" />
						</button>
					{/if}
				</span>
			{/if}
			{#if expanded && sendKeys?.length && !recording}<span class="ap-composer-keys">{#each sendKeys as key, index (index)}<kbd>{key}</kbd>{/each} to send</span>{/if}
			<!-- Pressing Send leaves the focus in the field, so a phone's keyboard stays up between messages rather than dropping and coming back. -->
			<Button type="submit" size="sm" variant="primary" class={waitLeft > 0 ? 'ap-composer-wait' : undefined} data-testid={sendTestid} onmousedown={(e) => e.preventDefault()} aria-label={waitLeft > 0 ? `Send again in ${waitWords(waitLeft, waitLeft >= LONG_WAIT_MS)}` : cmd ? 'Run command' : 'Send message'} disabled={disabled || recording || !sendable || waitLeft > 0}>
				{#snippet children()}{#if waitLeft > 0}<Hourglass size={14} aria-hidden="true" />{waitLabel(waitLeft, waitLeft >= LONG_WAIT_MS)}{:else}{cmd ? 'Run' : 'Send'}{/if}{/snippet}
			</Button>
		</form>
	</div>
</div>
