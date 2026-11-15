# One Infinite Loop

A mod for Claude Code that makes ⌘, the loop, a working operator in the prompt. ⌘ is the portable character for **i/c/w**, "in correspondence with": `A⌘B` sets two things against each other so that one can show something about the other.

The mod does one job: it turns what you type into addresses and hands them to Claude. It never decides how a loop is read. That stays with you and Claude, guided by the bundled `loop-correspondence` skill.

It ships with three sample sources, Notion, Scuba and an Obsidian vault, and is meant to be adapted to your own.

## Install

**First, update Claude Code.** The mod requires Claude Code 2.1.325 or later. The desktop app updates itself. In a terminal, run `claude update`, then `claude --version` to check. Older builds may reject the install command or fail to load the mod’s hooks.

At the prompt of a terminal session:

```
/plugin install one-infinite-loop --marketplace tharp-science/one-infinite-loop
```

From a shell:

```bash
claude plugin install one-infinite-loop --marketplace tharp-science/one-infinite-loop
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `tharp-science/one-infinite-loop`, then Add plugin.

## Using it

Type ⌘ in the prompt, or type `icw` and pick ⌘ from the menu (the terminal's typeahead, the desktop app's menu above the prompt). To start, send ⌘ on its own.

| You type | What happens |
| --- | --- |
| `⌘` | A short usage card, the sources, and fragments you picked lately. |
| `⌘river` | After a short pause, every source is searched and the results listed. |
| `⌘scuba:river` | Only that source is searched. |
| pick a row | A handle such as `⌘scuba:river-papers` is written into your draft and remembered. |
| ⌘ again after a pick | The two are strung together: `scuba:river-papers⌘`, ready for the next pick. One row keeps them separate if you prefer. |
| `"a new question"⌘…` or `https://a.link⌘…` | Your own words, or a link, set against a fragment. Words in double quotes are passed on as written; `[square brackets]` are looked up. |
| `⌘` sent on its own | Claude walks you through a first loop of your own: the right-Command key, a loop with nothing set up, a loop through a source. If you have used it before, a short reminder. |
| `⌘word` with no source set up | The menu says no source is set up, and shows what works without one: a link or your own words in quotes. |

When you send, each side is resolved to an address and attached as context only Claude reads. Your typed text is never changed. In the transcript each ⌘ is coloured and each resolved side is a link.

`/1loop` lists what resolved in this session, `/1loop sources` shows each source and whether it answered, `/1loop forget <handle>` drops a handle, and `/1loop pick` opens the picker as a pane.

In the desktop app the picker is a menu above the prompt, chosen by click. In the terminal it is the typeahead, chosen by keyboard, and a sent message keeps its usual look with its links listed beneath.

## What it sends, and where

Read this before installing. While you type a word that contains ⌘, the mod sends that word to your sources **before you pick anything or press Enter**: to all of them for a bare `⌘word`, to one for `⌘source:word`. On send it searches again for any side you typed but did not pick. It sends queries only to the sources below, makes no model calls, makes no other web requests, and writes to no source. Handles you pick are kept on your machine in the mod's own store.

