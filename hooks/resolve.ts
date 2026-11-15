// Resolution: from a side as typed to an address, cheapest way first.

import type { EngineInterface } from 'claude-code'

import { SETUP_HINT, canSearch, noneAnswered, search, within } from './adapters'
import type { Config } from './adapters'
import { SOURCES, fits, sidesOf } from './parse'
import type { Loop, Side } from './parse'
import { findHandle, keepHandle, loadHandles } from './store'
import type { Fragment, Handle } from './store'

export type Resolution =
  | {
      status: 'resolved'
      how: 'address' | 'picked' | 'single match'
      fragment: Fragment
    }
  | { status: 'ambiguous'; candidates: Fragment[] }
  | { status: 'missing'; note?: string }
  | { status: 'written' }

/** Rows the picker offered, by `source:slug`, until one is sent in a prompt. */
export const offered = new Map<string, Fragment>()

/** Every side resolved this session, by its text as typed: what gets drawn. */
export const resolvedSides = new Map<string, Fragment>()

const fromSearch = (
  hits: Fragment[],
  wanted: string,
  most: number,
): Resolution => {
  if (hits.length === 0) return { status: 'missing' }
  const exact = hits.filter(hit => fits(hit.title, wanted) === 'whole')
  if (exact.length === 1) {
    return { status: 'resolved', how: 'single match', fragment: exact[0]! }
  }
  // A slug that is the start of exactly one title is that fragment: titles
  // are long, and a typed slug is usually their first few words.
  const starts = hits.filter(hit => fits(hit.title, wanted) === 'start')
  if (exact.length === 0 && starts.length === 1) {
    return { status: 'resolved', how: 'single match', fragment: starts[0]! }
  }

  return {
    status: 'ambiguous',
    candidates: (exact.length > 1 ? exact : hits).slice(0, most),
  }
}

async function resolveSide(
  $: EngineInterface,
  config: Config,
  handles: Handle[],
  side: Side,
  budgetMs: number,
): Promise<Resolution> {
  // 1. Already an address.
  if (side.kind === 'url') {
    const fragment = { source: 'web', title: side.text, address: side.text }

    return { status: 'resolved', how: 'address', fragment }
  }
  if (side.kind === 'path') {
    if (!(await $.fs.exists(side.text))) return { status: 'missing' }
    const fragment = { source: 'file', title: side.text, address: side.text }

    return { status: 'resolved', how: 'address', fragment }
  }

  // Words in double quotes are the person's own: a new question or remark
  // set against something. They are passed on as written, never searched.
  if (side.kind === 'phrase' && side.isQuoted) return { status: 'written' }

  // 2 and 3. A handle in the store, source-qualified or bare.
  if (side.kind === 'slug' && side.slug) {
    const handle = findHandle(handles, side.slug, side.source)
    if (handle) {
      await keepHandle($, handle)

      return { status: 'resolved', how: 'picked', fragment: handle }
    }
    const pick = side.source && offered.get(`${side.source}:${side.slug}`)
    if (pick) {
      await keepHandle($, { ...pick, slug: side.slug })

      return { status: 'resolved', how: 'picked', fragment: pick }
    }
  }

  // A source's own name with nothing after it is an unfinished pick.
  if (
    side.kind === 'slug' &&
    !side.source &&
    (SOURCES as readonly string[]).includes(side.text)
  ) {
    return {
      status: 'missing',
      note: `"${side.text}" is a source name with no fragment; written ${side.text}:query it searches that source`,
    }
  }

  // A bare number points at something in the conversation, such as an item
  // in a list Claude just gave. Only Claude can follow that.
  if (side.kind === 'slug' && !side.source && /^\d+$/.test(side.text)) {
    return {
      status: 'missing',
      note: 'a number: likely an item in the conversation; not searched',
    }
  }

  // 4. Search: the named source, or every enabled one in the set order.
  const wanted = side.kind === 'slug' ? (side.slug ?? side.text) : side.text
  const query = side.kind === 'slug' ? wanted.replace(/[-_…]+/g, ' ') : wanted
  const sources = side.source
    ? [side.source]
    : config.order.filter(source => canSearch(source))
  const hits = await within(
    $,
    Promise.all(
      // Ask for more than is shown: a match is only called single when it
      // is single among a dozen, not among the few candidates listed.
      sources.map(s => search($, config, s, query, Math.max(12, config.candidates))),
    ),
    budgetMs,
    [] as Fragment[][],
  )

  // Sources turn about, so the first one asked does not fill the list.
  const mixed: Fragment[] = []
  for (let n = 0; n < Math.max(0, ...hits.map(h => h.length)); n++) {
    for (const found of hits) {
      const hit = found[n]
      if (hit) mixed.push(hit)
    }
  }

  if (mixed.length === 0 && noneAnswered(sources)) {
    return { status: 'missing', note: SETUP_HINT.send }
  }

  return fromSearch(mixed, wanted, config.candidates)
}

