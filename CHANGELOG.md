# Changelog

Versions published to the GitHub marketplace and to the THARP organization library. 0.4.1 and 0.6.0 were steps inside pull requests and were never released on their own; what they added is listed under the release that carried it.

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
- `engines` declares Claude Code 2.1.290 or later; the README makes updating Claude Code the first install step.
- Skill 1.5.0.

## 0.4.0

First public version: ⌘ as an operator in the Claude Code prompt, a live menu to pick fragments from Obsidian, Notion and Scuba, addresses attached on send, loops drawn as links, `/1loop`.
