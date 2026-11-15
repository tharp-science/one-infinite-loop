// One Infinite Loop: makes ⌘ a working operator in the prompt.
// Picker while typing, addresses attached on send, loops drawn as links.
// The mod finds addresses only; how a loop is read stays with Claude.

import type {
  EngineInterface,
  PluginOptions,
  Register,
  RenderChildren,
} from 'claude-code'

import { canSearch, lastAnswer, search, within } from './adapters'
import type { Config } from './adapters'
import { LOOP, SOURCES, glyphsOf, parse, sidesOf } from './parse'
import { contextBlock, offered, resolveAll, resolvedSides } from './resolve'
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
  }
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

/** The live menu above the prompt: what the loop being typed could mean. */
type MenuRow = {
  label: string
  hint: string
  write: string
  fragment?: Fragment
  /** Set on the row that turns the prefix loop just picked into an infix. */
  join?: { from: string; to: string }
}
const menu = {
  isOpen: false,
  head: '',
  note: '',
  rows: [] as MenuRow[],
  help: [] as string[],
  seq: 0,
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
  if (!spot) {
    if (menu.isOpen) {
      menu.isOpen = false
      menu.rows = []
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
  const query = (isSourced ? typed.slice(colon + 1) : typed)
    .replace(/[-_]+/g, ' ')
    .trim()
  const sourceRows: MenuRow[] = isSourced
    ? []
    : config.order
        .filter(source => source.startsWith(typed.toLowerCase()))
        .map(source => ({
          label: `${LOOP}${source}:`,
          hint: canSearch(source) ? `search ${source} only` : 'paste a URL',
          write: `${kept}${source}:`,
        }))
  // a⌘ with a picked fragment on the left: the two are strung together by
  // default. One row undoes that, for two separate loops.
  const strung = /^([^\s⌘]+:[^\s⌘]+)⌘$/.exec(kept)
  if (strung && typed === '') {
    sourceRows.unshift({
      label: `${LOOP}${strung[1]} ${LOOP}…`,
      hint: 'keep them as two separate loops',
      write: '',
      join: { from: kept, to: `${LOOP}${strung[1]} ${LOOP}` },
    })
  }
  const handleRow = (h: Handle): MenuRow => ({
    label: h.title,
    hint: `${h.source} · picked before`,
    write: `${kept}${h.source}:${h.slug} `,
  })
  const show = (rows: MenuRow[], note: string) => {
    if (seq !== menu.seq) return
    menu.isOpen = rows.length > 0 || note !== ''
    menu.head = `${LOOP} ${isSourced ? named : 'all sources'}`
    menu.note = note
    menu.rows = rows
    // The loop on its own, nothing typed after it: show how it is used.
    menu.help = typed === '' && kept === LOOP ? USAGE : []
    if (strung && typed === '') menu.head = `${LOOP} ${strung[1]} with…`
    $.ui.invalidate('ui.render')
  }

  // A shortcut such as ⌘K: one character that names no source.
  if (!isSourced && typed.length === 1 && sourceRows.length === 0) {
    show([], '')

    return
  }
  if (query.length < 2) {
    show(sourceRows, isSourced ? 'type two characters to search' : '')
    void heldHandles($).then(handles => {
      const recent = [...handles]
        .filter(h => !isSourced || h.source === named)
        .sort((a, b) => b.usedAt - a.usedAt)
        .slice(0, 5)
        .map(handleRow)
      if (recent.length > 0) {
        show(
          [...sourceRows, ...recent],
          isSourced ? 'type two characters to search' : '',
        )
      }
    })

    return
  }

  show(sourceRows, 'searching…')
  $.clock.after(200, () => {
    if (seq !== menu.seq) return
    void searchMenu($, config, {
      seq,
      kept,
      query,
      needle: typed.toLowerCase(),
      sources: isSourced
        ? [named]
        : config.order.filter(source => canSearch(source)),
      sourceRows,
      head: `${LOOP} ${isSourced ? named : 'all sources'}`,
    })
  })
}

async function searchMenu(
  $: EngineInterface,
  config: Config,
  ask: {
    seq: number
    kept: string
    query: string
    needle: string
    sources: string[]
    sourceRows: MenuRow[]
    head: string
  },
): Promise<void> {
  const handles = await heldHandles($)
  const found = await within(
    $,
    Promise.all(
      ask.sources.map(source =>
        search($, config, source, ask.query, config.rows),
      ),
    ),
    4000,
    [] as Fragment[][],
  )
  if (ask.seq !== menu.seq) return
  // Sources turn about, so one does not fill the menu.
  const mixed: Fragment[] = []
  for (let n = 0; n < Math.max(0, ...found.map(f => f.length)); n++) {
    for (const hits of found) {
      const hit = hits[n]
      if (hit) mixed.push(hit)
    }
  }
  const known: MenuRow[] = handles
    .filter(
      h =>
        ask.sources.includes(h.source) &&
        (h.slug.includes(ask.needle) ||
          h.title.toLowerCase().includes(ask.query.toLowerCase())),
    )
    .slice(0, 3)
    .map(h => ({
      label: h.title,
      hint: `${h.source} · picked before`,
      write: `${ask.kept}${h.source}:${h.slug} `,
    }))
  const rows: MenuRow[] = mixed.map(hit => ({
    label: hit.title,
    hint: `${hit.source}${hit.kind ? ` ${hit.kind}` : ''}`,
    write: `${ask.kept}${hit.source}:${slugFor(handles, hit)} `,
    fragment: hit,
  }))
  const seen = new Set<string>()
  menu.isOpen = true
  menu.help = []
  menu.head = ask.head
  menu.rows = [...known, ...rows, ...ask.sourceRows].filter(
    row => !seen.has(row.write) && seen.add(row.write),
  )
  menu.note = rows.length + known.length > 0 ? '' : 'nothing found'
  $.ui.invalidate('ui.render')
}

/** Writes a menu row over the loop being typed, and saves a picked fragment. */
async function pickRow(
  $: EngineInterface,
  config: Config,
  row: MenuRow,
): Promise<void> {
  const box = await $.prompt.read()
  const spot = spotAt(box.text, box.cursor)
  const start = spot ? spot.start : box.text.length
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
    menu.isOpen = true
    menu.help = []
    menu.head = `${LOOP} added ${handle}`
    menu.note = ''
    menu.rows = [
      {
        label: `${handle.slice(1)}${LOOP}…`,
        hint: 'connect it with another fragment',
        write: '',
        join: { from: row.write, to: `${handle.slice(1)}${LOOP}` },
      },
    ]
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
    // Stringing is the default: a loop typed after a picked fragment joins
    // the two, so ⌘a ⌘ becomes a⌘ and the next pick makes a⌘b.
    if (e.inputText === LOOP) {
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
    // there, chosen by keyboard. The band then only carries the usage card.
    const hasTypeahead = picker.asked > 0
    if (hasTypeahead && menu.help.length === 0) return next(e)
    const rows = hasTypeahead ? [] : menu.rows
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns - 24)

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {menu.head}
          {menu.note && !hasTypeahead ? ` · ${menu.note}` : ''}
        </Text>
        {menu.help.map(line => (
          <Text dimColor>{line}</Text>
        ))}
        {rows.slice(0, config.rows).map((row, n) => (
          <Button
            key={`loop-${n}`}
            plain
            onPress={() => void pickRow($, config, row)}
          >
            {row.label.length > width
              ? `${row.label.slice(0, width - 1)}…`
              : row.label}{' '}
            <Text dimColor>{row.hint}</Text>
          </Button>
        ))}
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
      menu.rows = []
      $.ui.invalidate('ui.render')
    }
    try {
      const isTyped = e.origin.kind === 'composer' && !e.command && !e.isMeta
      const loops = isTyped ? parse(e.text) : []
      if (isTyped && e.text.trim() === LOOP) {
        block = [
          `[one-infinite-loop] The message is ${LOOP} on its own, with nothing on either side. That asks for instructions: explain briefly how the loop is used here.`,
          ...USAGE,
        ].join('\n')
      }
      if (loops.length > 0) {
        const resolved = await resolveAll($, config, loops)
        sessionLoops.push(
          ...resolved.filter(({ loop }) => loop.form !== 'undelimited'),
        )
        block = contextBlock(resolved) || undefined
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