One more thing, only on your yes. When you send ⌘ on its own, Claude offers to install the right-Command key (see [A key that types ⌘](#a-key-that-types-)): a small helper, run at login, that watches the keyboard for a tap of the right Command key and types ⌘. Claude runs its installer only if you agree, and macOS still asks you for Input Monitoring and Accessibility before it can do anything. Without that yes nothing is installed, and the mod itself never runs a program.

## Sample sources

| Key | Source | Reached through | Kind of search |
| --- | --- | --- | --- |
| `obsidian` | An Obsidian vault | The vault folder on your machine; no server | Note names |
| `notion` | Notion | The Notion MCP server's `notion-search` | Notion's workspace search |
| `scuba` | Scuba | The Scuba MCP server's `search` | Hybrid keyword and vector; collections and captures |
| `web` | Websites | None: a pasted URL is the address | |

- **Obsidian** needs one setting, **Obsidian vault folder**: the absolute path of your vault. Until it is set the source stays quiet.
- **Notion** and **Scuba** need their MCP servers connected in Claude Code. Each server is found by a tool only it has, so server names need no setup; the settings can override them.
- A source that is not set up, not connected, or does not answer is skipped. Nothing else breaks. When no source answers at all, the menu and the note Claude receives say so.
- With no source set up, links and quoted words still work: `https://a.link⌘"a question"` needs no setup.

## Settings

Source order, enabled sources, Notion and Scuba server names, Obsidian vault folder, Obsidian link base, send budget (3 s), menu rows (20), candidates on send (5), link style (`inline` redraws your message outside the terminal; `below` leaves it alone and lists links under it), shimmer length (15 s; 0 is off), loop shortcut (off; see [Other ways to type ⌘](#other-ways-to-type-)), loop sound (`sosumi`: on a Mac, the system's own Sosumi plays when every loop in a sent message resolves; the sound is read from macOS, not shipped; `off`), debug.

## A key that types ⌘

`extras/right-command/` makes a tap on the right Command key type ⌘ on macOS. Windows and Linux have no key helper; see [Other ways to type ⌘](#other-ways-to-type-) below. Held down for a shortcut it is still Command; only a tap of under half a second on its own types the character. It is a small helper of its own, `RightCommandKey.swift`, run at login; it watches for that tap, keeps nothing and makes no network request.

```bash
bash extras/right-command/install.sh
```

The installer builds the helper from the source beside it where a Swift compiler is installed, and otherwise uses the prebuilt universal binary in `prebuilt/`. The checksum shows that binary is the one committed here; it does not prove it was built from the source beside it. If that matters to you, install Apple's Command Line Tools (`xcode-select --install`) first and the installer builds from source instead. It needs no password. macOS then asks for **Input Monitoring** and **Accessibility** for "One Infinite Loop Key" in System Settings > Privacy & Security; only you can turn those on. `bash extras/right-command/install.sh --uninstall` removes it. When you send ⌘ on its own, Claude offers to run the installer for you.

## Other ways to type ⌘

Any system, nothing to install:

- **icw.** Type `icw` as a word and pick ⌘ from the menu above the prompt (desktop app) or the typeahead (terminal).
- **A loop shortcut of your own.** In the plugin's settings, set **Loop shortcut** to a few characters you never type otherwise, such as `;;`. Typing them in the prompt turns them into ⌘ at once. It must be 2 to 8 characters with no spaces, and not only letters or digits, so that no ordinary word is ever replaced; anything else is ignored.

**Windows: a key combination that types ⌘.** Microsoft PowerToys can do this, with no script of ours:

1. Install [PowerToys](https://learn.microsoft.com/en-us/windows/powertoys/) and open its Settings.
2. Turn on **Keyboard Manager**, then choose **Remap a shortcut** and add a remapping.
3. Under **Select**, press the combination you want, such as Ctrl+Alt+Shift+L. It must start with Ctrl, Alt, Shift or the Windows key and end with an ordinary key. Pick one nothing else uses; on keyboards with AltGr, Ctrl+Alt combinations can clash with characters you already type.
4. Under **To send**, choose **Text** and enter `⌘` (copy it from this page).
5. Leave the target app empty for everywhere, or enter the Claude app's process name to keep it there.

PowerToys has to be running for the combination to work. The mod has not yet been tried on Windows; if something there does not work, please open an issue.

**iPhone and iPad.** The mod runs where the Claude Code session runs, on your computer or in the cloud, and the phone shows it, for instance through Remote Control. To type ⌘ on the phone, use iOS's own text replacement: Settings > General > Keyboard > Text Replacement, add one with ⌘ as the phrase and `icw` as the shortcut. It then works in every app. A Loop shortcut set in the plugin's settings works from the phone too, since the session turns it into ⌘. From the phone, Claude does not offer to install the right-Command key: its permission prompts would appear on the computer. The menu above the prompt has not yet been tried on a phone.

## Clickable Obsidian notes

A note has a path and no web address, and the desktop app only opens web links. `extras/vault-redirect/server.mjs` is a small local service that turns `http://localhost:27124/vault/<path>` into opening that note in Obsidian. It listens on your machine only, reads and writes nothing, and refuses any path outside the vault.

```bash
LOOP_VAULT_ROOT=/path/to/your/vault node extras/vault-redirect/server.mjs
```

Then set **Obsidian link base** to `http://localhost:27124/vault/`. The `.plist` beside the script keeps it running after login on macOS.

## Working on the mod

`claude plugin validate .` and `claude plugin test .` check and test it; run them with the same Claude Code build that will load the mod. `CHANGELOG.md` lists what each version changed.

For type-checking in an editor: `tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code writes, with the mod API's types, the first time it loads the mod from a folder (for example `claude --plugin-dir .`). The folder is not committed. Until it exists, an editor reports the types as missing; validate and test do not need it.

## Changing the sources

The skill and the mod meet in one place only: the `[one-infinite-loop]` block the mod attaches. So each can change on its own.

**To give the mod another source**

1. In `hooks/adapters.ts`, add a function with the same shape as `notion` or `scuba`: it takes a query and a limit and returns fragments, each with `source`, `title`, `address` and optionally `snippet` and `kind`.
2. Add its key to `SEARCHED` and to `ask` in the same file. If it is reached through an MCP server, add a marker tool to `MARKER` (a tool only that server has). Add the key to `SOURCES` in `hooks/parse.ts`.
3. Add the key to the `sourceOrder` and `enabledSources` defaults in `.claude-plugin/plugin.json`.
4. Record one real result from the source and add a test beside the others in `tests/send.test.ts`. Run `claude plugin validate .` and `claude plugin test .` with the same Claude Code build that will load the mod.

To drop a source, remove its key from the two defaults; nothing else has to change.

**To change what the skill knows about sources**

The skill names no source. It reads whatever the sides are: an address from the mod's block, a link, or pasted text. That is why the same file works in a model with no mod at all, such as ChatGPT or the Claude apps: there it simply has no `[one-infinite-loop]` block and works from the text. If you add a source to the mod, the skill needs no edit. Edit the skill only when the *grammar* changes (a new form, a new meaning for quotes or brackets), and then change the table in its "The forms" section and the tests in `tests/parse.test.ts` together.

**Keeping copies of the skill in step**

`skills/loop-correspondence/SKILL.md` is the copy this mod ships. If you keep the skill elsewhere too (a skill store, another assistant's custom instructions), decide which one you edit, bump the `Version` line at its top when you do, and paste it over the other. For an assistant without skills, paste the whole file as its instructions.

## Limits

- In the desktop app, menu rows are chosen by click; the prompt box does not hand a mod the Enter or arrow keys.
- One ⌘ shows one colour at a time; the mod API has no gradient for text.
- The Obsidian sample matches note names only, not their text.
- The mod API is early access and may change between Claude Code releases.

## The name

The looped square is one line with no end, and it has sat on a certain keyboard for forty years. The name is a nod to that, nothing more: this project is not affiliated with or endorsed by Apple. The loop sound is the same kind of nod: Sosumi, named "so sue me" by an Apple engineer in 1991. The mod plays the copy your Mac already has and never ships it.

## Licence

MIT, see `LICENSE`. Copyright Thyke Applied Research & Participatory Prototyping (THARP). The lettered mark used as the icon is a mark of THARP and is not covered by the MIT licence.
