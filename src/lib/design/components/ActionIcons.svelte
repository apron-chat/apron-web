<script module lang="ts">
	/**
	 * The message toolbar's icons, drawn from lucide's (ISC): static markup, so a toolbar built as the pointer crosses
	 * each row only clones them, where lucide's components work out every attribute of every one. Each takes its stroke
	 * from `.ap-icon` and its size from where it sits (apron.css), and is hidden from assistive tech: its button names it.
	 */
	export { check, copy, ellipsis, link, pencil, reply, smilePlus, squareCheck, thread, trash, unlink };
</script>

{#snippet smilePlus()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.267 2.08a10 10 0 1 0 8.653 8.653" /><path d="M15 10V9" /><path d="M16 5h6" /><path d="M16.472 15a6 6 0 0 1-8.943 0" /><path d="M19 2v6" /><path d="M9 10V9" /></svg>{/snippet}
{#snippet reply()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 18v-2a4 4 0 0 0-4-4H4" /><path d="m9 17-5-5 5-5" /></svg>{/snippet}
{#snippet thread()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" /><path d="M12 8v6" /><path d="M9 11h6" /></svg>{/snippet}
{#snippet pencil()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></svg>{/snippet}
{#snippet squareCheck()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344" /><path d="m9 11 3 3L22 4" /></svg>{/snippet}
{#snippet link()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>{/snippet}
{#snippet copy()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>{/snippet}
{#snippet trash()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>{/snippet}
{#snippet unlink()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" /><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" /><path d="M8 2v3" /><path d="M2 8h3" /><path d="M16 19v3" /><path d="M19 16h3" /></svg>{/snippet}
{#snippet check()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>{/snippet}
{#snippet ellipsis()}<svg class="ap-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>{/snippet}