export type Resolved = { loop: Loop; sides: Map<Side, Resolution> }

/** Resolves every side of every loop, all of them inside one budget. */
export async function resolveAll(
  $: EngineInterface,
  config: Config,
  loops: Loop[],
): Promise<Resolved[]> {
  const handles = await loadHandles($)
  const startedAt = Date.now()
  const left = () => config.sendBudgetMs - (Date.now() - startedAt)

  return Promise.all(
    loops.map(async loop => {
      const sides = new Map<Side, Resolution>()
      await Promise.all(
        sidesOf(loop).map(async side => {
          const found = await resolveSide($, config, handles, side, left())
          sides.set(side, found)
          if (found.status === 'resolved') {
            resolvedSides.set(side.text, found.fragment)
          }
        }),
      )

      return { loop, sides }
    }),
  )
}

const line = (f: Fragment) =>
  `${f.source}${f.kind ? ` ${f.kind}` : ''} | ${f.title} | ${f.address}`

const sideText = (label: string, side: Side, found: Resolution): string[] => {
  const head = `   ${label} "${side.text}" -> `
  if (found.status === 'resolved') {
    return [`${head}${line(found.fragment)} | resolved (${found.how})`]
  }
  if (found.status === 'written') {
    return [`${head}as written (the person's own words; not searched)`]
  }
  if (found.status === 'missing') {
    return [`${head}missing${found.note ? ` (${found.note})` : ''}`]
  }

  return [
    `${head}ambiguous, ${found.candidates.length} candidates:`,
    ...found.candidates.map(c => `          ${line(c)}`),
  ]
}

/**
 * The block only Claude reads. A loop whose sides the mod could not tell
 * apart is left out: Claude sees the message and reads it from there.
 * Answers '' when nothing is left to say.
 */
export const contextBlock = (resolved: Resolved[]): string => {
  const told = resolved.filter(({ loop }) => loop.form !== 'undelimited')
  if (told.length === 0) return ''
  const out = [
    '[one-infinite-loop] Loops found in this message. Addresses were resolved by the mod. The reading is not decided here; read each loop with the loop-correspondence skill where it is available.',
  ]
  told.forEach(({ loop, sides }, i) => {
    const side = (label: string, s: Side) =>
      sideText(label, s, sides.get(s) ?? { status: 'missing' })
    if (loop.form === 'infix') {
      out.push(`${i + 1}. form: infix`)
      out.push(...side('left: ', loop.left), ...side('right:', loop.right))
    } else if (loop.form === 'prefix') {
      out.push(
        `${i + 1}. form: prefix (left side open: take it from the sentence around the loop, else from the work at hand)`,
      )
      out.push(...side('right:', loop.right))
    } else if (loop.form === 'open') {
      out.push(`${i + 1}. form: open (the other side is open)`)
      out.push(...side('left: ', loop.left))
    } else if (loop.form === 'chain') {
      out.push(
        `${i + 1}. form: chain (${loop.sides.length} on one string; how they pair up is not decided here)`,
      )
      loop.sides.forEach((s, n) => out.push(...side(`${n + 1}:`, s)))
    } else {
      out.push(`${i + 1}. form: ${loop.form}`, `   text: "${loop.text}"`)
    }
  })

  return out.join('\n')
}
