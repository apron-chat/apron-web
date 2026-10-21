import { describe, expect, it } from 'vitest';
import { RECORDING_MAX_BYTES, recordingName, recordingSupport, videoType } from './recording';
import { UPLOAD_MAX_BYTES } from './images';

describe('recordings', () => {
	it('records WebM where it can, else MP4', () => {
		expect(videoType(() => true)).toBe('video/webm;codecs=vp9,opus');
		expect(videoType((type) => type === 'video/mp4')).toBe('video/mp4');
		expect(videoType(() => false)).toBeUndefined();
	});

	it('names a recording for what it is and how it was recorded', () => {
		expect(recordingName('voice', 'audio/webm;codecs=opus')).toBe('voice-message.webm');
		expect(recordingName('voice', 'audio/mp4')).toBe('voice-message.m4a');
		expect(recordingName('voice', 'audio/ogg;codecs=opus')).toBe('voice-message.ogg');
		expect(recordingName('screen', 'video/webm;codecs=vp9')).toBe('screen-recording.webm');
		expect(recordingName('camera', 'video/mp4;codecs=avc1')).toBe('video-message.mp4');
	});

	it('stops a little under the upload limit', () => {
		expect(RECORDING_MAX_BYTES).toBeLessThan(UPLOAD_MAX_BYTES);
		expect(RECORDING_MAX_BYTES).toBeGreaterThan(UPLOAD_MAX_BYTES * 0.9);
	});

	it('offers the screen only where the browser can capture it', () => {
		const original = globalThis.MediaRecorder;
		globalThis.MediaRecorder = class {} as unknown as typeof MediaRecorder;
		try {
			const fn = () => Promise.resolve(new EventTarget() as MediaStream);
			expect(recordingSupport({ getUserMedia: fn })).toEqual({ voice: true, camera: true, screen: false });
			expect(recordingSupport({ getUserMedia: fn, getDisplayMedia: fn })).toEqual({ voice: true, camera: true, screen: true });
			expect(recordingSupport(undefined)).toEqual({ voice: false, camera: false, screen: false });
		} finally {
			globalThis.MediaRecorder = original;
		}
	});
});
