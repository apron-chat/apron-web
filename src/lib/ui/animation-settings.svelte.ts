import { ANIMATIONS_KEY, loadAnimations, saveAnimations } from './storage';

/**
 * Whether animated images play by themselves (Preferences' Media): GIFs and the like in the timeline, and custom
 * emoji with a still copy. One that doesn't play shows its first frame, and its Play button plays it.
 * - `system`: unless the device asks for reduced motion (`prefers-reduced-motion: reduce`).
 * - `always`, `never`: whatever the device asks.
 */
export const ANIMATION_MODES = [
	{ value: 'system', label: 'Unless reduced motion is on' },
	{ value: 'always', label: 'Always' },
	{ value: 'never', label: 'Never' }
] as const;

export type AnimationMode = (typeof ANIMATION_MODES)[number]['value'];

function modeOf(value: unknown): AnimationMode {
	return value === 'always' || value === 'never' ? value : 'system';
}

export class AnimationSettings {
	mode = $state<AnimationMode>('system');
	/** The device asks for reduced motion. */
	reducedMotion = $state(false);

	constructor() {
		const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
		if (query) {
			this.reducedMotion = query.matches;
			query.addEventListener?.('change', (event) => (this.reducedMotion = event.matches));
		}
	}

	/** Whether animated images play by themselves, as chosen. */
	get autoplay(): boolean {
		return this.mode === 'system' ? !this.reducedMotion : this.mode === 'always';
	}

	load(): void {
		this.mode = modeOf(loadAnimations());
	}

	/** Another tab changed `key` in storage: what it chose holds here too. */
	storageChanged(key: string | null): void {
		if (key === ANIMATIONS_KEY || key === null) this.load();
	}

	set(mode: string): void {
		this.mode = modeOf(mode);
		saveAnimations(this.mode === 'system' ? undefined : this.mode);
	}
}

export const animationSettings = new AnimationSettings();

/** Types that can hold more than one frame, which a still can be taken of. WebP and PNG usually hold one, so only an APNG named as one counts. */
const ANIMATED_TYPES = new Set(['image/gif', 'image/apng']);

/**
 * Whether an image may be animated, from its `type`, else from its URL's or file name's extension (`.gif`, `.apng`).
 * An animated WebP or PNG not named as one isn't told apart from a still one: its bytes say so, and an image from
 * another site can't be read.
 */
export function mayAnimate(image: { type?: string; url?: string } | undefined, name?: string): boolean {
	if (!image) return false;
	if (image.type) return ANIMATED_TYPES.has(image.type.toLowerCase());
	if (image.url && /^data:image\/(gif|apng)[;,]/i.test(image.url)) return true;
	const extension = /\.(gif|apng)$/i;
	let path = '';
	try {
		path = image.url ? new URL(image.url).pathname : '';
	} catch {
		// Not a URL: the name, if any, decides.
	}
	return extension.test(path) || (!!name && extension.test(name));
}
