// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORDING_MAX_BYTES } from '$lib/ui/recording';
import Composer from './Composer.svelte';

let instance: ReturnType<typeof mount> | undefined;

/** A recorder that records nothing until a test hands it data. */
class FakeRecorder {
	static made: FakeRecorder[] = [];
	static isTypeSupported = (type: string) => type === 'video/webm;codecs=vp9,opus';
	state: RecordingState = 'inactive';
	mimeType: string;
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void) | null = null;
	constructor(readonly stream: MediaStream, readonly options: MediaRecorderOptions) {
		this.mimeType = options.mimeType ?? 'audio/webm;codecs=opus';
		FakeRecorder.made.push(this);
	}
	start(): void { this.state = 'recording'; }
	stop(): void {
		this.state = 'inactive';
		this.onstop?.();
	}
	emit(bytes: number): void { this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) }); }
}

function fakeStream(video: boolean): MediaStream & { video?: EventTarget & { stop: () => void } } {
	const track = (kind: string) => Object.assign(new EventTarget(), { kind, stop: vi.fn() });
	const audio = track('audio');
	const picture = video ? track('video') : undefined;
	return { video: picture, getTracks: () => [audio, ...(picture ? [picture] : [])], getVideoTracks: () => (picture ? [picture] : []) } as unknown as MediaStream & { video?: EventTarget & { stop: () => void } };
}

function browser({ screen = true, camera = true, location = true } = {}) {
	vi.stubGlobal('MediaRecorder', FakeRecorder);
	const media = {
		getUserMedia: camera ? vi.fn(async (constraints: MediaStreamConstraints) => fakeStream(Boolean(constraints.video))) : undefined,
		getDisplayMedia: screen ? vi.fn(async () => fakeStream(true)) : undefined
	};
	Object.defineProperty(navigator, 'mediaDevices', { value: camera || screen ? media : undefined, configurable: true });
	const geolocation = { getCurrentPosition: vi.fn() };
	if (location) Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
	else delete (navigator as { geolocation?: unknown }).geolocation;
	return { media, geolocation };
}

function render(extra: Record<string, unknown> = {}) {
	const props = $state({
		value: '',
		placeholder: 'Message #general',
		disabled: false,
		canUpload: true,
		people: [],
		oninput: vi.fn(),
		onsend: vi.fn(),
		onfiles: vi.fn(),
		onproblem: vi.fn(),
		onunstage: vi.fn(),
		onrename: vi.fn(),
		oncancelreply: vi.fn(),
		...extra
	});
	instance = mount(Composer, { target: document.body, props });
	flushSync();
	return props;
}

const byLabel = (name: string) => [...document.querySelectorAll('button')].find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name);
const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];

async function choose(label: string): Promise<void> {
	byLabel('Attach')!.click();
	flushSync();
	await tick();
	menuItems().find((item) => item.textContent?.trim() === label)!.click();
	flushSync();
	for (let index = 0; index < 4; index += 1) await Promise.resolve();
	flushSync();
}

beforeEach(() => {
	FakeRecorder.made = [];
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	vi.useRealTimers();
	vi.unstubAllGlobals();
	delete (navigator as { mediaDevices?: unknown }).mediaDevices;
	delete (navigator as { geolocation?: unknown }).geolocation;
});

describe('Composer attach menu', () => {
	it('offers what the browser can do', async () => {
		browser();
		render();
		byLabel('Attach')!.click();
		flushSync();
		await tick();
		expect(menuItems().map((item) => item.textContent?.trim())).toEqual(['Upload a file', 'Record screen', 'Record video', 'Share location']);
	});

	it('leaves recordings out where uploads are images only, and is a plain paperclip with only files to offer', async () => {
		browser();
		render({ canUploadAudio: false });
		byLabel('Attach')!.click();
		flushSync();
		await tick();
		expect(menuItems().map((item) => item.textContent?.trim())).toEqual(['Upload a file', 'Share location']);
		unmount(instance!);
		document.body.innerHTML = '';
		browser({ screen: false, camera: false, location: false });
		instance = undefined;
		render();
		expect(byLabel('Attach')).toBeUndefined();
		expect(byLabel('Attach a file')).toBeDefined();
	});

	it('puts a shared location in the draft as a pin link, and says why when it can’t', async () => {
		const { geolocation } = browser();
		const props = render();
		await choose('Share location');
		const [success] = geolocation.getCurrentPosition.mock.calls[0];
		success({ coords: { latitude: 51.50072, longitude: -0.12462, accuracy: 18 } });
		flushSync();
		expect(props.value).toBe('📍 https://www.openstreetmap.org/?mlat=51.5007&mlon=-0.1246#map=17/51.5007/-0.1246 (within 20 m)');
		await choose('Share location');
		geolocation.getCurrentPosition.mock.calls[1][1]({ code: 3, PERMISSION_DENIED: 1 });
		expect(props.onproblem).toHaveBeenCalledWith('Unable to find your location');
	});

	it('records the screen until the browser’s Stop sharing, and attaches it', async () => {
		vi.useFakeTimers();
		const { media } = browser();
		const props = render();
		await choose('Record screen');
		expect(media.getDisplayMedia).toHaveBeenCalled();
		const recorder = FakeRecorder.made[0];
		expect(recorder.options).toMatchObject({ mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 500_000 });
		vi.advanceTimersByTime(2000);
		recorder.emit(1500);
		flushSync();
		expect(document.querySelector('[role="status"]')?.textContent).toMatch(/Recording screen\s*0:02 · 1 KB of 4.8 MB$/);
		expect(byLabel('Stop recording')).toBeDefined();
		(recorder.stream as ReturnType<typeof fakeStream>).video!.dispatchEvent(new Event('ended'));
		flushSync();
		const [files] = props.onfiles.mock.calls[0] as [File[]];
		expect(files[0].name).toBe('screen-recording.webm');
		expect(files[0].type).toBe('video/webm;codecs=vp9,opus');
		expect(files[0].size).toBe(1500);
		expect(document.querySelector('[role="status"]')).toBeNull();
	});

	it('stops a camera recording by itself before it outgrows an upload', async () => {
		vi.useFakeTimers();
		const { media } = browser();
		const props = render();
		await choose('Record video');
		expect(media.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true, video: expect.any(Object) }));
		vi.advanceTimersByTime(3000);
		FakeRecorder.made[0].emit(RECORDING_MAX_BYTES);
		flushSync();
		expect(FakeRecorder.made[0].state).toBe('inactive');
		expect((props.onfiles.mock.calls[0] as [File[]])[0][0].name).toBe('video-message.webm');
	});
});
