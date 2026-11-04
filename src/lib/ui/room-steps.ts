/**
 * Alt+↑/↓ through the rooms list (`+page.svelte`'s windowKeydown): its rows as drawn, so the order is the one on
 * screen, threads under their room and folded sections left out. The rows stepped through are the joined rooms and
 * threads (`data-room`, `data-thread`), the threads listed to read without joining (`data-other-thread`: opening one
 * joins nothing), and the open one whatever it is; a room listed to join (`data-join`) is passed over, since picking
 * it would join it.
 */
const ROWS = 'button.ap-room:is([data-room], [data-thread], [data-other-thread], [aria-current="page"])';

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
