import { onDemand } from './on-demand';

/**
 * xterm.js, the terminal emulator `terminal` embeds render with (§4.8.6),
 * with its stylesheet: loaded the first time a terminal embed is shown, in a
 * chunk of its own, so nothing else pays for it.
 */
export type Xterm = typeof import('@xterm/xterm');

export const loadXterm: () => Promise<Xterm> = onDemand(() => Promise.all([import('@xterm/xterm'), import('@xterm/xterm/css/xterm.css')]).then(([xterm]) => xterm));

/**
 * The terminal screen (`terminal-screen.ts`), with xterm.js loading beside
 * it: like xterm, only once a terminal is shown, so the app starts without it.
 */
export function loadTerminalScreen(): Promise<typeof import('./terminal-screen')> {
	void loadXterm().catch(() => undefined);
	return import('./terminal-screen');
}
