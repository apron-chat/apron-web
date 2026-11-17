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
feature as users see it ("the document viewer", not "DocViewer"). Keep each
entry to one or two sentences and end it with its PR numbers, like (#256, #257),
or with the short commit hash when a commit has no PR number. If several PRs
built one feature, give it one entry.

Lead with why the change matters, not what changed: the problem it solves or
what it lets people do, then how, briefly. Write "Extra tabs no longer use up a
server's connection limit: only one window connects at a time", not "Only one
window of a browser stays connected to a server". Take the reason from the
commit message, PR description or diff; don't invent one. If a change explains
itself, just state it.

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
week; a week that shipped many features can have more.
-->

## Week of 2026-11-16

- **New feature:** Notices no longer pile up in the timeline: dismiss a server notice, a command's reply or a local error with its ×. (#284)
- **Changed:** External sign-in finishes by itself, with no code to copy: the server's sign-in page opens in a small window (or this tab, if the window is blocked) and Apron picks up when you return. Servers with the older external sign-in aren't supported, so sign in another way or ask the server's admin to update. (#278)
- **Changed:** Messages with links go out with their preview cards instead of without them: Send waits up to 1.5 seconds for previews, with a spinner, and sends at once if you leave the page. (#282, #283)
- **Improved:** Passkeys work on servers whose passkeys this page couldn't use before, by finishing on the server's own passkey page. Sign-in choices use the server's own names for them, such as "Acme SSO". (#278)
- **Improved:** Links that could mislead you about where they go stand out in their own colour: a label that hides the address, lookalike letters, punycode, or a name before the host such as `bank.example@evil.example`. (#286)
- **Improved:** YouTube previews show the video's thumbnail, so you can see what a link is before opening it. (#282)
- **Fixed:** An emailed sign-in code stopped working if the page reconnected while you checked your email, for example after a phone slept. (#278)

## Week of 2026-11-09

- **New feature:** Long documents are comfortable to read: Markdown attachments open rendered in a full-screen viewer, with Download and adjustable text size. (#251, #260, #261, #277)
- **New feature:** Long write-ups can travel as a file: **Embed as attachment** sends a long draft as a `message.md` attachment and leaves the field free for a short caption, on servers that accept it. (#256, #257, #258, #259)
- **New feature:** A reload, closed tab or crash no longer loses what you were writing: unsent drafts are kept on this device for each room and thread. Attached files aren't kept. (#272)
- **New feature:** Mention anyone, not only people already in the room: the @ picker offers others, and "Add to room on send" brings them in with the message. Mentions that won't reach anyone are greyed out. (#267)
- **New feature:** Room and thread descriptions can be as rich as messages, with formatting, mentions, checklists and Preview. (#249, #266)
- **New feature:** Reacting takes one click: the toolbar offers your three most recent reactions, and a + beside a message's reactions opens the picker. (#248)
- **Changed:** Extra tabs no longer use up a server's connection limit: only one window of a browser connects to a server at a time, and **Use here** in another window takes it over. (#270)
- **Changed:** The message toolbar no longer covers the first line of the message, where it hid links you wanted to click. It's a row of icons above the message, with labels in wide windows and a ⋯ menu on desktop. (#248, #250, #252, #271)
- **Changed:** A terminal you're done watching can be put away: closing a live terminal embed hides it and stops streaming, and it stays closed after a reload. Back, or a click beside the content, closes any viewer. (#253, #254, #255, #259)
- **Changed:** Leaving a thread you're the last one in asks first, since some servers delete empty threads. (#265)
- **Improved:** A reconnect no longer takes the composer away mid-sentence, closing the phone's keyboard with it: you can keep typing, and only Send waits. (#272)
- **Improved:** Coming back to Apron on a phone, or switching from Wi-Fi to cellular, reconnects in about 2 seconds instead of waiting on a dead connection. (#264, #268)
- **Improved:** On a small phone with the keyboard up, you can still see the line you're writing and Send. (#279)
- **Improved:** Typing with an input method, such as for Japanese or Chinese, no longer sets off Enter and the arrow keys mid-word in search and pickers. Keyboard and High Contrast users get a skip past the rooms list and visible focus. (#276)
- **Fixed:** After signing in with a passkey from a guest session, the open room got stuck on "Checking for new messages…". (#264)
- **Fixed:** Avatars and custom emoji showed as initials after a reload on servers that keep media on another domain. (#244)

## Week of 2026-11-02

- **New feature:** Get around without the mouse: press ? for the keyboard shortcuts, including Alt+↑/↓ between rooms and threads, ↑ from an empty composer into the messages, and r to reply or e to edit. (#212, #218, #219)
- **New feature:** Find things fast: Ctrl/⌘K jumps to any room or thread by name, joined or not, and Ctrl/⌘F searches messages, loading older history from the server when needed. (#220, #224, #225)
- **New feature:** Room to write longer messages: Expand opens a full-panel composer with a formatting toolbar and Preview. (#229, #243)
- **New feature:** Keep track of tasks in chat: `- [ ]` items become checkboxes that the author and anyone the message mentions can tick. (#236, #242, #243)
- **New feature:** Voice notes are easier to listen to, in Apron's own player: a waveform you can seek along, and 1×, 1.5× or 2× speed. (#233, #235, #237, #241)
- **Changed:** Signing out no longer costs you this device's history: it's kept for when you sign in again. To delete it, untick Keep local history when you sign out, or use Preferences > History. (#199)
- **Changed:** Look around a room before joining it: one picked under Other Rooms opens for reading, and joining (with Join, or by posting) keeps what you've already read. (#212, #215)
- **Changed:** Muting a room quiets it without making you miss what's meant for you: it no longer counts toward the tab title or app badge, but mentions of you still get through. (#226, #228)
- **Changed:** You only see the sign-in options a server actually offers: connecting to a new server asks for its address first, then shows them. Recent servers can be starred or removed, and the guest button reads Join. (#231, #240)
- **Changed:** Following a link to another server no longer disconnects this tab from the one you're on: it opens in a new tab. (#230)
- **Improved:** Faster startup: a room's first messages show 20–28% sooner on phones. (#201, #221)
- **Improved:** A hung connection attempt, or a saved server that's gone, no longer leaves Apron stuck on "Still trying to reconnect…". (#216, #239)
- **Improved:** Notifications take you straight to the message, also in an installed phone app, and push notifications name the room. (#203, #204, #223)
- **Improved:** Uploaded animated images have their metadata removed, and HTML embeds may use only an allowed set of tags. (#223)
- **Fixed:** Blank lines typed in the composer were dropped, so paragraphs were sent as one. (#208)
- **Fixed:** In Safari, pressing Enter to confirm input-method text (for example Japanese) sent the message. (#223)
- **Fixed:** New replies in joined threads didn't show in the rooms list after a reconnect or reload. (#200)

## Week of 2026-10-26

- **New feature:** Talk privately: start a private conversation with one or more people from **Message** on a profile card, or the + beside the new Private section. Where the server supports them, private rooms show read receipts, which you can turn off. (#123, #129, #187)
- **New feature:** Your history shows before the server answers: a signed-in session keeps what it loaded on this device (30 days by default, deleted when you sign out), so a reload shows it at once. Search it with `user:` and `room:` filters, export it as `.jsonl`, and open an export read-only. (#135, #137, #171)
- **New feature:** Watch work happen live: terminal output shows in a real, read-only terminal you can expand to full screen, and `/live` types your next message as others watch. Live streams from v9 servers show only as plain cards. **Requires server protocol v10** (#162, #189, #191)
- **New feature:** A busy rooms list stays manageable: drag rooms into your order, mute a room or thread for a while, and fold headings down to what has news. Threads quiet for 3 days fold under Inactive, and Browse rooms is now Other Rooms. (#125, #145, #147, #148, #150, #151, #160, #185, #198)
- **New feature:** Make Apron look your way with a theme: Apron, Ferrous, Gumball, Linocut (high contrast, also for e-ink), or your own CSS. Fonts you chose before become a custom theme. (#174, #177)
- **New feature:** Copy selected messages as a readable Markdown log, reach everyone with a role with `@&role`, and get mention chips and suggestions while editing. Links to YouTube, X, Bluesky and Wikipedia get previews too. (#122, #159, #164, #168, #172, #181)
- **Changed:** Media from sites you haven't trusted no longer loads without your say-so: images, video and audio from anywhere but the chat server and your trusted sites wait for Load, Always load or Block. To load from every site you haven't blocked, choose Any site in Preferences → Media. (#163, #193, #194)
- **Changed:** Your profile and the server's settings are each one click away: Preferences opens at Profile from one button in the profile bar, and the server's name above the rooms list opens its details, with Connect to another server… and Disconnect. (#174, #177)
- **Improved:** A brief drop in connection is barely noticeable: no flashing banners or emptied page, and the room you're reading catches up first. Unread counts survive a reload on servers that keep read cursors, and notifications clear once you've read the room on another device. (#127, #128, #130, #154, #169, #173)

## Week of 2026-10-19

- **New feature:** Share any room, thread, message, person or invite with one link: link.apron.chat links open right in the app and show as chips in messages, and the ⋯ menu copies one. (#112, #119)
- **New feature:** Use the sign-in your server already has: sign in, or add a way to sign in, through its own sign-in page where it offers one. **Requires server protocol v9** (#89)
- **New feature:** See who reacted: long-press or right-click a reaction. (#90)
- **New feature:** Tell people about yourself with a profile bio of up to 250 characters. (#115, #116)
- **Changed:** The host serving Apron no longer learns which servers and rooms you open: your place in the app is kept after the `#` in the address, which browsers don't send. Old `?room=` bookmarks open the default room, so re-bookmark them. (#114)
- **Changed:** Moving other people's messages works on any server that allows it, not only Apron's own: whether you can is up to the server's permissions, not your admin or mod role. (#111)
- **Changed:** A room's purpose stays in view: its description is pinned under the header in three lines, and × hides it until it changes. Threads call it "Description" instead of "Summary". (#91, #94, #108, #117)
- **Improved:** Pick up where you left off: rooms and threads open at the New divider, remembered on this device even where the server keeps no read position. (#100)
- **Improved:** Moving messages into a thread no longer hides them from their authors, who are added to the thread. (#95)
- **Improved:** Writing on a phone keeps the app in view above the keyboard, with the header showing, and iPhone no longer zooms into the composer. (#97, #118)
- **Improved:** Hitting a rate limit no longer leaves you guessing when to retry: a countdown shows in the timeline and on Send, and a held-back room loads again by itself. (#109)
- **Improved:** Voice clips take about a quarter of the space, and any image your browser opens, such as HEIC or AVIF, works as an avatar. (#92, #96)
- **Fixed:** Passkey sign-in through 1Password in Chrome and Arc on macOS failed with "clientExtensionResults must be an object". (#106)
- **Fixed:** Going back to a room from a thread didn't open it at its latest message. (#102, #113)

## Week of 2026-10-12

- **New feature:** Bookmark, share or reload any room, thread or message: each has its own address, and a message's ⋯ menu has Copy link. (#86)
- **New feature:** On a phone, see when there's news elsewhere: the back arrow in a room's header counts your unread messages in other rooms, in orange with an @ when you're mentioned. (#84)
- **Changed:** On a phone, Back from the rooms list returns you to what you were reading, instead of skipping to the previous room. (#85)
- **Improved:** Tell what a thread is about and how lively it is from the room: thread cards show its summary, latest reply, and when it was last replied to. (#87)
- **Improved:** People who share a display name are no longer mixed up in mentions: each shows their user ID too. (#82)
- **Fixed:** A guest who signed up for an account appeared twice in a room's member list. (#81)

## Week of 2026-10-05

- **New feature:** Hear about mentions even when Apron is closed, with push notifications for signed-in accounts on servers that offer them. On iPhone and iPad, add Apron to the Home Screen first. (#48, #57, #61)
- **New feature:** Let people know whether you're around: set Online, Do not disturb or Invisible, shown as a dot on avatars in the member list. Do not disturb silences notifications, and you show as idle after five minutes away. (#48, #52, #68)
- **New feature:** Take a break from notifications: pause them for an hour, 8 hours, until tomorrow morning or until you resume, on all your devices at once. (#48)
- **New feature:** See images properly: click one to open it full screen, and page through the room's images with the arrow keys. (#53)
- **New feature:** Fix an attachment mistake without resending: remove or rename a message's files while editing it, or rename a file before you send it. (#70)
- **New feature:** Discover the conversations in a room: threads you haven't joined are listed under Other threads, and you can join or leave from the row. (#50, #66, #73, #74, #79)
- **Changed:** Apron needs a server that speaks protocol v8. **Requires server protocol v8** (#48)
- **Changed:** Notifications are simpler to set: one switch covers desktop and push, and **Notify me about** picks mentions, replies to you, private rooms or joined rooms, for each account. (#48, #57)
- **Changed:** Starting a thread asks for a title and an optional summary first. (#66, #71, #75)
- **Changed:** On phones and tablets, Enter starts a new line, as in other mobile chat apps; tap Send to send. (#60)
- **Changed:** The rooms list and member list open and close from buttons in the window's top corners, and a room's Edit and Leave moved into its header's ⋯ menu. (#51, #59, #62)
- **Improved:** With a passkey or email account, reopening Apron shows your rooms and messages from last time straight away, without waiting on the server. (#56, #67, #72)
- **Improved:** An update won't cost you a message: the update notice warns when reloading would lose one you haven't sent. (#53)

## Week of 2026-09-28

- **New feature:** Sign in without a passkey: create an account or sign in by email, with an emailed code or link. Add an email or a passkey from your profile as a second way back in. (#36)
- **New feature:** Rooms can say what they're for with a description, and private rooms (marked with a lock) keep conversations to their members. `/topic` now sets the description instead of the title. (#36)
- **New feature:** See who's who and manage a room: role badges beside names, and a member list that counts members and adds or removes them, as `/invite @user` and `/kick @user` do. (#36, #39)
- **New feature:** Find out who someone is: click a mention, name or avatar for their profile card, which warns when someone else uses the same name. From it you can mention them, copy their ID or add them to the room. (#47)
- **New feature:** Send several files with one message: attach them to a draft by picking, pasting, dropping or recording, check the previews, and send them with your text. (#35, #49)
- **Changed:** Room descriptions, private rooms, email sign-in, roles and member changes need a v7 server, and rooms on v6 servers no longer show their intro message. **Requires server protocol v7** (#36)
- **Changed:** Start thread gets a thread going in one step: it names the thread after the message, pins its gist as the summary, and quotes it in your reply. (#36)
- **Changed:** Passkey sign-in asks up front whether you're signing in or creating an account, and passkeys no longer pop up by themselves after a reconnect: tap Sign in on the banner. (#40, #41, #46)
- **Removed:** The client's banner about how long the demo server keeps messages. A server can say this in its own welcome notice. (#45)
- **Improved:** Uploads are quicker and keep where you were private: images are shrunk before upload, and photos are re-encoded, which removes location and other EXIF data. (#35)
- **Fixed:** Passkey sign-in did nothing with password-manager extensions such as 1Password. (#40, #43)
- **Fixed:** Accounts created with a passkey or invite got a random ID or "Member" instead of the name you chose. (#45)

## Week of 2026-09-21

The Apron web client moved out of shazow/apron into its own repository and deploys to web.apron.chat (#1). It spoke Apron protocol v6 and connected to server.apron.chat or any server you entered, as a guest or with a passkey. It had rooms and threads, Markdown messages with replies, edits, reactions and @mentions, slash commands, uploads, voice clips, live terminal output, typing indicators and a "New" divider at your last read message.

- **New feature:** Make Apron yours in Preferences: desktop notifications for mentions or every message, a light or dark theme, and your own fonts. (#23)
- **New feature:** Use Apron like an app: install it, and it opens even without a connection. When an update is deployed, a banner offers to reload instead of reloading under you. (#7, #8)
- **New feature:** See what a GitHub link is before you click: pull requests, issues, commits and repositories get preview cards, which you can leave out before sending or remove later. (#11, #13, #19, #20)
- **New feature:** Richer messages: tables, strikethrough and highlighted code, and bare web addresses become links. (#3, #6, #12, #16)
- **New feature:** Write faster: the composer completes `:shortcode` emoji and `#` rooms and threads. A + beside Rooms creates a room, and a member list opens from the room header. (#28)
- **New feature:** Bots and scripts can sign in too, with a token from the server, such as a bot token from `/invite-bot`. (#2)
- **New feature:** Back and Forward move between the rooms and threads you've opened, and joined threads show how many new replies they have. (#17, #30)
- **Changed:** Reacting takes fewer steps: React opens the full emoji picker with your frequent emoji first. Select mode picks anyone's messages and leaves the server to decide which moves it allows, and links in messages open in a new tab so the chat stays open. (#6, #10, #14)
- **Improved:** A second guard against injected markup: every message is cleaned of unsafe HTML after it's formatted. (#12)
- **Fixed:** Emoji in messages and reactions showed as plain text symbols instead of color emoji. (#21)
