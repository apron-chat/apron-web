import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorder, type Microphone } from './voice-recorder.svelte';

/** A stream whose tracks say whether they were stopped. */
function fakeStream(): MediaStream & { stopped: () => boolean } {
	const track = { stop: vi.fn() };
	return { getTracks: () => [track], stopped: () => track.stop.mock.calls.length > 0 } as unknown as MediaStream & { stopped: () => boolean };
}

/** A recorder that hands over one chunk when stopped. */
class FakeRecorder {
	state: 'inactive' | 'recording' = 'inactive';
	mimeType = 'audio/webm';
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void) | null = null;
	start(): void {
		this.state = 'recording';
	}
	stop(): void {
		if (this.state !== 'recording') return;
		this.state = 'inactive';
		this.ondataavailable?.({ data: new Blob(['clip'], { type: 'audio/webm' }) });
		this.onstop?.();
	}
}

/** A microphone the test grants (`grant`) or refuses (`deny`), one ask at a time, counting what it recorded. */
function microphone() {
	const asks: Array<{ resolve: (stream: MediaStream) => void; reject: (cause: unknown) => void }> = [];
	const recorders: FakeRecorder[] = [];
	const mic: Microphone = {
		open: () => new Promise((resolve, reject) => asks.push({ resolve, reject })),
		record: () => {
			const recorder = new FakeRecorder();
			recorders.push(recorder);
			return recorder as unknown as MediaRecorder;
		}
	};
	return {
		mic,
		recorders,
		asks: () => asks.length,
		async grant(stream: MediaStream = fakeStream()) {
			asks.shift()!.resolve(stream);
			await Promise.resolve();
			await Promise.resolve();
			return stream;
		},
		async deny() {
			asks.shift()!.reject(new DOMException('Denied', 'NotAllowedError'));
			await Promise.resolve();
			await Promise.resolve();
		}
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('VoiceRecorder', () => {
	it('asks for the microphone, records, and hands over the clip once stopped', async () => {
		const { mic, grant } = microphone();
		const recorder = new VoiceRecorder(mic);
		const clips: File[] = [];
		void recorder.start({}, (clip) => clips.push(clip));
		expect(recorder.phase).toBe('asking');
		const stream = (await grant()) as ReturnType<typeof fakeStream>;
		expect(recorder.phase).toBe('recording');
		vi.advanceTimersByTime(2_000);
		expect(recorder.seconds).toBe(2);
		recorder.stop();
		expect(recorder.phase).toBe('idle');
		expect(clips.map((clip) => clip.name)).toEqual(['voice-message.webm']);
		expect(stream.stopped()).toBe(true);
	});

	it('starts one recording for a second tap while the browser asks', async () => {
		const { mic, grant, asks, recorders } = microphone();
		const recorder = new VoiceRecorder(mic);
		void recorder.start({}, () => undefined);
		void recorder.start({}, () => undefined);
		expect(asks()).toBe(1);
		await grant();
		expect(recorders).toHaveLength(1);
	});

	it('lets go of a microphone that arrives after a stop, recording nothing', async () => {
		const { mic, grant, recorders } = microphone();
		const recorder = new VoiceRecorder(mic);
		const clips: File[] = [];
		void recorder.start({}, (clip) => clips.push(clip));
		// The pane changes while the sheet is up.
		recorder.stop(false);
		expect(recorder.phase).toBe('idle');
		const stream = (await grant()) as ReturnType<typeof fakeStream>;
		expect(stream.stopped()).toBe(true);
		expect(recorders).toHaveLength(0);
		expect(recorder.phase).toBe('idle');
		vi.advanceTimersByTime(5_000);
		expect(recorder.seconds).toBe(0);
		expect(clips).toEqual([]);
	});

	it('goes back to idle when the microphone is refused, and can ask again', async () => {
		const { mic, deny, asks } = microphone();
		const recorder = new VoiceRecorder(mic);
		void recorder.start({}, () => undefined);
		await deny();
		expect(recorder.phase).toBe('idle');
		void recorder.start({}, () => undefined);
		expect(asks()).toBe(1);
	});

	it('discards a recording stopped without sending, and one shorter than a second', async () => {
		const { mic, grant } = microphone();
		const recorder = new VoiceRecorder(mic);
		const clips: File[] = [];
		void recorder.start({}, (clip) => clips.push(clip));
		await grant();
		vi.advanceTimersByTime(3_000);
		recorder.stop(false);
		void recorder.start({}, (clip) => clips.push(clip));
		await grant();
		recorder.stop();
		expect(clips).toEqual([]);
		expect(recorder.phase).toBe('idle');
	});
});
