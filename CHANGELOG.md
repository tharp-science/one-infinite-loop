# Changelog

Versions published to the GitHub marketplace and to the THARP organization library. 0.4.1 and 0.6.0 were steps inside pull requests and were never released on their own; what they added is listed under the release that carried it.

## 0.9.1, 17 November 2026

- In the desktop app the source pills and the coloured ⌘ came out as plain text: the app draws a menu button's label in its own style and drops the colours of what it holds. A row is now its ⌘, one button with the title and any detail, and its source pill after it, outside the button. On the line of sources, each name keeps its button and gets a mark in its pill colours before it.

## 0.9.0, 17 November 2026

- A new icon from the One Infinite Loop page on tharp.science: the loop mark on the hero's plasma, in place of the THARP² lettering, which did not read as the loop at small sizes. Its source is `extras/icon/icon.svg`.
- The menu above the prompt, redrawn. Each source is a pill of its own colour, in the rows, in the head and on one line of source pills, so a source never reads as part of a title. Where a surface draws no background behind text, the pill is its source's colour in bold.
- The head repeats what you typed and says, per source, how many it found, which it is still asking, and which it could not reach. Each source's rows appear as soon as it answers, not after the slowest.
- Fragments picked before have their own section and the coloured ⌘; results show their kind and path or summary.
- The menu keeps to the rows the band has, and counts the rest: "+ n more · keep typing to narrow".
- A source pill keeps the words typed (`⌘scuba:river` from `⌘river`); after a source, "all sources" undoes the narrowing.
- ⌘ on its own shows the usage in two lines instead of seven. Nothing found, and no source set up, each offer your own words in quotes as a side. After a pick, the next step leads; once two are strung, "keep them as two separate loops" comes last.
- In the desktop app the mod starts with the session, so the first message of a chat arrives without its block. The skill now reads that as the mod still starting, not as no mod: it no longer says nothing was resolved, and for ⌘ sent first it explains the loop in two sentences and asks for ⌘ once more instead of guessing whether you are new or what is connected.
- Skill 1.8.0.

## 0.8.0, 15 November 2026

Good artists copy, great artists sumi.

- **Loop sound** setting, on by default: when every loop in a message you send resolves, the Mac plays its own Sosumi alert. The sound is read from macOS where it is installed (`/System/Library/Sounds/Sosumi.aiff`) and is not shipped with the mod: Apple's licence does not allow passing it on. Elsewhere, and with the setting `off`, nothing plays.

## 0.7.1, 15 November 2026

- Set the minimum to Claude Code 2.1.325, the version verified with a clean marketplace install and the plugin test suite. Claude Code 2.1.290 rejected the marketplace install option and the prompt autocomplete hook.

## 0.7.0, 15 November 2026

- Loops sent from a phone or the web through Remote Control, or by a host that marks its prompts as its own, now get their addresses attached. Before, only prompts typed at the prompt did.
- The right-Command key installer is offered only on macOS and only when the message was typed at the computer. From a phone, its permission prompts would appear where nobody sees them.
- **Loop shortcut** setting: characters of your choosing, such as `;;`, turn into ⌘ as you type them, on any system. Used only when it cannot be part of an ordinary word.
- The README explains how to type ⌘ on Windows (Microsoft PowerToys Keyboard Manager) and on iPhone and iPad (Text Replacement). Neither has been tried yet.
- Skill 1.7.0.

## 0.5.0, 15 November 2026

- ⌘ sent on its own starts a guided first loop for someone new: the key, a loop with nothing set up, a loop through a connected source. The mod tells Claude which sources it can reach and where the key installer is.
- `extras/right-command/`: a small helper of our own that makes a tap on the right Command key type ⌘ on macOS, with an installer that builds it from source or uses the checked prebuilt binary, needs no password and can uninstall itself.
- On the desktop, typing `icw` as a word offers ⌘ in the menu above the prompt.
- With no source set up, the menu says so and shows what works without one (a link or quoted words); the note Claude receives says why a side is missing.
- Added a Claude Code version requirement in `engines` and made updating Claude Code the first install step. The supported minimum was corrected in 0.7.1.
- Skill 1.5.0.

## 0.4.0

First public version: ⌘ as an operator in the Claude Code prompt, a live menu to pick fragments from Obsidian, Notion and Scuba, addresses attached on send, loops drawn as links, `/1loop`.
