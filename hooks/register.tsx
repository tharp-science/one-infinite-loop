// One Infinite Loop: makes ⌘ a working operator in the prompt.
// Picker while typing, addresses attached on send, loops drawn as links.
// The mod finds addresses only; how a loop is read stays with Claude.

import type {
  EngineInterface,
  PluginOptions,
  Register,
  RenderChildren,
} from 'claude-code'

import { SETUP_HINT, canSearch, lastAnswer, noneAnswered, reachOf, search, within } from './adapters'
import type { Config } from './adapters'
import { LOOP, SOURCES, glyphsOf, parse, sidesOf } from './parse'
import { contextBlock, offered, resolveAll, resolvedSides } from './resolve'
import { allResolved, chime } from './chime'
import type { Resolved } from './resolve'
import {
  findHandle,
  forgetHandle,
  keepHandle,
  loadHandles,
  slugFor,
} from './store'
import type { Fragment, Handle } from './store'

const words = (v: unknown): string[] =>
  String(v ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

const configOf = (options: PluginOptions): Config => {
  const enabled = words(options.enabledSources)

  return {
    order: words(options.sourceOrder).filter(s => enabled.includes(s)),
    servers: {
      notion: String(options.notionServer ?? ''),
      scuba: String(options.scubaServer ?? ''),
    },
    obsidianVault: String(options.obsidianVault ?? ''),
    obsidianLinkBase: String(options.obsidianLinkBase ?? ''),
    sendBudgetMs: Number(options.sendBudgetMs) || 3000,
    rows: Number(options.rows) || 20,
    candidates: Number(options.candidates) || 5,
    isDebug: options.debug === true,
    linkStyle: String(options.linkStyle ?? 'inline'),
    shimmerSeconds: Number(options.shimmerSeconds ?? 15),
    loopShortcut: shortcutOf(options.loopShortcut),
    loopSound: options.loopSound === 'off' ? 'off' : 'sosumi',
  }
}

/**
 * A loop shortcut is used only when it cannot be part of an ordinary word:
 * 2 to 8 characters, no spaces, not only letters or digits.
 */
const shortcutOf = (value: unknown): string => {
  const s = String(value ?? '').trim()

  return s.length >= 2 && s.length <= 8 && !/\s/.test(s) && !/^[\p{L}\p{N}]+$/u.test(s) && s !== LOOP
    ? s
    : ''
}

/** The loops resolved since the module loaded, for `/1loop`. */
const sessionLoops: Resolved[] = []

/** When each message was first drawn, and the timer behind the shimmer. */
const firstDrawn = new Map<string, number>()
let liveUntil = 0
let ticker: { cancel: () => void } | undefined

/** A hue as a colour every surface takes: full rainbow, even brightness. */
const hueColor = (hue: number): string => {
  const h = ((hue % 360) + 360) % 360
  const channel = (offset: number) => {
    const k = (offset + h / 30) % 12
    const level = 0.62 - 0.33 * Math.max(-1, Math.min(k - 3, 9 - k, 1))

    return Math.round(level * 255)
      .toString(16)
      .padStart(2, '0')
  }

  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** The handle store, read at most every two seconds while redrawing. */
let held: { at: number; handles: Handle[] } | undefined
async function heldHandles($: EngineInterface): Promise<Handle[]> {
  if (!held || Date.now() - held.at > 2000) {
    held = { at: Date.now(), handles: await loadHandles($) }
  }

  return held.handles
}

/** Whether the prompt box ever asked the picker, for `/1loop sources`. */
const picker = { asked: 0, lastToken: '' }

/**
 * Origins that are the person's own typing. The desktop app stores a typed
 * message with origin `sdk`, the terminal `composer`.
 */
const PERSON = new Set<string>(['composer', 'sdk', 'bridge'])

/** The picker pane: for surfaces whose prompt box never asks the picker. */
const PANE = 'loop-pick'
const pick = { source: '', query: '', hits: [] as Fragment[], note: '' }
const editing = { asked: 0, surface: '' }

/**
 * The live menu above the prompt: what the loop being typed could mean.
 * Each line is a run of parts. A part with `pill` names a source and is
 * drawn as that source's pill; nothing else is drawn that way, so a pill
 * always means a source and titles stay plain.
 */
type Part = { text: string; tone?: 'dim' | 'bold' | 'loop' | 'warn'; pill?: string }
type MenuRow = {
  parts: Part[]
  write: string
  fragment?: Fragment
  /** Set on the row that turns the prefix loop just picked into an infix. */
  join?: { from: string; to: string }
}
type Chip = { source: string; label: string; write: string }
type MenuLine = {
  parts?: Part[]
  row?: MenuRow
  chips?: { lead: string; items: Chip[]; tail?: string }
  /** A search result: the lines dropped first when the band is full. */
  isHit?: boolean
}
const menu = {
  isOpen: false,
  head: [] as Part[],
  lines: [] as MenuLine[],
  /** Lines the terminal's band carries too; its rows are in the typeahead. */
  help: [] as Part[][],
  seq: 0,
}

const plain = (text: string): Part => ({ text })
const dim = (text: string): Part => ({ text, tone: 'dim' })
const bold = (text: string): Part => ({ text, tone: 'bold' })
const warn = (text: string): Part => ({ text, tone: 'warn' })
const pill = (source: string, text = source): Part => ({ text, pill: source })
const GLYPH: Part = { text: LOOP, tone: 'loop' }
/** The colour of the first loop in a draft, so the menu matches it. */
const GLYPH_COLOR = hueColor(200)
const WARN_COLOR = '#A8450C'

/**
 * One tint per source, text and ground both, contrast above 6:1. Where the
 * surface draws no background behind text, the bold text colour alone is
 * left, which still sets the source apart from the title.
 */
const PILL: Record<string, { color: string; ground: string }> = {
  obsidian: { color: '#5B3FA8', ground: '#EEE8FB' },
  notion: { color: '#3D3D3A', ground: '#E8E7E1' },
  scuba: { color: '#1D6559', ground: '#DDF0EC' },
}
const PILL_OTHER = { color: '#3D3D3A', ground: '#E8E7E1' }

/** How the loop is used, short enough for the band: the card Claude gets is `USAGE`. */
const menuUsage = (first: string): Part[][] => [
  [
    plain(`${LOOP}name`), dim('  everywhere     '),
    plain(`${LOOP}${first}:name`), dim('  one source     '),
    plain(`a${LOOP}b`), dim('  connect two     '),
    plain(`a${LOOP}`), dim('  one side open'),
  ],
  [
    plain(`"words"${LOOP}b`), dim('  or  '), plain(`https://…${LOOP}b`),
    dim('  set something new against what exists'),
  ],
]

/**
 * What each source said to the search under way. A source that is not set
 * up or not connected stays quiet (`off`) and is left out; only one that was
 * asked and did not answer in time is named (`silent`).
 */
type Status = number | 'asking' | 'silent' | 'off'
const stateOf = (source: string, status: Map<string, Status>): Status =>
  status.get(source) ??
  (lastAnswer.get(source)?.state === 'unavailable' ? 'off' : 'asking')
const statusParts = (sources: string[], status: Map<string, Status>): Part[] =>
  sources.filter(source => stateOf(source, status) !== 'off').flatMap((source, n) => {
    const state = stateOf(source, status)

    return [
      ...(n > 0 ? [plain(' ')] : []),
      pill(source, typeof state === 'number' ? `${source} ${state}` : source),
      ...(state === 'asking' ? [dim('…')] : state === 'silent' ? [warn(' not reached')] : []),
    ]
  })

const pickedRow = (kept: string) => (h: Handle): MenuLine => ({
  row: {
    parts: [GLYPH, plain(` ${h.title}   `), pill(h.source)],
    write: `${kept}${h.source}:${h.slug} `,
  },
})

/** Opens the menu with these lines, replacing what it showed. */
function showMenu(head: Part[], lines: MenuLine[], help: Part[][] = []): void {
  menu.isOpen = true
  menu.head = head
  menu.lines = lines
  menu.help = help
}

/** How the loop is used: shown when ⌘ stands alone, typed or sent. */
const USAGE = [
  `${LOOP}name  search every source for a fragment`,
  `${LOOP}source:name  search one source (obsidian, notion, scuba)`,
  `a${LOOP}b  connect two fragments: pick one, type ${LOOP} again, pick the other`,
  `"a new question"${LOOP}b  or  https://a.link${LOOP}b  connect something new to what exists`,
  `a${LOOP}  leave the other side open`,
  `${LOOP}https://…  a web page or a file path is already an address`,
  'Pick a row from the list. /1loop lists what resolved in this session.',
]

/** A file every macOS has: the key helper is offered only where it exists. */
const MACOS_MARKER = '/System/Library/CoreServices/SystemVersion.plist'

/** `icw` typed as a word of its own, just before the cursor. */
const ICW_AT_END = /(^|\s)icw$/

/** The loop being typed: the word that ends at the cursor, split at its ⌘. */
const spotAt = (text: string, cursor: number) => {
  const before = text.slice(0, cursor)
  const start = before.search(/\S+$/)
  if (start < 0) return undefined
  const token = before.slice(start)
  const at = token.lastIndexOf(LOOP)

  return at < 0
    ? undefined
    : { start, kept: token.slice(0, at + 1), typed: token.slice(at + 1) }
}

/** What a search under way needs to draw its results as they come. */
type Ask = {
  seq: number
  kept: string
  query: string
  needle: string
  word: string
  sources: string[]
  head: Part[]
  quoted: string
  chips: MenuLine
}

/**
 * Brings the menu in line with the draft. Sources and handles show at once;
 * a search waits 200 ms for the typing to pause, and a later edit drops it.
 */
function refreshMenu(
  $: EngineInterface,
  config: Config,
  text: string,
  cursor: number,
): void {
  const seq = ++menu.seq
  const spot = spotAt(text, cursor)
  // icw, the operator spelled out, offers the character: on the desktop there
  // is no typeahead to do it, and a key that types ⌘ may not be set up yet.
  if (!spot && ICW_AT_END.test(text.slice(0, cursor))) {
    showMenu(
      [dim('icw  →  '), GLYPH],
      [
        {
          row: {
            parts: [GLYPH, plain('  write '), GLYPH, dim('    in correspondence with')],
            write: LOOP,
          },
        },
        { parts: [dim(`send ${LOOP} on its own for other ways to type it`)] },
      ],
    )
    $.ui.invalidate('ui.render')

    return
  }
  if (!spot) {
    if (menu.isOpen) {
      menu.isOpen = false
      menu.lines = []
      $.ui.invalidate('ui.render')
    }

    return
  }
  const { typed } = spot
  // ⌘a⌘ is a picked side with the operator typed straight after it: the
  // leading ⌘ goes, so what follows makes a⌘b and not a chain.
  const kept = /^⌘[^⌘]+⌘$/.test(spot.kept) ? spot.kept.slice(1) : spot.kept
  const colon = typed.indexOf(':')
  const named = colon > 0 ? typed.slice(0, colon) : ''
  const isSourced = config.order.includes(named)
  // The words as typed, kept when the source changes; the query searched.
  const word = isSourced ? typed.slice(colon + 1) : typed
  const query = word.replace(/[-_]+/g, ' ').trim()
  const searched = config.order.filter(source => canSearch(source))
  const lowered = typed.toLowerCase()
  // One line of source pills. A pill whose name the person is spelling
  // finishes the name; any other carries the words typed so far.
  const chips: MenuLine = isSourced
    ? {
        chips: {
          lead: 'search instead in',
          items: [
            { source: '', label: 'all sources', write: `${kept}${word}` },
            ...searched
              .filter(source => source !== named)
              .map(source => ({ source, label: source, write: `${kept}${source}:${word}` })),
          ],
        },
      }
    : {
        chips: {
          lead: 'only in',
          items: searched.map(source => ({
            source,
            label: source,
            write:
              query.length < 2 || source.startsWith(lowered)
                ? `${kept}${source}:`
                : `${kept}${source}:${word}`,
          })),
        },
      }
  const show = (head: Part[], lines: MenuLine[], help: Part[][] = []) => {
    if (seq !== menu.seq) return
    showMenu(head, lines, help)
    $.ui.invalidate('ui.render')
  }
  const recentThen = (
    head: Part[],
    label: string,
    before: MenuLine[],
    after: MenuLine[],
    help: Part[][] = [],
    leaveOut = '',
  ) => {
    show(head, [...before, ...after], help)
    void heldHandles($).then(handles => {
      const recent = [...handles]
        .filter(h => (!isSourced || h.source === named) && `${h.source}:${h.slug}` !== leaveOut)
        .sort((a, b) => b.usedAt - a.usedAt)
        .slice(0, 4)
        .map(pickedRow(kept))
      if (recent.length > 0) {
        show(head, [...before, { parts: [dim(label)] }, ...recent, ...after], help)
      }
    })
  }

  // a⌘ with a picked fragment on the left: the two are strung together by
  // default. One row, last, undoes that, for two separate loops.
  const strung = /^([^\s⌘]+:[^\s⌘]+)⌘$/.exec(kept)
  if (strung && typed === '') {
    const apart: MenuLine = {
      row: {
        parts: [dim('keep them as two separate loops   '), plain(`${LOOP}${strung[1]} ${LOOP}…`)],
        write: '',
        join: { from: kept, to: `${LOOP}${strung[1]} ${LOOP}` },
      },
    }
    recentThen(
      [plain(strung[1] ?? ''), GLYPH, bold('…'), dim(' · with what? type a name or pick')],
      'Picked lately',
      [],
      [chips, apart],
      [],
      strung[1],
    )

    return
  }
  // The loop on its own, nothing typed after it: how it is used.
  if (typed === '' && kept === LOOP) {
    const withTail: MenuLine = {
      chips: { ...chips.chips!, tail: '/1loop lists this session' },
    }
    recentThen(
      [GLYPH, dim(' · type a name to search every source, or pick one below')],
      'Picked lately',
      [],
      [withTail],
      menuUsage(searched[0] ?? 'source'),
    )

    return
  }
  // A shortcut such as ⌘K: one character that names no source.
  if (!isSourced && typed.length === 1 && !searched.some(s => s.startsWith(lowered))) {
    show([], [])
    menu.isOpen = false

    return
  }
  if (query.length < 2) {
    const head = isSourced
      ? [
          GLYPH, bold(word), dim(' · in '), pill(named),
          dim(query.length === 0 ? '    type two characters to search' : '    one more character to search'),
        ]
      : [GLYPH, bold(typed), dim(' · all sources')]
    recentThen(head, isSourced ? `Picked lately in ${named}` : 'Picked lately', [], [chips])

    return
  }

  const sources = isSourced ? [named] : searched
  const ask: Ask = {
    seq,
    kept,
    query,
    needle: word.toLowerCase(),
    word,
    sources,
    head: isSourced
      ? [GLYPH, bold(word), dim(' · ')]
      : [GLYPH, bold(word), dim(' · all sources    ')],
    // Your own words as a side: in front of the loop, or after a side
    // already there.
    quoted: kept === LOOP ? `"${query}"${LOOP}` : `${kept}"${query}" `,
    chips,
  }
  show([...ask.head, ...statusParts(sources, new Map())], [chips])
  $.clock.after(200, () => {
    if (seq !== menu.seq) return
    void searchMenu($, config, ask)
  })
}

/**
 * Asks each source and draws its rows as soon as it answers, so a slow
 * source holds up only itself.
 */
async function searchMenu(
  $: EngineInterface,
  config: Config,
  ask: Ask,
): Promise<void> {
  const handles = await heldHandles($)
  if (ask.seq !== menu.seq) return
  const known: MenuRow[] = handles
    .filter(
      h =>
        ask.sources.includes(h.source) &&
        (h.slug.includes(ask.needle) ||
          h.title.toLowerCase().includes(ask.query.toLowerCase())),
    )
    .slice(0, 3)
    .map(h => pickedRow(ask.kept)(h).row!)
  const found = new Map<string, Fragment[]>()
  const status = new Map<string, Status>()
  const draw = () => {
    if (ask.seq !== menu.seq) return
    // Sources turn about, so one does not fill the menu.
    const lists = ask.sources.map(source => found.get(source) ?? [])
    const mixed: Fragment[] = []
    for (let n = 0; n < Math.max(0, ...lists.map(f => f.length)); n++) {
      for (const hits of lists) {
        const hit = hits[n]
        if (hit) mixed.push(hit)
      }
    }
    const seen = new Set(known.map(row => row.write))
    const hits: MenuRow[] = mixed
      .map(hit => {
        const detail = [hit.kind, hit.snippet].filter(Boolean).join(' · ')

        return {
          parts: [plain(`${hit.title}   `), pill(hit.source), ...(detail ? [dim(`  ${detail}`)] : [])],
          write: `${ask.kept}${hit.source}:${slugFor(handles, hit)} `,
          fragment: hit,
        }
      })
      .filter(row => !seen.has(row.write) && seen.add(row.write))
    const isDone = ask.sources.every(source => status.has(source))
    const lines: MenuLine[] = []
    if (known.length > 0) {
      lines.push({ parts: [dim('Picked before')] }, ...known.map(row => ({ row })))
    }
    if (hits.length > 0) {
      lines.push({ parts: [dim('Found')] }, ...hits.map(row => ({ row, isHit: true })))
    }
    const status$ = statusParts(ask.sources, status)
    if (known.length + hits.length > 0 || !isDone) {
      showMenu([...ask.head, ...status$], [...lines, ask.chips])
    } else if (noneAnswered(ask.sources)) {
      // Nothing could be asked: say so, and offer what works without a source.
      showMenu(
        [GLYPH, bold(ask.word), dim(` · ${SETUP_HINT.menu}`)],
        [
          {
            row: {
              parts: [plain(ask.quoted.trim()), dim('    your words as one side: works without a source')],
              write: ask.quoted,
            },
          },
        ],
        SETUP_HINT.lines.map(line => [dim(line)]),
      )
    } else {
      showMenu(
        [GLYPH, bold(ask.word), dim(' · nothing found    '), ...status$],
        [
          {
            row: {
              parts: [plain(ask.quoted.trim()), dim('    use your words as written for this side')],
              write: ask.quoted,
            },
          },
          ask.chips,
        ],
      )
    }
    $.ui.invalidate('ui.render')
  }

  draw()
  await Promise.all(
    ask.sources.map(async source => {
      const hits = await within(
        $,
        search($, config, source, ask.query, config.rows),
        4000,
        null as Fragment[] | null,
      )
      if (ask.seq !== menu.seq) return
      found.set(source, hits ?? [])
      status.set(
        source,
        hits === null
          ? 'silent'
          : lastAnswer.get(source)?.state === 'unavailable'
            ? 'off'
            : hits.length,
      )
      draw()
    }),
  )
}

/** Writes a menu row over the loop being typed, and saves a picked fragment. */
async function pickRow(
  $: EngineInterface,
  config: Config,
  row: Pick<MenuRow, 'write' | 'fragment' | 'join'>,
): Promise<void> {
  const box = await $.prompt.read()
  const spot = spotAt(box.text, box.cursor)
  const isIcw = !spot && ICW_AT_END.test(box.text.slice(0, box.cursor))
  const start = spot
    ? spot.start
    : isIcw
      ? box.cursor - 'icw'.length
      : box.text.length
  const text = box.text.slice(0, start) + row.write + box.text.slice(box.cursor)
  const cursor = start + row.write.length
  if (row.fragment) {
    const slug = row.write.trim().slice(row.write.indexOf(':') + 1)
    await keepHandle($, { ...row.fragment, slug: slug.trim() })
    held = undefined
  }
  if (row.join) {
    // The prefix loop just picked becomes the left side of an infix.
    const at = box.text.lastIndexOf(row.join.from)
    if (at < 0) return
    const joined =
      box.text.slice(0, at) +
      row.join.to +
      box.text.slice(at + row.join.from.length)
    const end = at + row.join.to.length
    await $.prompt.fill({ text: joined, mode: 'replace', cursor: end })
    refreshMenu($, config, joined, end)

    return
  }
  await $.prompt.fill({ text, mode: 'replace', cursor })
  refreshMenu($, config, text, cursor)
  // After a fragment picked in prefix form, offer to connect it to another.
  const handle = row.write.trim()
  const isHandle = row.write.endsWith(' ') && handle.includes(':')
  if (isHandle && handle.startsWith(LOOP) && !handle.slice(1).includes(LOOP)) {
    menu.seq += 1
    showMenu(
      [dim('Added  '), GLYPH, plain(handle.slice(1)), dim('  · kept for next time')],
      [
        {
          row: {
            parts: [plain(handle.slice(1)), GLYPH, plain('…'), dim('    connect it with another fragment')],
            write: '',
            join: { from: row.write, to: `${handle.slice(1)}${LOOP}` },
          },
        },
        { parts: [dim('or keep writing; Enter sends')] },
      ],
    )
    $.ui.invalidate('ui.render')
  }
}


export const register: Register = (on, options) => {
  const config = configOf(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: '1loop',
      description: 'List resolved loops; sources; forget <handle>',
      argumentHint: '[pick | sources | forget <handle>]',
    })
    editing.surface = e.surface ?? ''

    return next(e)
  })

  // ── While typing: the picker ────────────────────────────────────────────
  on('prompt.autocomplete', async ($, e, next) => {
    picker.asked += 1
    picker.lastToken = e.token
    if (!e.token.includes(LOOP) && e.token !== 'icw') return next(e)
    const beneath = await next(e)
    const add = (rows: { text: string; label: string; description: string }[]) => ({
      suggestions: [...beneath.suggestions, ...rows.slice(0, config.rows)],
    })
    if (e.token === 'icw') {
      return add([
        { text: LOOP, label: LOOP, description: 'in correspondence with' },
      ])
    }

    const at = e.token.lastIndexOf(LOOP)
    const typed = e.token.slice(at + 1)
    // ⌘a⌘ : the operator typed straight after a picked side. The leading ⌘
    // goes, as in the menu, so what follows makes a⌘b.
    const whole = e.token.slice(0, at + 1)
    const kept = /^⌘[^⌘]+⌘$/.test(whole) ? whole.slice(1) : whole
    const handles = await loadHandles($)
    const sourceRows = config.order
      .filter(source => source.startsWith(typed.toLowerCase()))
      .map(source => ({
        text: `${kept}${source}:`,
        label: `${LOOP}${source}:`,
        description: canSearch(source) ? `search ${source}` : source,
      }))
    const handleRow = (h: { slug: string; source: string; title: string }) => ({
      text: `${kept}${h.source}:${h.slug} `,
      label: h.title,
      description: `${h.source} · ${h.slug}`,
    })

    // Source selector, with the three handles used last.
    if (typed === '') {
      const recent = [...handles]
        .sort((a, b) => b.usedAt - a.usedAt)
        .slice(0, 3)

      // Strung by default; one row undoes it, for two separate loops.
      const strung = /^([^\s⌘]+:[^\s⌘]+)⌘$/.exec(kept)
      const apart = strung
        ? [
            {
              text: `${LOOP}${strung[1]} ${LOOP}`,
              label: `${LOOP}${strung[1]} ${LOOP}…`,
              description: 'keep them as two separate loops',
            },
          ]
        : []

      return add([...apart, ...sourceRows, ...recent.map(handleRow)])
    }

    // Search inside one source.
    const colon = typed.indexOf(':')
    const source = colon > 0 ? typed.slice(0, colon) : ''
    if (config.order.includes(source)) {
      const query = typed.slice(colon + 1)
      if (query.length < 2) return beneath
      const known = handles
        .filter(h => h.source === source && h.slug.startsWith(query))
        .map(handleRow)
      const hits = await within(
        $,
        search($, config, source, query.replace(/[-_]+/g, ' '), config.rows),
        2000,
        [] as Fragment[],
      )
      const rows = hits.map(hit => {
        const slug = slugFor(handles, hit)
        offered.set(`${source}:${slug}`, hit)

        return {
          text: `${kept}${source}:${slug} `,
          label: hit.title,
          description: `${source}${hit.kind ? ` ${hit.kind}` : ''} · ${hit.snippet || hit.address}`,
        }
      })
      const seen = new Set<string>()

      return add(
        [...known, ...rows].filter(
          row => !seen.has(row.text) && seen.add(row.text),
        ),
      )
    }

    // No source named: handles picked before, then every source, live.
    if (typed.length < 2) return add(sourceRows)
    const needle = typed.toLowerCase()
    const recalled = handles
      .filter(
        h => h.slug.includes(needle) || h.title.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.usedAt - a.usedAt)
      .slice(0, 3)
      .map(handleRow)
    const found = await within(
      $,
      Promise.all(
        config.order
          .filter(s => canSearch(s))
          .map(s =>
            search($, config, s, typed.replace(/[-_]+/g, ' '), config.rows),
          ),
      ),
      2000,
      [] as Fragment[][],
    )
    const everywhere: { text: string; label: string; description: string }[] = []
    for (let n = 0; n < Math.max(0, ...found.map(f => f.length)); n++) {
      for (const hits of found) {
        const hit = hits[n]
        if (!hit) continue
        const slug = slugFor(handles, hit)
        offered.set(`${hit.source}:${slug}`, hit)
        everywhere.push({
          text: `${kept}${hit.source}:${slug} `,
          label: hit.title,
          description: `${hit.source}${hit.kind ? ` ${hit.kind}` : ''}`,
        })
      }
    }
    const once = new Set<string>()

    return add(
      [...recalled, ...everywhere, ...sourceRows].filter(
        row => !once.has(row.text) && once.add(row.text),
      ),
    )
  })

  // ── While typing: colour in the draft and the live menu above it ───────
  on('prompt.edit', async ($, e, next) => {
    let box = await next(e)
    editing.asked += 1
    // A loop shortcut of the person's own becomes the character at once.
    const cut = config.loopShortcut
    const isShortcut =
      cut !== '' &&
      e.inputText !== '' &&
      box.text.slice(0, box.cursor).endsWith(cut)
    if (isShortcut) {
      const at = box.cursor - cut.length
      box = {
        ...box,
        text: box.text.slice(0, at) + LOOP + box.text.slice(box.cursor),
        cursor: at + LOOP.length,
      }
    }
    // Stringing is the default: a loop typed after a picked fragment joins
    // the two, so ⌘a ⌘ becomes a⌘ and the next pick makes a⌘b.
    if (e.inputText === LOOP || isShortcut) {
      const before = box.text.slice(0, box.cursor)
      const earlier = /(^|\s)(\S+)\s+⌘$/.exec(before)
      const word = earlier?.[2] ?? ''
      // One picked fragment (⌘a), or fragments already strung (a⌘b).
      const single = /^⌘([^\s⌘]+:[^\s⌘]+)$/.exec(word)
      const isStrung = /^[^\s⌘]+:[^\s⌘]+(⌘[^\s⌘]+:[^\s⌘]+)+$/.test(word)
      const joined = single
        ? `${single[1]}${LOOP}`
        : isStrung
          ? `${word}${LOOP}`
          : undefined
      if (earlier && joined) {
        const start = earlier.index + (earlier[1] ?? '').length
        box = {
          ...box,
          text: box.text.slice(0, start) + joined + box.text.slice(box.cursor),
          cursor: start + joined.length,
        }
      }
    }
    refreshMenu($, config, box.text, box.cursor)
    const glyphs = glyphsOf(box.text)
    if (glyphs.length === 0) return box

    return {
      ...box,
      decorations: [
        ...(box.decorations ?? []),
        ...glyphs.map((g, n) => ({
          start: g.start,
          end: g.end,
          bold: true,
          color: hueColor(n * 47 + 200),
        })),
      ],
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!menu.isOpen || e.props.hasSurvey) return next(e)
    // Where the prompt box has a typeahead (the terminal), the rows are
    // there, chosen by keyboard. The band then only carries the help lines.
    const hasTypeahead = picker.asked > 0
    if (hasTypeahead && menu.help.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns - 2)
    const budget = Math.max(4, e.props.maxRows || 12)

    // A line's parts, cut to the width. A pill is drawn whole or not at all.
    // Help lines are left whole: they wrap, as they always have.
    // Room for every pill on the line is held back first, so a long title
    // is cut before its source is.
    const fit = (parts: Part[], isWhole = false): { part: Part; n: number; cut: string }[] => {
      let left = isWhole ? Infinity : width
      const texts = parts.map(part => (part.pill === undefined ? part.text : ` ${part.text} `))
      const pillsAfter = (n: number) =>
        parts.slice(n + 1).reduce((sum, part, k) => sum + (part.pill === undefined ? 0 : (texts[n + 1 + k]?.length ?? 0)), 0)
      const out: { part: Part; n: number; cut: string }[] = []
      for (const [n, part] of parts.entries()) {
        const text = texts[n] ?? ''
        const room = left - pillsAfter(n)
        const cut =
          part.pill !== undefined
            ? text.length <= left ? text : ''
            : text.length <= room ? text : room > 1 ? `${text.slice(0, room - 1)}…` : ''
        if (cut === '') continue
        left -= cut.length
        out.push({ part, n, cut })
      }

      return out
    }
    const paint = ({ part, n, cut }: { part: Part; n: number; cut: string }): RenderChildren => {
      const tint = part.pill === undefined ? undefined : (PILL[part.pill] ?? PILL_OTHER)

      return tint ? (
        <Text key={`p${n}`} bold color={tint.color} backgroundColor={tint.ground}>{cut}</Text>
      ) : part.tone === 'dim' ? (
        <Text key={`p${n}`} dimColor>{cut}</Text>
      ) : part.tone === 'bold' ? (
        <Text key={`p${n}`} bold>{cut}</Text>
      ) : part.tone === 'loop' ? (
        <Text key={`p${n}`} bold color={GLYPH_COLOR}>{cut}</Text>
      ) : part.tone === 'warn' ? (
        <Text key={`p${n}`} color={WARN_COLOR}>{cut}</Text>
      ) : (
        cut
      )
    }
    const draw = (parts: Part[], isWhole = false): RenderChildren[] => fit(parts, isWhole).map(paint)
    // A desktop draws a Button's label in its own style and drops the colours
    // of the Text inside it. So a row is drawn as its leading ⌘, one Button
    // with the words, and its source pills after it: a pill reads as the
    // row's source and never as part of what is pressed.
    const drawRow = (parts: Part[], key: string, onPress: () => void) => {
      const lead = parts.findIndex(part => part.tone !== 'loop')
      const head = lead < 0 ? parts : parts.slice(0, lead)
      const rest = lead < 0 ? [] : parts.slice(lead)
      const ordered = [
        ...head,
        ...rest.filter(part => part.pill === undefined),
        ...rest.filter(part => part.pill !== undefined),
      ]
      const segs = fit(ordered)
      const words = segs.filter(seg => seg.n >= head.length && seg.part.pill === undefined)

      return [
        ...segs.filter(seg => seg.n < head.length).map(paint),
        words.length > 0 ? <Button key={key} plain onPress={onPress}>{words.map(paint)}</Button> : null,
        ...segs.filter(seg => seg.part.pill !== undefined).map(paint),
      ]
    }

    // The band holds `maxRows` lines. Results go first, from the end, and
    // one line says how many more there are.
    let body = hasTypeahead ? [] : menu.lines
    const fixed = 1 + menu.help.length
    if (fixed + body.length > budget) {
      const hits = body.filter(line => line.isHit).length
      const drop = Math.min(hits, fixed + body.length + 1 - budget)
      if (drop > 0) {
        let skip = drop
        const kept = [...body].reverse().filter(line => !(line.isHit && skip-- > 0)).reverse()
        const after = kept.map(line => line.isHit === true).lastIndexOf(true)
        body = [
          ...kept.slice(0, after + 1),
          { parts: [dim(`+ ${drop} more · keep typing to narrow`)] },
          ...kept.slice(after + 1),
        ]
      }
      body = body.slice(0, Math.max(0, budget - fixed))
    }

    let rowN = 0

    return (
      <Box flexDirection="column">
        <Text>{draw(menu.head)}</Text>
        {menu.help.map(parts => (
          <Text>{draw(parts, true)}</Text>
        ))}
        {body.map(line => {
          if (line.row) {
            const row = line.row

            const n = rowN++

            return (
              <Box key={`row-${n}`} flexDirection="row">
                {drawRow(row.parts, `loop-${n}`, () => void pickRow($, config, row))}
              </Box>
            )
          }
          if (line.chips) {
            const { lead, items, tail } = line.chips

            return (
              <Box flexDirection="row">
                <Text dimColor>{`${lead}   `}</Text>
                {items.map(chip => {
                  // A Button takes no colour on a desktop: the source's own
                  // pill colours go on a mark before its name.
                  const tint = chip.source === '' ? undefined : (PILL[chip.source] ?? PILL_OTHER)

                  return (
                    <Box key={`chip-${chip.source || 'all'}`} flexDirection="row">
                      {tint ? <Text bold color={tint.color} backgroundColor={tint.ground}>{' ● '}</Text> : null}
                      <Button
                        key={`src-${chip.source || 'all'}`}
                        plain
                        onPress={() => void pickRow($, config, { write: chip.write })}
                      >
                        {` ${chip.label}   `}
                      </Button>
                    </Box>
                  )
                })}
                {tail ? <Text dimColor>{`      ${tail}`}</Text> : null}
              </Box>
            )
          }

          return <Text>{draw(line.parts ?? [])}</Text>
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Select } = $.ui.resolve(e)
    const sources = config.order.filter(source => canSearch(source))
    if (!sources.includes(pick.source)) pick.source = sources[0] ?? ''
    const handles = await heldHandles($)

    const run = async (query: string) => {
      pick.query = query
      pick.hits = []
      if (query.trim().length < 2) {
        pick.note = ''
      } else {
        pick.note = `searching ${pick.source}…`
        $.ui.invalidate('ui.render')
        pick.hits = await within(
          $,
          search($, config, pick.source, query.trim(), config.rows),
          5000,
          [] as Fragment[],
        )
        pick.note = pick.hits.length > 0 ? '' : 'nothing found'
      }
      $.ui.invalidate('ui.render')
    }
    // Here the mod is told which row was taken, so the handle is saved now.
    const take = async (fragment: Fragment) => {
      const slug = slugFor(await loadHandles($), fragment)
      await keepHandle($, { ...fragment, slug })
      held = undefined
      const draft = (await $.prompt.read()).text
      const lead = draft.endsWith(LOOP)
        ? ''
        : `${draft === '' || /\s$/.test(draft) ? '' : ' '}${LOOP}`
      await $.prompt.fill({
        text: `${lead}${fragment.source}:${slug} `,
        mode: 'append',
      })
      pick.note = `added ${LOOP}${fragment.source}:${slug}`
      // Hand the keyboard back, so Enter sends the message.
      await $.ui.close({ id: PANE })
    }
    const rows: Fragment[] =
      pick.hits.length > 0 || pick.query.trim().length >= 2
        ? pick.hits
        : [...handles].sort((a, b) => b.usedAt - a.usedAt).slice(0, 8)

    return (
      <Box flexDirection="column">
        <Select
          key="source"
          label="Source"
          options={sources.map(source => ({ value: source, label: source }))}
          value={pick.source}
          onSelect={value => {
            pick.source = value
            void run(pick.query)
          }}
        />
        <Input
          key="query"
          label="Search"
          placeholder="two characters or more, then Enter"
          value={pick.query}
          submitLabel="Search"
          autoFocus
          onInput={value => {
            pick.query = value
          }}
          onSubmit={value => void run(value)}
        />
        {pick.note ? <Text dimColor>{pick.note}</Text> : null}
        {rows.length > 0 && pick.hits.length === 0 ? (
          <Text dimColor>Used lately</Text>
        ) : null}
        {rows.map((fragment, n) => (
          <Button key={`row-${n}`} plain onPress={() => void take(fragment)}>
            {fragment.title}{' '}
            <Text dimColor>
              {fragment.source}
              {fragment.kind ? ` ${fragment.kind}` : ''}
            </Text>
          </Button>
        ))}
      </Box>
    )
  })

  // ── On send: resolve and attach ─────────────────────────────────────────
  on('prompt.submit', async ($, e, next) => {
    let block: string | undefined
    if (menu.isOpen) {
      menu.seq += 1
      menu.isOpen = false
      menu.lines = []
      $.ui.invalidate('ui.render')
    }
    try {
      // The person's own message: typed here, sent by the desktop host, or
      // through Remote Control from a phone or the web.
      const isTyped = PERSON.has(e.origin.kind) && !e.command && !e.isMeta
      const loops = isTyped ? parse(e.text) : []
      if (isTyped && e.text.trim() === LOOP) {
        const isNew = (await heldHandles($)).length === 0
        const reach = await Promise.all(
          SOURCES.map(async source => {
            const isOn =
              source === 'web'
                ? words(options.enabledSources).includes('web')
                : config.order.includes(source)
            const state = !isOn
              ? 'off'
              : !canSearch(source)
                ? 'on (a pasted URL is the address)'
                : await reachOf($, config, source)

            return `${source}: ${state}`
          }),
        )
        block = [
          `[one-infinite-loop] The message is ${LOOP} on its own, with nothing on either side.`,
          isNew
            ? 'The person has not picked a fragment before: start the guided first loop ("First loop" in the loop-correspondence skill), one step at a time.'
            : 'The person has picked fragments before: explain briefly how the loop is used, and offer the guided first loop.',
          'Sources as the mod sees them now:',
          ...reach,
          // The key helper is macOS only, and is offered only to someone at
          // the Mac: from a phone, its permission prompts would go unseen.
          e.origin.kind === 'bridge'
            ? `Right-Command key: not offered, because this message came through Remote Control (a phone or the web) and the installer's permission prompts would appear on the computer. Ways to type ${LOOP} from here: on iPhone or iPad, Settings > General > Keyboard > Text Replacement, phrase ${LOOP}, shortcut icw (it then works in every app); a Loop shortcut set in the plugin's settings also works here. Do not install anything for this.`
            : (await $.fs.exists(MACOS_MARKER).catch(() => false))
            ? `Right-Command key: ${$.plugin.root}/extras/right-command/install.sh installs a small helper so that a tap on the right Command key types ${LOOP} (macOS; no password; afterwards the person allows Input Monitoring and Accessibility in System Settings). Run it with bash only after the person says yes. Without it, typing icw offers ${LOOP}.`
            : `Right-Command key: no key installer for this system (the helper is macOS only). Ways to type ${LOOP} here: type icw and pick ${LOOP} from the menu; set a Loop shortcut such as ;; in the plugin's settings; on Windows, make a key combination type ${LOOP} with Microsoft PowerToys Keyboard Manager (README, "A key that types ${LOOP}"). Do not install anything for this.`,
          config.loopShortcut
            ? `The person's loop shortcut: typing ${config.loopShortcut} turns into ${LOOP}.`
            : 'No loop shortcut is set.',
          'How the loop is used:',
          ...USAGE,
        ].join('\n')
      }
      if (loops.length > 0) {
        const resolved = await resolveAll($, config, loops)
        sessionLoops.push(
          ...resolved.filter(({ loop }) => loop.form !== 'undelimited'),
        )
        block = contextBlock(resolved) || undefined
        // Not awaited: the send never waits on the sound.
        if (config.loopSound === 'sosumi' && allResolved(resolved)) void chime($)
        if (config.isDebug) $.ui.log(`one-infinite-loop: ${loops.length} loop(s) attached`)
      }
    } catch (error) {
      // Fail open: the prompt goes ahead as typed.
      if (config.isDebug) $.ui.log(`one-infinite-loop: resolve failed (${String(error)})`)
    }

    return block
      ? next({ ...e, context: [...(e.context ?? []), block] })
      : next(e)
  })

  // ── In the transcript: the loop, shimmering, and its links ──────────────
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const { text, origin } = e.props
    const isPlain =
      PERSON.has(origin.kind) &&
      (text.includes(LOOP) || text.includes('i/c/w')) &&
      text.length <= 4000 &&
      !text.includes('```')
    if (!isPlain) {

      return next(e)
    }
    const loops = parse(text)
    const glyphs = glyphsOf(text)
    if (loops.length === 0 && glyphs.length === 0) return next(e)

    const handles = await heldHandles($)
    const isRemote = e.surface !== 'terminal'
    const hrefOf = (fragment: Fragment): string | undefined => {
      const address =
        // A note's address is its file; its link is the base plus the path
        // inside the vault, as the bundled redirect expects.
        fragment.source === 'obsidian' && config.obsidianLinkBase
          ? config.obsidianLinkBase +
            encodeURI(
              fragment.address.slice(
                config.obsidianVault.replace(/\/$/, '').length + 1,
              ),
            )
          : fragment.address
      const isLinkable = isRemote
        ? /^(https:\/\/|http:\/\/localhost[:/])/.test(address) &&
          !address.includes('@')
        : /^https?:\/\//.test(address)

      return isLinkable && address.length <= 2048 ? address : undefined
    }
    const sides = loops
      .flatMap(sidesOf)
      .map(side => {
        const fragment =
          side.kind === 'url'
            ? { source: 'web', title: side.text, address: side.text }
            : (resolvedSides.get(side.text) ??
              (side.slug
                ? findHandle(handles, side.slug, side.source)
                : undefined))

        return fragment ? { side, fragment, href: hrefOf(fragment) } : undefined
      })
      .filter(s => s !== undefined)
    // The terminal keeps its own drawing of the message (its marker and
    // background cannot be matched from here), with the links beneath.
    const isInline = config.linkStyle === 'inline' && e.surface !== 'terminal'
    if (!isInline && sides.length === 0) return next(e)

    // The shimmer: while a message is new and in view, a timer asks for a
    // redraw and each loop takes the next hue. After that it rests on one.
    const id = e.requestId
    const now = Date.now()
    if (!firstDrawn.has(id)) firstDrawn.set(id, now)
    const isLive =
      config.shimmerSeconds > 0 &&
      e.props.onScreen !== null &&
      now - (firstDrawn.get(id) ?? now) < config.shimmerSeconds * 1000
    if (isLive) {
      liveUntil = Math.max(
        liveUntil,
        (firstDrawn.get(id) ?? now) + config.shimmerSeconds * 1000,
      )
      ticker ??= $.clock.every(250, () => {
        if (Date.now() > liveUntil) {
          ticker?.cancel()
          ticker = undefined
        }
        $.ui.invalidate('ui.render')
      })
    }
    // A glide, not a flicker: one full turn of the hues over the shimmer's
    // length, in steps too small to see, ending on the colour it began with.
    const glide = isLive
      ? ((now - (firstDrawn.get(id) ?? now)) / (config.shimmerSeconds * 1000)) *
        360
      : 0
    const { Box, Text, Link } = $.ui.resolve(e)
    const glyph = (n: number) => (
      <Text bold color={hueColor(glide + n * 47 + 200)}>
        {LOOP}
      </Text>
    )
    const unlinked = sides.filter(s => !s.href)

    if (isInline) {
      // The message as typed, with each operator coloured and each
      // resolved side a link.
      const marks = [
        ...glyphs.map((op, n) => ({
          ...op,
          node: glyph(n) as RenderChildren,
        })),
        ...sides
          .filter(s => s.href)
          .map(s => ({
            start: s.side.start,
            end: s.side.end,
            node: (
              // A link typed out is its own label: a terminal without
              // hyperlinks prints the address after a label, twice over here.
              s.side.kind === 'url' ? (
                <Link href={s.href!} />
              ) : (
                <Link
                  href={s.href!}
                  label={text.slice(s.side.start, s.side.end)}
                />
              )
            ) as RenderChildren,
          })),
      ].sort((a, b) => a.start - b.start)
      const parts: RenderChildren[] = []
      let at = 0
      for (const mark of marks) {
        if (mark.start < at) continue
        parts.push(text.slice(at, mark.start), mark.node)
        at = mark.end
      }
      parts.push(text.slice(at))

      return (
        <Box flexDirection="column">
          <Text>{parts}</Text>
          {unlinked.map(s => (
            <Text dimColor>
              {LOOP} {s.side.text} → {s.fragment.address}
            </Text>
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {await next(e)}
        {sides.map((s, n) => (
          <Box flexDirection="row">
            {glyph(n)}
            <Text dimColor>
              {' '}
              {s.side.kind === 'url' ? '' : `${s.side.text} → `}
            </Text>
            {s.href && s.side.kind === 'url' ? (
              <Link href={s.href} />
            ) : s.href ? (
              <Link href={s.href} label={s.fragment.title} />
            ) : (
              <Text dimColor>{s.fragment.address}</Text>
            )}
          </Box>
        ))}
      </Box>
    )
  })

  // ── /1loop ───────────────────────────────────────────────────────────────
  on('command.run', { command: '1loop' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)

    if (verb === 'sources') {
      const lines = SOURCES.map(source => {
        // The web has no place in the search order; it is on when enabled.
        const isOn =
          source === 'web'
            ? words(options.enabledSources).includes('web')
            : config.order.includes(source)
        const answer = lastAnswer.get(source)
        const state = !isOn
          ? 'off'
          : !canSearch(source)
            ? 'on (a pasted URL is the address; no search)'
            : source === 'obsidian' && !config.obsidianVault
              ? 'on, no vault folder set'
              : `on, ${answer ? `${answer.state}: ${answer.note}` : 'not asked yet'}`

        return `${source}: ${state}`
      })

      return { text: lines.join('\n') }
    }

    if (verb === 'forget') {
      const name = rest.join(' ').replace(LOOP, '')
      if (!name) return { text: 'Usage: /1loop forget <handle>' }
      const gone = await forgetHandle($, name)

      return { text: gone ? `Forgot ${name}.` : `No handle named ${name}.` }
    }

    if (verb === 'pick') {
      const opened = await $.ui.open({
        id: PANE,
        title: `${LOOP} pick a fragment`,
        focus: true,
      })

      return {
        text: opened.isPlaced
          ? 'Picker pane opened.'
          : 'This surface did not place the picker pane.',
      }
    }

    if (sessionLoops.length === 0) {
      const count = (await loadHandles($)).length

      return { text: `No loops resolved yet. ${count} handle(s) in the store.` }
    }

    return { text: contextBlock(sessionLoops).split('\n').slice(1).join('\n') }
  })
}
