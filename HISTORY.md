# History

What changed in Apron for the people using it, a week at a time, newest first.

<!--
To update: run `git fetch --unshallow origin` if the clone is shallow, then read
this file and find the newest week below. Summarize every commit that landed on
origin/main since then, as main records it:
`git log --first-parent --reverse --format='%h %cd %s' --date=short --since=<monday> origin/main`.
A merge commit counts as one change; read it with `git diff <hash>^1 <hash>`.
Add new weeks above the old ones. Don't edit past weeks unless an entry is wrong.

Don't trust commit messages and PR descriptions alone: they can describe plans
that changed or miss work added in later commits. Check each commit's diff
(`git show --stat <hash>`, then the files that matter) to see what actually
shipped. Where a message and its diff disagree, write from the diff. If a later
commit in the same week reverts or reworks an earlier one, describe how it ended up.

Weeks start Monday: `## Week of 2026-11-16`. Skip a week if nothing in it qualifies.
The first week (2026-09-21) starts with the web client imported from shazow/apron
(#1): open it with a short paragraph on what Apron could do then, then list the
rest of that week as usual.

Write for someone who uses Apron, not someone who works on its code. Name the
feature as users see it ("the document viewer", not "DocViewer"). Write one line
per entry and end it with its PR numbers, like (#256, #257), or with the short
commit hash when a commit has no PR number. If several PRs built one feature,
give it one entry.

Order within a week:
1. **New feature:** something users can now do that they couldn't before.
2. **Changed:** existing behaviour that works differently now, or a breaking
   change: something a user has to relearn, set again or upgrade. Say what to do
   if anything.
3. **Removed:** something users could do before and can't now.
4. **Improved:** a substantial gain in UX, accessibility, reliability, speed
   users would notice, privacy or security.
5. **Fixed:** a bug that users would have noticed or reported, such as lost
   drafts, a stuck sign-in or wrong data. Leave out flaky tests and fixes for
   bugs that never shipped.

Mark protocol or server-compatibility changes with **Requires server protocol vN**.

Leave out styling tweaks (pixel sizes, spacing, corners), refactors, tests, CI,
perf-budget updates, dependency bumps and follow-up review fixes. If you can't
tell whether a user would notice a change, leave it out. Aim for 3–8 entries a
week.
-->
