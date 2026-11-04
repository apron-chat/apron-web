/**
 * Alt+↑/↓ through the rooms list (`+page.svelte`'s windowKeydown): its rows as drawn, so the order is the one on
 * screen, threads under their room and folded sections left out. Every room and thread row is stepped through: the
 * joined ones (`data-room`, `data-thread`), the threads listed to read without joining (`data-other-thread`), and the
 * rooms listed to join (`data-join`), which the caller opens to read rather than joining, as picking the row would.
 * The rest of the list (a section's "more…", its +) isn't a room.
 */
const ROWS = 'button.ap-room:is([data-room], [data-thread], [data-other-thread], [data-join], [aria-current="page"])';

/**
 * The row `step` places after the open one (-1 before), or with `unread` the nearest that way with news (`ap-room-unread`:
 * unread and not muted), going round the end. With no row open, the first (or last). Undefined at the end of the list,
 * or with no news elsewhere.
 */
export function nextRoomRow(list: ParentNode, step: 1 | -1, unread = false): HTMLElement | undefined {
	const rows = [...list.querySelectorAll<HTMLElement>(ROWS)];
	const at = rows.findIndex((row) => row.getAttribute('aria-current') === 'page');
	if (!unread) return at < 0 ? rows.at(step > 0 ? 0 : -1) : rows[at + step];
	const from = at >= 0 ? at : step > 0 ? -1 : rows.length;
	for (let n = 1; n <= rows.length; n++) {
		const index = (((from + step * n) % rows.length) + rows.length) % rows.length;
		if (index !== at && rows[index].classList.contains('ap-room-unread')) return rows[index];
	}
	return undefined;
}
