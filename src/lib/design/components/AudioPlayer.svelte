<script lang="ts" module>
	/** The clip playing now, anywhere on the page: starting another pauses it, as two voices at once can't be followed. */
	let playing: HTMLAudioElement | undefined;

	/** The speeds the speed button steps through, then back to the first. */
	const RATES = [1, 1.5, 2];

	/** `m:ss`, or `h:mm:ss` past an hour. */
	export function clock(seconds: number): string {
		const whole = Math.max(0, Math.floor(seconds));
		const h = Math.floor(whole / 3600);
		const m = Math.floor((whole % 3600) / 60);
		const s = String(whole % 60).padStart(2, '0');
		return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
	}
</script>

<script lang="ts">
	/*
	 * A player for an audio clip, drawn in the design system's own controls rather than the browser's: play or pause,
	 * a bar to seek along, the time played and the clip's length, and a speed button (1×, 1.5×, 2×). Its parent shows
	 * what the clip is called. A clip whose length isn't known until it has been played through (a recording made in
	 * the browser) shows only the time played, and can't be sought along until then. A clip that can't be played (a
	 * format the browser doesn't know, or a URL that fails) says so, and its controls are disabled.
	 */
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import type { MediaSrc } from './types';

	interface Props {
		src?: MediaSrc;
		/** What the browser may fetch before Play: `none` for a message's clip, `metadata` for one on the draft. */
		preload?: 'none' | 'metadata';
		/** What the clip is, for its controls' labels. */
		label?: string;
	}
	let { src, preload = 'metadata', label = 'audio' }: Props = $props();

	let audio = $state<HTMLAudioElement | undefined>();
	let paused = $state(true);
	let time = $state(0);
	let duration = $state(Number.NaN);
	let rate = $state(1);
	/** The clip can't be played: the element reported an error, or refused to play it. */
	let failed = $state(false);

	let known = $derived(Number.isFinite(duration) && duration > 0);
	let progress = $derived(known ? Math.min(100, (time / duration) * 100) : 0);
	let shown = $derived(failed ? "Can't play" : known ? `${clock(time)} / ${clock(duration)}` : clock(time));

	// A new clip may play where the last one couldn't.
	$effect.pre(() => {
		void src;
		failed = false;
	});

	// The page's playing clip, if it was this one, is gone with it.
	$effect(() => {
		const element = audio;
		return () => {
			if (playing === element) playing = undefined;
		};
	});

	/* Read off the element as it reports, not through bind:, which brings in Svelte's media bindings at startup. */
	function sync(): void {
		if (!audio) return;
		paused = audio.paused;
		time = audio.currentTime;
		duration = audio.duration;
	}

	function toggle(): void {
		if (!audio) return;
		if (audio.paused) {
			void audio.play().catch((error: unknown) => {
				// An AbortError is a play cut short by a pause or a new clip, not a clip that can't play.
				if (!(error instanceof DOMException && error.name === 'AbortError')) failed = true;
			});
		}
		else audio.pause();
	}

	function onplay(): void {
		if (playing && playing !== audio && !playing.paused) playing.pause();
		playing = audio;
		sync();
	}

	function seek(event: Event & { currentTarget: HTMLInputElement }): void {
		if (!audio || !known) return;
		audio.currentTime = Number(event.currentTarget.value);
		sync();
	}

	function speed(): void {
		rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
		if (!audio) return;
		// The default too, which a new clip loads at.
		audio.defaultPlaybackRate = rate;
		audio.playbackRate = rate;
	}
</script>

<div class="ap-audio" class:ap-audio-playing={!paused}>
	<audio bind:this={audio} {src} {preload} {onplay} onpause={sync} onended={sync} ontimeupdate={sync} ondurationchange={sync} onloadedmetadata={sync} onemptied={sync} onerror={() => { failed = true; }} onratechange={() => { if (audio) rate = audio.playbackRate; }}></audio>
	<button type="button" class="ap-audio-play" aria-label={paused ? `Play ${label}` : `Pause ${label}`} title={paused ? 'Play' : 'Pause'} disabled={failed} onclick={toggle}>
		{#if paused}<Play size={16} fill="currentColor" aria-hidden="true" />{:else}<Pause size={16} fill="currentColor" aria-hidden="true" />{/if}
	</button>
	<input
		type="range"
		class="ap-audio-seek"
		min="0"
		max={known ? duration : 1}
		step="any"
		value={known ? time : 0}
		disabled={!known || failed}
		aria-label={`Seek ${label}`}
		aria-valuetext={shown}
		style:--audio-progress="{progress}%"
		oninput={seek}
	/>
	<span class="ap-audio-time">{shown}</span>
	<button type="button" class="ap-audio-rate" aria-label={`Playback speed ${rate}×`} title="Playback speed" disabled={failed} onclick={speed}>{rate}×</button>
</div>
