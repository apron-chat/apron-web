/**
 * Alt+↑/↓ through the rooms list (`+page.svelte`'s windowKeydown): its rows as drawn, so the order is the one on
 * screen, threads under their room and folded sections left out. Every room and thread row is stepped through: the
 * joined ones (`data-room`, `data-thread`), the threads listed to read without joining (`data-other-thread`), and the
 * rooms listed to join (`data-join`): picking any of those reads it without joining.
 * The rest of the list (a section's "more…", its +) isn't a room.
 */
const ROWS = 'button.ap-room:is([data-room], [data-thread], [data-other-thread], [data-join], [aria-current="page"])';

/** A room's row, not a thread's: joined (`data-room`) or listed to join (`data-join`). */
const isRoom = (row: HTMLElement) => row.dataset.room !== undefined || row.dataset.join !== undefined;

/**
 * The row `step` places after the open one (-1 before), or with `rooms` the nearest room that way, past any threads
 * (from a thread, the room it's under going up). With no row open, the first (or last). Undefined at the end of the
 * list.
 */
export function nextRoomRow(list: ParentNode, step: 1 | -1, rooms = false): HTMLElement | undefined {
	const rows = [...list.querySelectorAll<HTMLElement>(ROWS)];
	const at = rows.findIndex((row) => row.getAttribute('aria-current') === 'page');
	for (let index = at < 0 ? (step > 0 ? 0 : rows.length - 1) : at + step; index >= 0 && index < rows.length; index += step) {
		if (!rooms || isRoom(rows[index])) return rows[index];
	}
	return undefined;
}
