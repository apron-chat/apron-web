# History

What changed in Apron for the people using it, a week at a time, newest first.

<!--
To catch up: run `git fetch --unshallow origin` if the clone is shallow, then read
this file and find the newest week below. PRs usually add their own entry, so
check every commit that landed on origin/main from that week's Monday on, as
main records it, and add entries only for those that qualify but have none:
`git log --first-parent --reverse --format='%h %cd %s' --date=short --since=<monday> origin/main`.
A merge commit counts as one change; read it with `git diff <hash>^1 <hash>`.
Add new weeks above the old ones. Don't edit past weeks unless an entry is wrong.

From a PR: add the entry to the current week (start its section if there is
none) and link the PR once it has a number. If the week already has an entry for
the same feature, update that entry and add the link to it instead. A conflict
here with another PR is resolved by keeping both, merged into one entry if
they're about the same feature.

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
feature as users see it ("the document viewer", not "DocViewer"). Keep each
entry to one or two sentences and end it with links to its PRs, like
([#256](https://github.com/apron-chat/apron-web/pull/256), [#257](https://github.com/apron-chat/apron-web/pull/257)),
or to its commit (`.../commit/<hash>`) when a commit has no PR number. If several PRs
built one feature, give it one entry.

Lead with why the change matters, not what changed: the problem it solves or
what it lets people do, then how, briefly. Write "Extra tabs no longer use up a
server's connection limit: only one window connects at a time", not "Only one
window of a browser stays connected to a server". Take the reason from the
commit message, PR description or diff; don't invent one. If a change explains
itself, just state it.

Order within a week:
1. **New feature:** something users can now do that they couldn't before,
   including what was possible only in some setups and now works in more (another
   server, another client, another device). Name the setup. Judge by what users
   can do now, not by how a commit names it: a "fallback" can be a new feature.
2. **Changed:** something works differently, and someone used to the old way
   would trip over it or need to act: relearn a habit, find a control that
   moved, change a setting, re-bookmark, or update their server. Say what's
   different and what to do. If a change is both better and different, it's
   Changed: the label tells readers what needs their attention.
3. **Removed:** something users could do before and can't now.
4. **Improved:** it works the same way, only better: faster, more reliable,
   clearer, safer or more accessible. There's nothing to relearn.
5. **Fixed:** a bug that users would have noticed or reported, such as lost
   drafts, a stuck sign-in or wrong data. Leave out flaky tests and fixes for
   bugs that never shipped.

Mark protocol or server-compatibility changes with **Requires server protocol vN**.

Deciding what goes in. Include a change if any of these is true:
- A user would notice it in normal use without being told.
- A user has to do something about it: relearn a habit, change a setting,
  re-bookmark, or update their server.
- It changes what others can see or do: privacy, security, permissions, or what
  servers and other sites learn about you.
- It fixes a bug a user could have hit on main and might have reported.

Leave it out if:
- It only changes the look: sizes, spacing, corners, colours or wording.
- It polishes a feature from the same week: fold it into that entry instead.
- It fixes a bug that never reached main, or changes only tests, CI, tooling,
  refactors or dependencies.
- It's a speed-up that only shows up when measured. Include one users would
  feel, with the number.

When unsure, ask whether a regular user reading it would be glad to know, or
surprised that nobody told them. If neither, leave it out.

Aim for 3–8 entries a week; a week that shipped many features can have more.
-->

## Week of 2026-11-23

- **New feature:** Copy a message exactly as it was written, Markdown and all, with Copy text in its ⋯ menu below Copy link: you get `**0 errors**`, not just the "0 errors" it shows. Until now only the long-press menu on touch screens had it. ([#305](https://github.com/apron-chat/apron-web/pull/305))
- **New feature:** Sign in with a passkey that only a server's own sign-in page can find, such as one made before the server moved its passkeys to a new address. On servers that have such a page, when a passkey sign-in ends without a passkey, Apron asks "Didn’t find your passkey? Try on" that server, and the sign-in button becomes Continue on that server ↗. Pressing it opens the server's sign-in page; Cancel puts the form back, to try again in Apron. ([#309](https://github.com/apron-chat/apron-web/pull/309))
- **New feature:** Animated images no longer loop forever: a GIF that plays by itself holds still after 10 seconds, and an uploaded one has a Play / Pause button in its corner that plays it on until paused (a click on the picture still opens the image viewer, where it loops). Preferences → Media → Play animations chooses whether they play by themselves at all (System Default follows the device’s reduced motion setting, or Always, or Never); custom emoji with a still copy follow it too ([#323](https://github.com/apron-chat/apron-web/pull/323)).
- **Changed:** In the full-screen image viewer, the arrow keys move a zoomed-in image around, as they would scroll a page, instead of going to the next or previous image. To page while zoomed, hold Alt, Ctrl or ⌘ with ← or →, or keep pressing once the image reaches that edge. ([#306](https://github.com/apron-chat/apron-web/pull/306))
- **Changed:** Clearing a room's title or description works on protocol v10 servers, which keep whatever a room edit leaves out: Apron now sends only the fields you changed. On a server that hasn't been updated, changing a room's title or description clears the other, so update your server. **Requires server protocol v10** ([#310](https://github.com/apron-chat/apron-web/pull/310))
- **Changed:** Signing in again takes less reading, and the choice you've made is easy to see: on a server you've signed in to on this device before, its welcome starts folded to two lines with More and the passkey explanation stays away until something goes wrong, and the chosen sign-in method and Sign in or Create account are outlined in the accent, already set to the way you last used. Recent no longer lists the server you're signing in to and shows four servers until you press Show N more, and with a mouse a server's star and × appear only when you point at it. ([#313](https://github.com/apron-chat/apron-web/pull/313))
- **Changed:** Starting a thread on a message no longer opens with the message quoted in a description field, which people took for the thread's first message and wrote in: the form now asks only for a title, and Add description brings back the suggested quote if you want it. To write the first message in the form, press Add reply (Add first message when starting a thread from a room's +); it's sent once the thread opens, as a reply to the message if you started on one, and kept as the thread's draft if sending fails. A field's × puts it away again. ([#320](https://github.com/apron-chat/apron-web/pull/320))
- **Improved:** Once a passkey sign-in has worked on a server's own sign-in page on this device, Apron goes straight there the next time, instead of first asking your device for a passkey it won't find. It tries your device again 30 days after it first went there, or as soon as the page doesn't work. ([#314](https://github.com/apron-chat/apron-web/pull/314))
- **Improved:** A server's sign-in page can ask your device for the right passkey first, on servers that accept passkeys for both their current and an earlier address. When Apron sends you there to sign in, it tells the page which account last signed in to that server on this device. After a passkey sign-in in Apron found none, it also tells the page to look for that address's passkey last. Servers that don't read these hints work as before. Apron doesn't note the account while it keeps no local history, and forgetting an account's local history also forgets that it signed in. ([#315](https://github.com/apron-chat/apron-web/pull/315))
- **Improved:** Zooming into an image no longer leaves you looking at a blurry preview: once you zoom in past the preview's detail, the image viewer loads the original JPEG, PNG, GIF, WebP or AVIF file and swaps it in, only then and only from where Preferences → Media lets images load. Screen readers hear how far the image is zoomed once you stop zooming. ([#306](https://github.com/apron-chat/apron-web/pull/306))
- **Improved:** People who get replies but are rarely @-mentioned are now offered notifications too: the offer, now "Get notified about mentions and replies?", comes at the first reply to one of your messages as well as at the first mention. As before, it's made only once on this device; it isn't made for a reply in a room you muted, or while Replies to my messages is unchecked. ([#317](https://github.com/apron-chat/apron-web/pull/317))
- **Improved:** When two people share a name, you can tell whether the one a message mentions is actually here: in a message's text, a mention of someone who isn't a member of the room or thread is greyed, as it is in a draft, and its tooltip says why. The grey follows who's a member now, not when the message was sent, so it goes when they join; in large rooms where Apron doesn't have the whole member list, nothing is greyed. ([#318](https://github.com/apron-chat/apron-web/pull/318))
- **Fixed:** A passkey that your device offers but the server doesn't recognize, such as one whose saving failed partway, no longer stops a sign-in: Apron offers to continue on the server's sign-in page, as it does when your device finds none. The message is the server's own, followed by the offer. Adding a passkey in Preferences offers the server's page too when it can't be saved in Apron. ([#314](https://github.com/apron-chat/apron-web/pull/314))
- **Fixed:** When a passkey sign-in or new account fails in Apron, for whatever reason, on a server that has its own sign-in page, Apron now offers to continue there: the button becomes Continue on that server ↗. This covers password managers that handle passkeys themselves, such as Bitwarden, which could stop at "'rp.id' cannot be used with the current origin" on servers whose passkeys belong to the server's own address; those now continue on the server's sign-in page, as they do when the browser itself refuses. ([#311](https://github.com/apron-chat/apron-web/pull/311))
- **Fixed:** Writing a long message no longer brings up the server notice that typing updates are limited to 10 per minute. Pausing to think now lets your typing indicator run out by itself within 15 seconds, instead of ending it and starting it again; sending, emptying the draft or switching rooms still ends it at once. ([#308](https://github.com/apron-chat/apron-web/pull/308))
- **Fixed:** Reloading on a room, or following a link to one, while its server was slow to answer, such as during a restart or on a slow network, could say "The linked room isn’t available here." and drop the room from the address, even though the room then opened. The link's 30-second wait now starts only once the server has listed its rooms. ([#312](https://github.com/apron-chat/apron-web/pull/312))
- **Fixed:** Reopening Apron or reloading, with history kept on this device (the default), could skip past everything that came while you were away and mark it read: the room opened at the latest of what it had kept, before the new messages arrived, then followed them in. It now waits until the room has caught up with the server, then opens at the New divider above what's new. ([#316](https://github.com/apron-chat/apron-web/pull/316))
- **Fixed:** A reload no longer takes you back to a message or profile card you opened from a link, a search result or a notification, however far you've read since. Once Apron has shown it, the address names just the room or thread, so a reload opens it as any visit does, at its New divider. A link or notification to a message that came while you were away now opens at it too: a link could say it wasn't available, and a notification opened the room without going to it. ([#316](https://github.com/apron-chat/apron-web/pull/316))

## Week of 2026-11-16

- **New feature:** Sign in with a passkey from any copy of Apron, not only one on the server's own domain or a domain it trusts, such as Apron hosted elsewhere or web.apron.chat on another server. Apron sends you to the server's passkey page to sign in, create an account or add a passkey, and finishes when you come back. ([#278](https://github.com/apron-chat/apron-web/pull/278))
- **New feature:** Notices no longer pile up in the timeline: dismiss a server notice, a command's reply or a local error with its ×. ([#284](https://github.com/apron-chat/apron-web/pull/284))
- **New feature:** No more guessing a server's commands: on a server that lists them (`ext:command_list`), a `/` at the start of the composer lists the commands you can use, with what each takes and does, and a command with several forms, such as `/emoji add` and `/emoji remove`, offers its forms after you pick it. `/help`, or Browse all commands at the end of that list, shows every command on one page, grouped by who may use them, from everyone to admins, with what each requires; press one to put it in the composer. Where the server has a command of the same name as one of Apron's own, such as `/kick`, the server's is the one that runs. ([#298](https://github.com/apron-chat/apron-web/pull/298))
- **New feature:** Hide spoilers behind a bar: write `||text||`, or use the full composer's Spoiler button, and the text stays hidden in messages, descriptions and documents until someone clicks it or presses Enter or Space on it. Notifications and reply quotes show ▒▒▒▒▒ in its place. ([#294](https://github.com/apron-chat/apron-web/pull/294))
- **New feature:** Read a `.txt` attachment without leaving Apron: a click on its card opens it in the document viewer, as written, in monospace with its spacing and line breaks kept, so columns line up and nothing in it is taken for Markdown. Long lines stay on one line and the viewer scrolls sideways, unless you turn on Wrap lines in the viewer's bar (or press W), which this device remembers. ([#302](https://github.com/apron-chat/apron-web/pull/302), [#303](https://github.com/apron-chat/apron-web/pull/303))
- **New feature:** Look closer at an image, especially on a phone: in the full-screen image viewer, pinch to zoom it, drag to move around once zoomed, and double tap to zoom in where you tap or back out to the whole image. With a mouse, double-click and drag, or zoom with Ctrl+wheel or a trackpad's pinch; only the image zooms, not the page or the viewer's bar, and while it's zoomed a click beside it no longer closes the viewer. ([#303](https://github.com/apron-chat/apron-web/pull/303))
- **Changed:** Commands are case-sensitive: `/Nick Ada` or `/KICK @bob` is no longer Apron's `/nick` or `/kick`, and goes to the server as typed, which says if it doesn't know it. While you type a command, the composer no longer capitalizes or corrects it. ([#298](https://github.com/apron-chat/apron-web/pull/298))
- **Changed:** External sign-in finishes by itself, with no code to copy: the server's sign-in page opens in a small window (or this tab, if the window is blocked) and Apron picks up when you return. Servers with the older external sign-in aren't supported, so sign in another way or ask the server's admin to update. ([#278](https://github.com/apron-chat/apron-web/pull/278))
- **Changed:** Messages with links go out with their preview cards instead of without them: Send waits up to 1.5 seconds for previews, with a spinner, and sends at once if you leave the page. ([#282](https://github.com/apron-chat/apron-web/pull/282), [#283](https://github.com/apron-chat/apron-web/pull/283))
- **Changed:** A room or thread description you put away with its × now stays away when someone edits it, so a room that often edits its description no longer keeps pinning it back. Instead the header's Description button turns blue until you open it (your own edits don't count), and the member list's button now sits after it. ([#292](https://github.com/apron-chat/apron-web/pull/292))
- **Changed:** Read and edit a room's or thread's description where it shows, without losing your work: a click anywhere on its first lines opens the whole over the conversation, and Edit there (or ⋯ > Edit room) changes the title and description in place, not in a dialog. Unsaved edits are kept on this device until you save or discard them, and Save asks before replacing someone else's; once you've read a description whole, its first lines leave the top of the conversation as if put away with ×, unless you fold it back into them with the ⌃ at its foot; Description or a click on the room's name opens it again (a second click on the name shuts it). ([#299](https://github.com/apron-chat/apron-web/pull/299), [#301](https://github.com/apron-chat/apron-web/pull/301))
- **Improved:** Sign-in choices use the server's own names for them, such as "Acme SSO". ([#278](https://github.com/apron-chat/apron-web/pull/278))
- **Improved:** Links that could mislead you about where they go stand out in their own colour: a label that hides the address, lookalike letters, punycode, or a name before the host such as `bank.example@evil.example`. ([#286](https://github.com/apron-chat/apron-web/pull/286))
- **Improved:** YouTube previews show the video's thumbnail, so you can see what a link is before opening it. ([#282](https://github.com/apron-chat/apron-web/pull/282))
- **Fixed:** An emailed sign-in code stopped working if the page reconnected while you checked your email, for example after a phone slept. ([#278](https://github.com/apron-chat/apron-web/pull/278))
- **Fixed:** Opening a link to another server in a new tab took over the server from the window you were using, which then showed "Apron is open in another window". ([#280](https://github.com/apron-chat/apron-web/pull/280))
- **Fixed:** In Chrome, going Back or Forward between rooms could put an old unread count back in the tab title, such as "(1) Apron" for a message you had already read. ([#300](https://github.com/apron-chat/apron-web/pull/300))

## Week of 2026-11-09

- **New feature:** Long documents are comfortable to read: Markdown attachments open rendered in a full-screen viewer, with Download and adjustable text size. ([#251](https://github.com/apron-chat/apron-web/pull/251), [#260](https://github.com/apron-chat/apron-web/pull/260), [#261](https://github.com/apron-chat/apron-web/pull/261), [#277](https://github.com/apron-chat/apron-web/pull/277))
- **New feature:** Long write-ups can travel as a file: **Embed as attachment** sends a long draft as a `message.md` attachment and leaves the field free for a short caption, on servers that accept it. ([#256](https://github.com/apron-chat/apron-web/pull/256), [#257](https://github.com/apron-chat/apron-web/pull/257), [#258](https://github.com/apron-chat/apron-web/pull/258), [#259](https://github.com/apron-chat/apron-web/pull/259))
- **New feature:** A reload, closed tab or crash no longer loses what you were writing: unsent drafts are kept on this device for each room and thread. Attached files aren't kept. ([#272](https://github.com/apron-chat/apron-web/pull/272))
- **New feature:** Mention anyone, not only people already in the room: the @ picker offers others, and "Add to room on send" brings them in with the message. Mentions that won't reach anyone are greyed out. ([#267](https://github.com/apron-chat/apron-web/pull/267))
- **New feature:** Room and thread descriptions can be as rich as messages, with formatting, mentions, checklists and Preview. ([#249](https://github.com/apron-chat/apron-web/pull/249), [#266](https://github.com/apron-chat/apron-web/pull/266))
- **New feature:** Reacting takes one click: the toolbar offers your three most recent reactions, and a + beside a message's reactions opens the picker. ([#248](https://github.com/apron-chat/apron-web/pull/248))
- **New feature:** A terminal you're done watching can be put away: closing a live terminal embed hides it and stops streaming, and it stays closed after a reload. Back, or a click beside the content, closes any viewer. ([#253](https://github.com/apron-chat/apron-web/pull/253), [#254](https://github.com/apron-chat/apron-web/pull/254), [#255](https://github.com/apron-chat/apron-web/pull/255), [#259](https://github.com/apron-chat/apron-web/pull/259))
- **Changed:** Extra tabs no longer use up a server's connection limit: only one window of a browser connects to a server at a time, and **Use here** in another window takes it over. ([#270](https://github.com/apron-chat/apron-web/pull/270))
- **Changed:** The message toolbar no longer covers the first line of the message, where it hid links you wanted to click. It's a row of icons above the message, with labels in wide windows and a ⋯ menu on desktop. ([#248](https://github.com/apron-chat/apron-web/pull/248), [#250](https://github.com/apron-chat/apron-web/pull/250), [#252](https://github.com/apron-chat/apron-web/pull/252), [#271](https://github.com/apron-chat/apron-web/pull/271))
- **Improved:** Leaving a thread you're the last one in asks first, since some servers delete empty threads. ([#265](https://github.com/apron-chat/apron-web/pull/265))
- **Improved:** A reconnect no longer takes the composer away mid-sentence, closing the phone's keyboard with it: you can keep typing, and only Send waits. ([#272](https://github.com/apron-chat/apron-web/pull/272))
- **Improved:** Coming back to Apron on a phone, or switching from Wi-Fi to cellular, reconnects in about 2 seconds instead of waiting on a dead connection. ([#264](https://github.com/apron-chat/apron-web/pull/264), [#268](https://github.com/apron-chat/apron-web/pull/268))
- **Improved:** On a small phone with the keyboard up, you can still see the line you're writing and Send. ([#279](https://github.com/apron-chat/apron-web/pull/279))
- **Improved:** Typing with an input method, such as for Japanese or Chinese, no longer sets off Enter and the arrow keys mid-word in search and pickers. Keyboard and High Contrast users get a skip past the rooms list and visible focus. ([#276](https://github.com/apron-chat/apron-web/pull/276))
- **Fixed:** After signing in with a passkey from a guest session, the open room got stuck on "Checking for new messages…". ([#264](https://github.com/apron-chat/apron-web/pull/264))
- **Fixed:** Avatars and custom emoji showed as initials after a reload on servers that keep media on another domain. ([#244](https://github.com/apron-chat/apron-web/pull/244))

## Week of 2026-11-02

- **New feature:** Get around without the mouse: press ? for the keyboard shortcuts, including Alt+↑/↓ between rooms and threads, ↑ from an empty composer into the messages, and r to reply or e to edit. ([#212](https://github.com/apron-chat/apron-web/pull/212), [#218](https://github.com/apron-chat/apron-web/pull/218), [#219](https://github.com/apron-chat/apron-web/pull/219))
- **New feature:** Find things fast: Ctrl/⌘K jumps to any room or thread by name, joined or not, and Ctrl/⌘F searches messages, loading older history from the server when needed. ([#220](https://github.com/apron-chat/apron-web/pull/220), [#224](https://github.com/apron-chat/apron-web/pull/224), [#225](https://github.com/apron-chat/apron-web/pull/225))
- **New feature:** Room to write longer messages: Expand opens a full-panel composer with a formatting toolbar and Preview. ([#229](https://github.com/apron-chat/apron-web/pull/229), [#243](https://github.com/apron-chat/apron-web/pull/243))
- **New feature:** Keep track of tasks in chat: `- [ ]` items become checkboxes that the author and anyone the message mentions can tick. ([#236](https://github.com/apron-chat/apron-web/pull/236), [#242](https://github.com/apron-chat/apron-web/pull/242), [#243](https://github.com/apron-chat/apron-web/pull/243))
- **New feature:** Voice notes are easier to listen to, in Apron's own player: a waveform you can seek along, and 1×, 1.5× or 2× speed. ([#233](https://github.com/apron-chat/apron-web/pull/233), [#235](https://github.com/apron-chat/apron-web/pull/235), [#237](https://github.com/apron-chat/apron-web/pull/237), [#241](https://github.com/apron-chat/apron-web/pull/241))
- **New feature:** Bring a whole team in at once: Add members takes `@role` to add everyone with that role, and mentioning someone who isn't in the room asks whether to add them. ([#227](https://github.com/apron-chat/apron-web/pull/227))
- **New feature:** Take terminal output with you: terminal embeds have Copy, which copies it as plain text, and Open in a new tab. ([#207](https://github.com/apron-chat/apron-web/pull/207))
- **Changed:** Signing out no longer costs you this device's history: it's kept for when you sign in again. To delete it, untick Keep local history when you sign out, or use Preferences > History. ([#199](https://github.com/apron-chat/apron-web/pull/199))
- **Changed:** Look around a room before joining it: one picked under Other Rooms opens for reading, and joining (with Join, or by posting) keeps what you've already read. ([#212](https://github.com/apron-chat/apron-web/pull/212), [#215](https://github.com/apron-chat/apron-web/pull/215))
- **Changed:** Muting a room quiets it without making you miss what's meant for you: it no longer counts toward the tab title or app badge, but mentions of you still get through. ([#226](https://github.com/apron-chat/apron-web/pull/226), [#228](https://github.com/apron-chat/apron-web/pull/228))
- **Changed:** You only see the sign-in options a server actually offers: connecting to a new server asks for its address first, then shows them. Recent servers can be starred or removed, and the guest button reads Join. ([#231](https://github.com/apron-chat/apron-web/pull/231), [#240](https://github.com/apron-chat/apron-web/pull/240))
- **Changed:** Following a link to another server no longer disconnects this tab from the one you're on: it opens in a new tab. ([#230](https://github.com/apron-chat/apron-web/pull/230))
- **Improved:** Faster startup: a room's first messages show 20–28% sooner on phones. ([#201](https://github.com/apron-chat/apron-web/pull/201), [#221](https://github.com/apron-chat/apron-web/pull/221))
- **Improved:** A hung connection attempt, or a saved server that's gone, no longer leaves Apron stuck on "Still trying to reconnect…". ([#216](https://github.com/apron-chat/apron-web/pull/216), [#239](https://github.com/apron-chat/apron-web/pull/239))
- **Improved:** Notifications take you straight to the message, also in an installed phone app, and push notifications name the room. ([#203](https://github.com/apron-chat/apron-web/pull/203), [#204](https://github.com/apron-chat/apron-web/pull/204), [#223](https://github.com/apron-chat/apron-web/pull/223))
- **Improved:** Uploaded animated images have their metadata removed, and HTML embeds may use only an allowed set of tags. ([#223](https://github.com/apron-chat/apron-web/pull/223))
- **Fixed:** Blank lines typed in the composer were dropped, so paragraphs were sent as one. ([#208](https://github.com/apron-chat/apron-web/pull/208))
- **Fixed:** In Safari, pressing Enter to confirm input-method text (for example Japanese) sent the message. ([#223](https://github.com/apron-chat/apron-web/pull/223))
- **Fixed:** New replies in joined threads didn't show in the rooms list after a reconnect or reload. ([#200](https://github.com/apron-chat/apron-web/pull/200))
- **Fixed:** A server icon hosted on the site Apron is loaded from was blocked and shown as initials. ([#214](https://github.com/apron-chat/apron-web/pull/214))
- **Fixed:** Menus could open underneath the member list. ([#234](https://github.com/apron-chat/apron-web/pull/234))

## Week of 2026-10-26

- **New feature:** Talk privately: start a private conversation with one or more people from **Message** on a profile card, or the + beside the new Private section. Where the server supports them, private rooms show read receipts, which you can turn off. ([#123](https://github.com/apron-chat/apron-web/pull/123), [#129](https://github.com/apron-chat/apron-web/pull/129), [#187](https://github.com/apron-chat/apron-web/pull/187))
- **New feature:** Your history shows before the server answers: a signed-in session keeps what it loaded on this device (30 days by default, deleted when you sign out), so a reload shows it at once. Search it with `user:` and `room:` filters, export it as `.jsonl`, and open an export read-only. ([#135](https://github.com/apron-chat/apron-web/pull/135), [#137](https://github.com/apron-chat/apron-web/pull/137), [#171](https://github.com/apron-chat/apron-web/pull/171))
- **New feature:** Watch work happen live: terminal output shows in a real, read-only terminal you can expand to full screen, and `/live` types your next message as others watch. Live streams from v9 servers show only as plain cards. **Requires server protocol v10** ([#162](https://github.com/apron-chat/apron-web/pull/162), [#189](https://github.com/apron-chat/apron-web/pull/189), [#191](https://github.com/apron-chat/apron-web/pull/191))
- **New feature:** A busy rooms list stays manageable: drag rooms into your order, mute a room or thread for a while, and fold headings down to what has news. Threads quiet for 3 days fold under Inactive, and Browse rooms is now Other Rooms. ([#125](https://github.com/apron-chat/apron-web/pull/125), [#145](https://github.com/apron-chat/apron-web/pull/145), [#147](https://github.com/apron-chat/apron-web/pull/147), [#148](https://github.com/apron-chat/apron-web/pull/148), [#150](https://github.com/apron-chat/apron-web/pull/150), [#151](https://github.com/apron-chat/apron-web/pull/151), [#160](https://github.com/apron-chat/apron-web/pull/160), [#185](https://github.com/apron-chat/apron-web/pull/185), [#198](https://github.com/apron-chat/apron-web/pull/198))
- **New feature:** Make Apron look your way with a theme: Apron, Ferrous, Gumball, Linocut (high contrast, also for e-ink), or your own CSS. Fonts you chose before become a custom theme. ([#174](https://github.com/apron-chat/apron-web/pull/174), [#177](https://github.com/apron-chat/apron-web/pull/177))
- **New feature:** Copy selected messages as a readable Markdown log, reach everyone with a role with `@&role`, and get mention chips and suggestions while editing. Links to YouTube, X, Bluesky and Wikipedia get previews too. ([#122](https://github.com/apron-chat/apron-web/pull/122), [#159](https://github.com/apron-chat/apron-web/pull/159), [#164](https://github.com/apron-chat/apron-web/pull/164), [#168](https://github.com/apron-chat/apron-web/pull/168), [#172](https://github.com/apron-chat/apron-web/pull/172), [#181](https://github.com/apron-chat/apron-web/pull/181))
- **New feature:** Your server's own custom emoji work in messages, reactions and the picker, and the top of the rooms list shows the server's name, description and avatar. ([#138](https://github.com/apron-chat/apron-web/pull/138))
- **New feature:** See when someone was last around: an offline person's profile card and member row say when they were last seen. ([#126](https://github.com/apron-chat/apron-web/pull/126))
- **New feature:** On a phone, Apron offers once to add itself to the Home Screen, with the steps for your browser. ([#167](https://github.com/apron-chat/apron-web/pull/167))
- **Changed:** Media from sites you haven't trusted no longer loads without your say-so: images, video and audio from anywhere but the chat server and your trusted sites wait for Load, Always load or Block, and the prompt shows the full address. To load from every site you haven't blocked, choose Any site in Preferences → Media. ([#163](https://github.com/apron-chat/apron-web/pull/163), [#186](https://github.com/apron-chat/apron-web/pull/186), [#193](https://github.com/apron-chat/apron-web/pull/193), [#194](https://github.com/apron-chat/apron-web/pull/194))
- **Changed:** Your profile and the server's settings are each one click away: Preferences opens at Profile from one button in the profile bar, and the server's name above the rooms list opens its details, with Connect to another server… and Disconnect. ([#174](https://github.com/apron-chat/apron-web/pull/174), [#177](https://github.com/apron-chat/apron-web/pull/177))
- **Improved:** A brief drop in connection is barely noticeable: no flashing banners or emptied page, and the room you're reading catches up first. Unread counts survive a reload on servers that keep read cursors, and notifications clear once you've read the room on another device. ([#127](https://github.com/apron-chat/apron-web/pull/127), [#128](https://github.com/apron-chat/apron-web/pull/128), [#130](https://github.com/apron-chat/apron-web/pull/130), [#154](https://github.com/apron-chat/apron-web/pull/154), [#169](https://github.com/apron-chat/apron-web/pull/169), [#173](https://github.com/apron-chat/apron-web/pull/173))
- **Improved:** A server can no longer use your passkey to sign in as you somewhere else: Apron runs a passkey sign-in only for a domain the server owns. ([#183](https://github.com/apron-chat/apron-web/pull/183))
- **Improved:** Right-to-left languages get a correctly mirrored layout, and hidden direction-override characters are stripped from what people write, so text can't be disguised with them. ([#138](https://github.com/apron-chat/apron-web/pull/138))
- **Improved:** Touch screens get the same reach as a mouse: long-press a message for its menu, and tap a member for their profile or long-press for a menu with Direct message. ([#139](https://github.com/apron-chat/apron-web/pull/139), [#153](https://github.com/apron-chat/apron-web/pull/153), [#161](https://github.com/apron-chat/apron-web/pull/161))
- **Improved:** On a phone, the rooms list leaves a sliver of the room showing, to tap or swipe back to. ([#192](https://github.com/apron-chat/apron-web/pull/192))
- **Improved:** The timeline shows when people are added to a room, when they join or leave a thread, and when a room is renamed. ([#170](https://github.com/apron-chat/apron-web/pull/170))
- **Improved:** Reply quotes, link cards and notifications show a Markdown message as text, without its `**` and backticks. ([#146](https://github.com/apron-chat/apron-web/pull/146))
- **Fixed:** A failed upload showed "Uploading…" to everyone else forever. It now reads "Upload failed" after ten minutes. ([#136](https://github.com/apron-chat/apron-web/pull/136))
- **Fixed:** On iOS, the timeline jittered when pulled past the latest message, and slow drags didn't stay pinned to the bottom. ([#165](https://github.com/apron-chat/apron-web/pull/165), [#196](https://github.com/apron-chat/apron-web/pull/196))
- **Fixed:** The jump-to-latest button could stay on screen with the latest message already in view. ([#190](https://github.com/apron-chat/apron-web/pull/190))

## Week of 2026-10-19

- **New feature:** Share any room, thread, message, person or invite with one link: link.apron.chat links open right in the app and show as chips in messages, and the ⋯ menu copies one. ([#112](https://github.com/apron-chat/apron-web/pull/112), [#119](https://github.com/apron-chat/apron-web/pull/119))
- **New feature:** Use the sign-in your server already has: sign in, or add a way to sign in, through its own sign-in page where it offers one. **Requires server protocol v9** ([#89](https://github.com/apron-chat/apron-web/pull/89))
- **New feature:** See who reacted: long-press or right-click a reaction. ([#90](https://github.com/apron-chat/apron-web/pull/90))
- **New feature:** Tell people about yourself with a profile bio of up to 250 characters. ([#115](https://github.com/apron-chat/apron-web/pull/115), [#116](https://github.com/apron-chat/apron-web/pull/116))
- **Changed:** The host serving Apron no longer learns which servers and rooms you open: your place in the app is kept after the `#` in the address, which browsers don't send. Old `?room=` bookmarks open the default room, so re-bookmark them. ([#114](https://github.com/apron-chat/apron-web/pull/114))
- **Changed:** Moving other people's messages works on any server that allows it, not only Apron's own: whether you can is up to the server's permissions, not your admin or mod role. ([#111](https://github.com/apron-chat/apron-web/pull/111))
- **Changed:** A room's purpose stays in view: its description is pinned under the header in three lines, and × hides it until it changes. Threads call it "Description" instead of "Summary". ([#91](https://github.com/apron-chat/apron-web/pull/91), [#94](https://github.com/apron-chat/apron-web/pull/94), [#108](https://github.com/apron-chat/apron-web/pull/108), [#117](https://github.com/apron-chat/apron-web/pull/117))
- **Improved:** In an installed app, the offer to turn on notifications comes at sign-in instead of waiting for your first mention. ([#93](https://github.com/apron-chat/apron-web/pull/93))
- **Improved:** Pick up where you left off: rooms and threads open at the New divider, remembered on this device even where the server keeps no read position. ([#100](https://github.com/apron-chat/apron-web/pull/100))
- **Improved:** Moving messages into a thread no longer hides them from their authors, who are added to the thread. ([#95](https://github.com/apron-chat/apron-web/pull/95))
- **Improved:** See who's around at a glance: the member list is split into Online and Offline, each with a count. ([#99](https://github.com/apron-chat/apron-web/pull/99), [#101](https://github.com/apron-chat/apron-web/pull/101))
- **Improved:** Thread cards show what's new to you, with your unread count and an @ for a mention instead of a total, and private threads are marked. The sidebar lists a room's joined threads most recently active first. ([#103](https://github.com/apron-chat/apron-web/pull/103), [#120](https://github.com/apron-chat/apron-web/pull/120))
- **Improved:** Writing on a phone keeps the app in view above the keyboard, with the header showing, and iPhone no longer zooms into the composer. ([#97](https://github.com/apron-chat/apron-web/pull/97), [#118](https://github.com/apron-chat/apron-web/pull/118))
- **Improved:** Hitting a rate limit no longer leaves you guessing when to retry: a countdown shows in the timeline and on Send, and a held-back room loads again by itself. ([#109](https://github.com/apron-chat/apron-web/pull/109))
- **Improved:** Voice clips take about a quarter of the space, and any image your browser opens, such as HEIC or AVIF, works as an avatar. ([#92](https://github.com/apron-chat/apron-web/pull/92), [#96](https://github.com/apron-chat/apron-web/pull/96))
- **Fixed:** Passkey sign-in through 1Password in Chrome and Arc on macOS failed with "clientExtensionResults must be an object". ([#106](https://github.com/apron-chat/apron-web/pull/106))
- **Fixed:** Going back to a room from a thread didn't open it at its latest message. ([#102](https://github.com/apron-chat/apron-web/pull/102), [#113](https://github.com/apron-chat/apron-web/pull/113))

## Week of 2026-10-12

- **New feature:** Bookmark, share or reload any room, thread or message: each has its own address, and a message's ⋯ menu has Copy link. ([#86](https://github.com/apron-chat/apron-web/pull/86))
- **New feature:** On a phone, see when there's news elsewhere: the back arrow in a room's header counts your unread messages in other rooms, in orange with an @ when you're mentioned. ([#84](https://github.com/apron-chat/apron-web/pull/84))
- **Improved:** On a phone, Back from the rooms list returns you to what you were reading, instead of skipping to the previous room. ([#85](https://github.com/apron-chat/apron-web/pull/85))
- **Improved:** Tell what a thread is about and how lively it is from the room: thread cards show its summary, latest reply, and when it was last replied to. ([#87](https://github.com/apron-chat/apron-web/pull/87))
- **Improved:** People who share a display name are no longer mixed up in mentions: each shows their user ID too. ([#82](https://github.com/apron-chat/apron-web/pull/82))
- **Fixed:** A guest who signed up for an account appeared twice in a room's member list. ([#81](https://github.com/apron-chat/apron-web/pull/81))

## Week of 2026-10-05

- **New feature:** Hear about mentions even when Apron is closed, with push notifications for signed-in accounts on servers that offer them. On iPhone and iPad, add Apron to the Home Screen first. ([#48](https://github.com/apron-chat/apron-web/pull/48), [#57](https://github.com/apron-chat/apron-web/pull/57), [#61](https://github.com/apron-chat/apron-web/pull/61))
- **New feature:** Let people know whether you're around: set Online, Do not disturb or Invisible, shown as a dot on avatars in the member list. Do not disturb silences notifications, and you show as idle after five minutes away. ([#48](https://github.com/apron-chat/apron-web/pull/48), [#52](https://github.com/apron-chat/apron-web/pull/52), [#68](https://github.com/apron-chat/apron-web/pull/68))
- **New feature:** Take a break from notifications: pause them for an hour, 8 hours, until tomorrow morning or until you resume, on all your devices at once. ([#48](https://github.com/apron-chat/apron-web/pull/48))
- **New feature:** See images properly: click one to open it full screen, and page through the room's images with the arrow keys. ([#53](https://github.com/apron-chat/apron-web/pull/53))
- **New feature:** Fix an attachment mistake without resending: remove or rename a message's files while editing it, or rename a file before you send it. ([#70](https://github.com/apron-chat/apron-web/pull/70))
- **New feature:** Discover the conversations in a room: threads you haven't joined are listed under Other threads, and you can join or leave from the row. ([#50](https://github.com/apron-chat/apron-web/pull/50), [#66](https://github.com/apron-chat/apron-web/pull/66), [#73](https://github.com/apron-chat/apron-web/pull/73), [#74](https://github.com/apron-chat/apron-web/pull/74), [#79](https://github.com/apron-chat/apron-web/pull/79))
- **New feature:** Admins and moderators can tidy a conversation by moving anyone's messages into a thread. A move happens all or nothing. ([#54](https://github.com/apron-chat/apron-web/pull/54))
- **Changed:** Apron needs a server that speaks protocol v8. **Requires server protocol v8** ([#48](https://github.com/apron-chat/apron-web/pull/48))
- **Changed:** Notifications are simpler to set: one switch covers desktop and push, and **Notify me about** picks mentions, replies to you, private rooms or joined rooms, for each account. ([#48](https://github.com/apron-chat/apron-web/pull/48), [#57](https://github.com/apron-chat/apron-web/pull/57))
- **Changed:** Starting a thread asks for a title and an optional summary first. ([#66](https://github.com/apron-chat/apron-web/pull/66), [#71](https://github.com/apron-chat/apron-web/pull/71), [#75](https://github.com/apron-chat/apron-web/pull/75))
- **Changed:** On phones and tablets, Enter starts a new line, as in other mobile chat apps; tap Send to send. ([#60](https://github.com/apron-chat/apron-web/pull/60))
- **Changed:** The rooms list and member list open and close from buttons in the window's top corners, and a room's Edit and Leave moved into its header's ⋯ menu. ([#51](https://github.com/apron-chat/apron-web/pull/51), [#59](https://github.com/apron-chat/apron-web/pull/59), [#62](https://github.com/apron-chat/apron-web/pull/62))
- **Improved:** With a passkey or email account, reopening Apron shows your rooms and messages from last time straight away, without waiting on the server. ([#56](https://github.com/apron-chat/apron-web/pull/56), [#67](https://github.com/apron-chat/apron-web/pull/67), [#72](https://github.com/apron-chat/apron-web/pull/72))
- **Improved:** An update won't cost you a message: the update notice warns when reloading would lose one you haven't sent. ([#53](https://github.com/apron-chat/apron-web/pull/53))
- **Improved:** Replies in other rooms are harder to miss: joined threads with new messages show in the sidebar even under rooms you don't have open, with one unread count per row, orange with an @ for a mention. ([#76](https://github.com/apron-chat/apron-web/pull/76))
- **Improved:** A growing draft no longer pushes the latest messages out of view behind the composer. ([#64](https://github.com/apron-chat/apron-web/pull/64))
- **Fixed:** Long names in the member list were cut off by role badges and by the space kept for the remove button. ([#77](https://github.com/apron-chat/apron-web/pull/77), [#80](https://github.com/apron-chat/apron-web/pull/80))

## Week of 2026-09-28

- **New feature:** Sign in without a passkey: create an account or sign in by email, with an emailed code or link. Add an email or a passkey from your profile as a second way back in. ([#36](https://github.com/apron-chat/apron-web/pull/36))
- **New feature:** Rooms can say what they're for with a description, and private rooms (marked with a lock) keep conversations to their members. `/topic` now sets the description instead of the title. ([#36](https://github.com/apron-chat/apron-web/pull/36))
- **New feature:** See who's who and manage a room: role badges beside names, and a member list that counts members and adds or removes them, as `/invite @user` and `/kick @user` do. ([#36](https://github.com/apron-chat/apron-web/pull/36), [#39](https://github.com/apron-chat/apron-web/pull/39))
- **New feature:** Find out who someone is: click a mention, name or avatar for their profile card, which warns when someone else uses the same name. From it you can mention them, copy their ID or add them to the room. ([#47](https://github.com/apron-chat/apron-web/pull/47))
- **New feature:** Send several files with one message: attach them to a draft by picking, pasting, dropping or recording, check the previews, and send them with your text. ([#35](https://github.com/apron-chat/apron-web/pull/35), [#49](https://github.com/apron-chat/apron-web/pull/49))
- **Changed:** Room descriptions, private rooms, email sign-in, roles and member changes need a v7 server, and rooms on v6 servers no longer show their intro message. **Requires server protocol v7** ([#36](https://github.com/apron-chat/apron-web/pull/36))
- **Changed:** Passkey sign-in asks up front whether you're signing in or creating an account, and passkeys no longer pop up by themselves after a reconnect: tap Sign in on the banner. ([#40](https://github.com/apron-chat/apron-web/pull/40), [#41](https://github.com/apron-chat/apron-web/pull/41), [#46](https://github.com/apron-chat/apron-web/pull/46))
- **Removed:** The client's banner about how long the demo server keeps messages. A server can say this in its own welcome notice. ([#45](https://github.com/apron-chat/apron-web/pull/45))
- **Improved:** Start thread gets a thread going in one step: it names the thread after the message, pins its gist as the summary, and quotes it in your reply. ([#36](https://github.com/apron-chat/apron-web/pull/36))
- **Improved:** Uploads are quicker and keep where you were private: images are shrunk before upload, and photos are re-encoded, which removes location and other EXIF data. ([#35](https://github.com/apron-chat/apron-web/pull/35))
- **Fixed:** Passkey sign-in did nothing with password-manager extensions such as 1Password. ([#40](https://github.com/apron-chat/apron-web/pull/40), [#43](https://github.com/apron-chat/apron-web/pull/43))
- **Fixed:** Accounts created with a passkey or invite got a random ID or "Member" instead of the name you chose. ([#45](https://github.com/apron-chat/apron-web/pull/45))

## Week of 2026-09-21

The Apron web client moved out of shazow/apron into its own repository and deploys to web.apron.chat ([#1](https://github.com/apron-chat/apron-web/pull/1)). It spoke Apron protocol v6 and connected to server.apron.chat or any server you entered, as a guest or with a passkey. It had rooms and threads, Markdown messages with replies, edits, reactions and @mentions, slash commands, uploads, voice clips, live terminal output, typing indicators and a "New" divider at your last read message.

- **New feature:** Make Apron yours in Preferences: desktop notifications for mentions or every message, a light or dark theme, and your own fonts. ([#23](https://github.com/apron-chat/apron-web/pull/23))
- **New feature:** Use Apron like an app: install it, and it opens even without a connection. When an update is deployed, a banner offers to reload instead of reloading under you. ([#7](https://github.com/apron-chat/apron-web/pull/7), [#8](https://github.com/apron-chat/apron-web/pull/8))
- **New feature:** See what a GitHub link is before you click: pull requests, issues, commits and repositories get preview cards, which you can leave out before sending or remove later. ([#11](https://github.com/apron-chat/apron-web/pull/11), [#13](https://github.com/apron-chat/apron-web/pull/13), [#19](https://github.com/apron-chat/apron-web/pull/19), [#20](https://github.com/apron-chat/apron-web/pull/20))
- **New feature:** Richer messages: tables, strikethrough and highlighted code, and bare web addresses become links. ([#3](https://github.com/apron-chat/apron-web/pull/3), [#6](https://github.com/apron-chat/apron-web/pull/6), [#12](https://github.com/apron-chat/apron-web/pull/12), [#16](https://github.com/apron-chat/apron-web/pull/16))
- **New feature:** Write faster: the composer completes `:shortcode` emoji and `#` rooms and threads. A + beside Rooms creates a room, and a member list opens from the room header. ([#28](https://github.com/apron-chat/apron-web/pull/28))
- **New feature:** Bots and scripts can sign in too, with a token from the server, such as a bot token from `/invite-bot`. ([#2](https://github.com/apron-chat/apron-web/pull/2))
- **New feature:** Back and Forward move between the rooms and threads you've opened, and joined threads show how many new replies they have. ([#17](https://github.com/apron-chat/apron-web/pull/17), [#30](https://github.com/apron-chat/apron-web/pull/30))
- **Changed:** Reacting takes fewer steps: React opens the full emoji picker with your frequent emoji first. Select mode picks anyone's messages and leaves the server to decide which moves it allows, and links in messages open in a new tab so the chat stays open. ([#6](https://github.com/apron-chat/apron-web/pull/6), [#10](https://github.com/apron-chat/apron-web/pull/10), [#14](https://github.com/apron-chat/apron-web/pull/14))
- **Improved:** A second guard against injected markup: every message is cleaned of unsafe HTML after it's formatted. ([#12](https://github.com/apron-chat/apron-web/pull/12))
- **Fixed:** Emoji in messages and reactions showed as plain text symbols instead of color emoji. ([#21](https://github.com/apron-chat/apron-web/pull/21))
