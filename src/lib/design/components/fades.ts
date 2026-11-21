import type { Attachment } from 'svelte/attachments';

/**
 * Fades a box's edges where its content is cut off, so the cut says there's more: its foot while more is below
 * (`ap-fade-below`), its top while it is scrolled past the start (`ap-fade-above`). For a box that clips (a preview's
 * first lines) or scrolls (a description read in full). `onclip` hears whether anything is cut off at all, as it changes.
 *
 * Measured as a ResizeObserver reports the box and its content (after the browser has laid the frame out) and as it
 * scrolls, so reading the sizes never lays the page out early; the classes land before that frame paints.
 */
export function fades(onclip?: (clipped: boolean) => void): Attachment<HTMLElement> {
	return (box) => {
		let clipped: boolean | undefined;
		const measure = (): void => {
			const below = box.scrollTop + box.clientHeight < box.scrollHeight - 1;
			const above = box.scrollTop > 1;
			box.classList.toggle('ap-fade-below', below);
			box.classList.toggle('ap-fade-above', above);
			const now = below || above;
			if (now !== clipped) {
				clipped = now;
				onclip?.(now);
			}
		};
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(measure);
		observer.observe(box);
		for (const child of box.children) observer.observe(child);
		box.addEventListener('scroll', measure, { passive: true });
		return () => {
			observer.disconnect();
			box.removeEventListener('scroll', measure);
		};
	};
}
