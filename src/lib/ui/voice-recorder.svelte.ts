/** Plenty for speech, in Opus or AAC: about 240 KB a minute, so a 5 MB upload holds 20 minutes. */
export const VOICE_BITS_PER_SECOND = 32_000;
/** A clip stops by itself at this share of the server's `max_bytes` for its type, the rest left for its last second. */
export const VOICE_LIMIT_SHARE = 0.95;

/** The file extension for a recorded clip's type: Safari records MP4, Firefox Ogg, Chrome WebM. */
export function voiceExtension(type: string): string {
	if (type.includes('mp4')) return 'm4a';
	if (type.includes('ogg')) return 'ogg';
	return 'webm';
}

/** What a clip is recorded as: the browser's own type without one, and the server's `max_bytes` for it, if it states one. */
export interface VoiceFormat {
	type?: string;
	maxBytes?: number;
}

/** Where the microphone comes from: the browser's, unless a test gives another. */
export interface Microphone {
	open(): Promise<MediaStream>;
	record(stream: MediaStream, options: MediaRecorderOptions): MediaRecorder;
}

const browserMicrophone: Microphone = {
	open: () => navigator.mediaDevices.getUserMedia({ audio: true }),
	record: (stream, options) => new MediaRecorder(stream, options)
};

/** One recording, from the tap that asked for the microphone to the clip, or nothing. */
interface Take {
	recorder?: MediaRecorder;
	timer?: ReturnType<typeof setInterval>;
}

/**
 * Recording a voice clip, in one of three phases: `idle`; `asking`, while the browser asks for the microphone (its
 * permission sheet, which can take a while); and `recording`, counting `seconds`. Each step goes from the phase
 * it is in, for the one take under way: a second tap while the sheet is up starts nothing, and a stop meanwhile
 * (the pane changing, the composer going) lets go of the microphone as soon as it arrives, recording nothing.
 */
export class VoiceRecorder {
	phase = $state<'idle' | 'asking' | 'recording'>('idle');
	seconds = $state(0);
	#take: Take | undefined;

	constructor(private readonly microphone: Microphone = browserMicrophone) {}

	/** Asks for the microphone and records, handing `onclip` the clip once stopped: none shorter than a second. */
	async start(format: VoiceFormat, onclip: (file: File) => void): Promise<void> {
		if (this.#take) return;
		const take: Take = {};
		this.#take = take;
		this.phase = 'asking';
		let stream: MediaStream;
		try {
			stream = await this.microphone.open();
		} catch {
			if (this.#take === take) this.#end();
			return;
		}
		if (this.#take !== take) {
			// Stopped while the browser asked: the microphone goes back unused.
			for (const track of stream.getTracks()) track.stop();
			return;
		}
		const chunks: Blob[] = [];
		let recorder: MediaRecorder;
		try {
			recorder = this.microphone.record(stream, { audioBitsPerSecond: VOICE_BITS_PER_SECOND, ...(format.type ? { mimeType: format.type } : {}) });
		} catch {
			// The browser won't record it (a type it refuses): the microphone goes back, and the next tap asks again.
			for (const track of stream.getTracks()) track.stop();
			this.#end();
			return;
		}
		take.recorder = recorder;
		this.seconds = 0;
		take.timer = setInterval(() => this.seconds++, 1000);
		this.phase = 'recording';
		let recorded = 0;
		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) chunks.push(event.data);
			recorded += event.data.size;
			// Under a stated limit, the clip comes in a slice a second, and stops itself short of the limit.
			if (format.maxBytes !== undefined && recorded >= format.maxBytes * VOICE_LIMIT_SHARE && recorder.state === 'recording') recorder.stop();
		};
		recorder.onstop = () => {
			for (const track of stream.getTracks()) track.stop();
			if (this.#take !== take) return;
			const seconds = this.seconds;
			this.#end();
			if (chunks.length === 0 || seconds < 1) return;
			const type = recorder.mimeType || chunks[0].type || 'audio/webm';
			onclip(new File(chunks, `voice-message.${voiceExtension(type)}`, { type }));
		};
		try {
			recorder.start(format.maxBytes === undefined ? undefined : 1000);
		} catch {
			for (const track of stream.getTracks()) track.stop();
			if (this.#take === take) this.#end();
		}
	}

	/** Stops the take under way: with `send`, its clip goes to `onclip`; without, or before it records, nothing does. */
	stop(send = true): void {
		const take = this.#take;
		if (!take) return;
		if (!send || !take.recorder) this.#end();
		take.recorder?.stop();
	}

	#end(): void {
		if (this.#take?.timer) clearInterval(this.#take.timer);
		this.#take = undefined;
		this.phase = 'idle';
		this.seconds = 0;
	}
}
