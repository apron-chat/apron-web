<script module lang="ts">
	/**
	 * The design system's icons drawn as static markup, each one of lucide's (ISC) under its lucide name (camelCased,
	 * `squareCheckBig` for `square-check-big`), copied from @lucide/svelte's data: where an icon is drawn often (a toolbar
	 * built as the pointer crosses each row, each thread's lines, each room's description) or plainly, a static `<svg>`
	 * is only cloned, where lucide's components work out every attribute of every one. The only place an icon's shapes
	 * are written: anywhere else, an icon is one of these or lucide's own component, so the two can't drift apart
	 * (Icons.test.ts checks each against lucide's data, and that no other component draws one).
	 *
	 * Each is an `.ap-icon`: its stroke from apron.css, its size `--ap-icon-size` (16px unless where it sits says so, as
	 * `--ap-icon-stroke` says its stroke), and hidden from assistive tech: what holds it names it.
	 */
	export { check, chevronLeft, chevronRight, copy, cornerDownRight, download, ellipsis, externalLink, file, link, lock, messageSquarePlus, pencil, reply, smilePlus, squareCheckBig, textAlignStart, trash, unlink, x };
</script>

{#snippet check()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>{/snippet}
{#snippet chevronLeft()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>{/snippet}
{#snippet chevronRight()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>{/snippet}
{#snippet copy()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>{/snippet}
{#snippet cornerDownRight()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 10 5 5-5 5" /><path d="M4 4v7a4 4 0 0 0 4 4h12" /></svg>{/snippet}
{#snippet download()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /></svg>{/snippet}
{#snippet ellipsis()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>{/snippet}
{#snippet externalLink()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>{/snippet}
{#snippet file()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /></svg>{/snippet}
{#snippet link()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>{/snippet}
{#snippet lock()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>{/snippet}
{#snippet messageSquarePlus()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /><path d="M12 8v6" /><path d="M9 11h6" /></svg>{/snippet}
{#snippet pencil()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></svg>{/snippet}
{#snippet reply()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 18v-2a4 4 0 0 0-4-4H4" /><path d="m9 17-5-5 5-5" /></svg>{/snippet}
{#snippet smilePlus()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.267 2.08a10 10 0 108.653 8.653" /><path d="M15 10V9" /><path d="M16 5h6" /><path d="M16.472 15a6 6 0 01-8.943 0" /><path d="M19 2v6" /><path d="M9 10V9" /></svg>{/snippet}
{#snippet squareCheckBig()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344" /><path d="m9 11 3 3L22 4" /></svg>{/snippet}
{#snippet textAlignStart()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 5H3" /><path d="M15 12H3" /><path d="M17 19H3" /></svg>{/snippet}
{#snippet trash()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>{/snippet}
{#snippet unlink()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" /><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" /><line x1="8" x2="8" y1="2" y2="5" /><line x1="2" x2="5" y1="8" y2="8" /><line x1="16" x2="16" y1="19" y2="22" /><line x1="19" x2="22" y1="16" y2="16" /></svg>{/snippet}
{#snippet x()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>{/snippet}
