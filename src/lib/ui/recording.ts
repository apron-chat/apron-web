/**
 * What the composer records: a voice clip from the microphone, the screen (a
 * tab, window or display the browser asks for), or the camera with sound.
 * Each is recorded with `MediaRecorder` and attached as a file.
 */
import { UPLOAD_MAX_BYTES } from './images';

export type RecordingKind = 'voice' | 'screen' | 'camera';

/**
 * Bitrates sized to the upload limit. Voice: plenty for speech in Opus or AAC,
 * about 240 KB a minute. Screen: mostly still text at a low frame rate, about
 * 3.75 MB a minute. Camera: a small face at 15 fps, with voice-quality sound.
 */
export const RECORDING_BITRATES: Record<RecordingKind, { audioBitsPerSecond?: number; videoBitsPerSecond?: number }> = {
	voice: { audioBitsPerSecond: 32_000 },
	screen: { videoBitsPerSecond: 500_000 },
	camera: { videoBitsPerSecond: 300_000, audioBitsPerSecond: 32_000 }
};

/**
 * A recording stops by itself at this size, a little under the upload limit:
 * its data comes once a second, and the last piece arrives after the stop.
 */
export const RECORDING_MAX_BYTES = Math.floor(UPLOAD_MAX_BYTES * 0.95);

/** What `getDisplayMedia` is asked for: legible text at a low frame rate, no sound. */
export const SCREEN_CONSTRAINTS: DisplayMediaStreamOptions = {
	video: { frameRate: { ideal: 10, max: 15 }, width: { max: 1920 }, height: { max: 1080 } },
	audio: false
};

/** What `getUserMedia` is asked for to record the camera. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
	video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } },
	audio: true
};

/** Video types to record, in order of preference: WebM (Chrome, Firefox), else MP4 (Safari). */
const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

/** The first video type this browser records, or undefined to leave it to the browser. */
export function videoType(supported: (type: string) => boolean = (type) => MediaRecorder.isTypeSupported(type)): string | undefined {
	return VIDEO_TYPES.find((type) => supported(type));
}

/** The file name for a recording of this type: Safari records MP4, Firefox Ogg or WebM, Chrome WebM. */
export function recordingName(kind: RecordingKind, type: string): string {
	const base = kind === 'voice' ? 'voice-message' : kind === 'screen' ? 'screen-recording' : 'video-message';
	if (type.includes('mp4')) return `${base}.${kind === 'voice' ? 'm4a' : 'mp4'}`;
	if (type.includes('ogg')) return `${base}.ogg`;
	return `${base}.webm`;
}

/** The type to label a finished recording with, when the recorder names none. */
export function fallbackType(kind: RecordingKind): string {
	return kind === 'voice' ? 'audio/webm' : 'video/webm';
}

/** What this browser can record. Phones can't capture the screen, so they have no `getDisplayMedia`. */
export function recordingSupport(media: Partial<MediaDevices> | undefined = globalThis.navigator?.mediaDevices): Record<RecordingKind, boolean> {
	const recorder = typeof MediaRecorder !== 'undefined';
	const user = recorder && typeof media?.getUserMedia === 'function';
	return { voice: user, camera: user, screen: recorder && typeof media?.getDisplayMedia === 'function' };
}
