import { tick } from 'svelte';

/**
 * Renders a long timeline newest-first: all but the oldest `hidden` items
 * paint at once, and the older ones follow a chunk per frame after that, so
 * opening a room shows it without waiting for its whole history to render.
 */
export class ProgressiveReveal {
	/** Oldest items not rendered yet. */
	hidden = $state(0);
	private frame = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * `scroller` is the list the items render into; `revealed` runs after each
	 * chunk lands above, with that list and its scroll top and height from
	 * before, to keep the reader's place.
	 */
	constructor(
		private readonly chunk: number,
		private readonly scroller: () => HTMLElement | undefined,
		private readonly revealed: (scroller: HTMLElement | undefined, top: number, height: number) => void
	) {}

	/** Renders from `hidden` items in, then reveals the older ones after each paint. */
	from(hidden: number): void {
		this.stop();
		this.hidden = Math.max(0, hidden);
		if (this.hidden > 0) this.schedule();
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
		const scroller = this.scroller();
		const height = scroller?.scrollHeight ?? 0;
		const top = scroller?.scrollTop ?? 0;
		this.hidden = Math.max(0, this.hidden - this.chunk);
		if (this.hidden > 0) this.schedule();
		await tick();
		this.revealed(scroller, top, height);
	}
}
