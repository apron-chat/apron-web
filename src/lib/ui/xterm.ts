/**
 * xterm.js, the terminal emulator `terminal` embeds render with (§4.8.6),
 * with its stylesheet: loaded the first time a terminal embed is shown, in a
 * chunk of its own, so nothing else pays for it.
 */
export type Xterm = typeof import('@xterm/xterm');

let loading: Promise<Xterm> | undefined;

export function loadXterm(): Promise<Xterm> {
	loading ??= Promise.all([import('@xterm/xterm'), import('@xterm/xterm/css/xterm.css')]).then(
		([xterm]) => xterm,
		(error: unknown) => {
			// Let the next terminal try again, such as after a deploy replaced the chunk.
			loading = undefined;
			throw error;
		}
	);
	return loading;
}
