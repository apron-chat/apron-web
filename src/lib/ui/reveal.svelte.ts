import { tick } from 'svelte';

/**
 * Renders a long timeline newest-first: all but the oldest `hidden` items
 * paint at once, and the older ones follow a chunk per frame after that, so
 * opening a room shows it without waiting for its whole history to render.
 */
export class ProgressiveReveal<Place = void> {
	/** Oldest items not rendered yet. */
	hidden = $state(0);
	private frame = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * `place` notes where the reader is before each chunk lands above; `revealed`
	 * runs once it has, with that note, to keep their place.
	 */
	constructor(
		private readonly chunk: number,
		private readonly place: () => Place,
		private readonly revealed: (before: Place) => void
	) {}

	/** Renders from `hidden` items in, then reveals the older ones after each paint. */
	from(hidden: number): void {
		this.stop();
		this.hidden = Math.max(0, hidden);
		if (this.hidden > 0) this.schedule();
	}

	/** Renders `count` more of the oldest hidden items now, rather than after a paint: to fill the list before it paints. */
	more(count: number): void {
		this.hidden = Math.max(0, this.hidden - count);
		if (this.hidden === 0) this.stop();
	}

	stop(): void {
		if (this.frame) cancelAnimationFrame(this.frame);
		if (this.timer) clearTimeout(this.timer);
		this.frame = 0;
		this.timer = undefined;
	}

	private schedule(): void {
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.timer = setTimeout(() => void this.revealChunk(), 0);
		});
	}

	private async revealChunk(): Promise<void> {
		this.timer = undefined;
		const before = this.place();
		this.hidden = Math.max(0, this.hidden - this.chunk);
		if (this.hidden > 0) this.schedule();
		await tick();
		this.revealed(before);
	}
}
