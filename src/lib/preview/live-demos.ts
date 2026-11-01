/**
 * The canned live text the preview plays where a real server would take a
 * `PUT` (`/embed-terminal`, `/embed-append`): a test run in a terminal, with
 * what a terminal has to get right (16, 256 and true colors, a progress bar
 * redrawn with carriage returns, box drawing, lines rewritten by moving the
 * cursor, and escapes that must do nothing: a title, the clipboard, a link,
 * the bell), and a Markdown reply that streams in as a model would write it,
 * cut at arbitrary bytes, mid-character included, and revises itself: a
 * placeholder a form feed clears, and a typo backspaces correct (§4.8.5).
 */

/** One write: `data` after `wait` milliseconds. */
export interface DemoStep {
	wait: number;
	data: string | Uint8Array;
}

const ESC = '\u001b';
const CSI = `${ESC}[`;
const reset = `${CSI}0m`;
const sgr = (codes: string) => `${CSI}${codes}m`;
/** How many cells a line takes: its characters, less its SGR sequences. */
const cells = (text: string) => Array.from(text.replace(/\u001b\[[0-9;]*m/g, '')).length;
/** A box the full 80 columns wide, `left` and `right` inside it. */
const box = (left: string, right: string) =>
	`${CSI}2m┌${'─'.repeat(78)}┐${reset}\r\n${CSI}2m│${reset} ${left}${' '.repeat(76 - cells(left) - cells(right))}${right} ${CSI}2m│${reset}\r\n${CSI}2m└${'─'.repeat(78)}┘${reset}\r\n`;

/** A row of the 6×6×6 color cube's hues, as 256-color backgrounds. */
function cubeRow(): string {
	const hues = [196, 202, 208, 214, 220, 226, 190, 154, 118, 82, 46, 47, 48, 49, 50, 51, 45, 39, 33, 27, 21, 57, 93, 129, 165, 201, 200, 199, 198, 197];
	return hues.map((color) => `${sgr(`48;5;${color}`)}  `).join('') + reset;
}

/** A true-color ramp, 60 cells from denim to rust. */
function ramp(): string {
	let cells = '';
	for (let i = 0; i < 60; i++) {
		const t = i / 59;
		const [r, g, b] = [Math.round(0x8f + (0xf2 - 0x8f) * t), Math.round(0xb0 + (0x8a - 0xb0) * t), Math.round(0xf5 + (0x3c - 0xf5) * t)];
		cells += `${sgr(`48;2;${r};${g};${b}`)} `;
	}
	return cells + reset;
}

const packages = [
	['store', '0.41s', '42'],
	['protocol', '1.07s', '61'],
	['http', '0.63s', '25']
] as const;

function bar(percent: number): string {
	const filled = Math.round(percent / 5);
	return `\r  coverage ${sgr('36')}${'█'.repeat(filled)}${sgr('2')}${'░'.repeat(20 - filled)}${reset} ${String(percent).padStart(3)}%`;
}

export const TERMINAL_DEMO: readonly DemoStep[] = [
	// A window title, the clipboard (OSC 52) and the bell: a reader's page must do none of them.
	{ wait: 200, data: `${ESC}]0;make test${'\u0007'}${ESC}]52;c;aGVsbG8gZnJvbSB0aGUgdGVybWluYWw=${'\u0007'}\u0007${sgr('1')}$ make test${reset}\r\n` },
	{ wait: 300, data: box(`${sgr('1')}apron${reset} test run`, `${sgr('2')}80×40 · ANSI demo${reset}`) },
	{ wait: 250, data: packages.map(([name]) => `  ${sgr('33')}…${reset} ${name.padEnd(10)} ${sgr('2')}running${reset}\r\n`).join('') },
	// Each package finishes in place: the cursor goes up to its line, rewrites it, and comes back down.
	...packages.map(([name, time, tests], index): DemoStep => {
		const up = packages.length - index;
		return { wait: 600, data: `${CSI}${up}A\r${CSI}2K  ${sgr('32')}✓${reset} ${name.padEnd(10)} ${sgr('32')}ok${reset}  ${tests} tests  ${sgr('2')}${time}${reset}${CSI}${up}B\r` };
	}),
	...[0, 10, 25, 40, 55, 70, 85, 100].map((percent): DemoStep => ({ wait: 220, data: bar(percent) })),
	{ wait: 200, data: '\r\n\r\n' },
	{ wait: 200, data: `  16 colors  ${[30, 31, 32, 33, 34, 35, 36, 37].map((code) => `${sgr(String(code))}██`).join('')}${[90, 91, 92, 93, 94, 95, 96, 97].map((code) => `${sgr(String(code))}██`).join('')}${reset}\r\n` },
	{ wait: 200, data: `  256 colors ${cubeRow()}\r\n` },
	{ wait: 200, data: `  true color ${ramp()}\r\n` },
	{ wait: 200, data: `  ${sgr('1')}bold${reset} ${sgr('2')}dim${reset} ${sgr('3')}italic${reset} ${sgr('4')}underline${reset} ${sgr('7')}inverse${reset} ${sgr('9')}struck${reset}  ${ESC}]8;;https://example.com/report${ESC}\\a link that opens nothing${ESC}]8;;${ESC}\\\r\n\r\n` },
	{ wait: 400, data: `${sgr('1;32')}PASS${reset} 3 packages, 128 tests, 0 failures ${sgr('2')}in 2.11s${reset}\r\n` }
];

const REPLY_START = [
	'Here is the plan for the rollback, step by step:\n\n',
	'1. **Roll back** the `orders_idx` migration with `./migrate down 0042`.\n',
	'2. Renew the runner’s cert — it expired at 02:00 UTC, so every deploy since then faield'
].join('');

const REPLY_END = [
	'.\n',
	'3. Re-run the deploy, and watch the p99 latency on the dashboard.\n\n',
	'```sh\n./migrate down 0042\nkubectl rollout undo deploy/api\n```\n\n',
	'| Step | Owner | ETA |\n| :-- | :-- | --: |\n| Roll back | Ada | 5 min |\n| Renew cert | Margaret | 10 min |\n\n',
	'> If the index rebuild is still running, wait for it: ~~killing it~~ cancelling it leaves the table locked.\n\n',
	'That should do it. 🚀 Ping me if anything looks off — I’ll keep an eye on #general.'
].join('');

/** Text cut at bytes 3 to 9 long, the same cuts every time, so characters (`’`, `—`, `🚀`) are split across writes. */
function cuts(text: string): DemoStep[] {
	const bytes = new TextEncoder().encode(text);
	const steps: DemoStep[] = [];
	let seed = 7;
	for (let at = 0; at < bytes.length;) {
		seed = (seed * 31 + 11) % 97;
		const size = 3 + (seed % 7);
		steps.push({ wait: 40, data: bytes.slice(at, at + size) });
		at += size;
	}
	return steps;
}

export const APPEND_DEMO: readonly DemoStep[] = [
	// A placeholder, then a form feed: the reply replaces it (the message's own text stays).
	{ wait: 200, data: '_Looking at the deploy logs…_' },
	{ wait: 1200, data: '\f' },
	...cuts(REPLY_START),
	// A typo, left a moment, then corrected: each backspace removes the character before it.
	{ wait: 700, data: '\b\b\bled' },
	...cuts(REPLY_END)
];
