// Source adapters: a query and a limit in, fragments out. Read-only.

import type { EngineInterface } from 'claude-code'

import type { Fragment } from './store'

export type Config = {
  order: string[]
  servers: Record<string, string>
  obsidianVault: string
  obsidianLinkBase: string
  sendBudgetMs: number
  rows: number
  candidates: number
  isDebug: boolean
  linkStyle: string
  shimmerSeconds: number
  /** Typed characters that turn into ⌘; '' when off or not usable. */
  loopShortcut: string
  /** 'sosumi' plays the Mac's own alert sound when every loop in a message resolves; 'off' plays nothing. */
  loopSound: 'sosumi' | 'off'
}

export type SourceState = 'ok' | 'empty' | 'unavailable' | 'not asked'

/** How each source last answered, for `/1loop sources`. */
export const lastAnswer = new Map<string, { state: SourceState; note: string }>()

/** A tool only that source's server has, to find the server by. */
const MARKER: Record<string, string> = {
  notion: 'notion-search',
  scuba: 'create_url_capture',
}

const servers = new Map<string, string>()

/** The MCP server a source is reached through: configured, else discovered. */
async function serverOf(
  $: EngineInterface,
  config: Config,
  source: string,
): Promise<string> {
  const set = config.servers[source]
  if (set) return set
  const known = servers.get(source)
  if (known) return known
  const suffix = `__${MARKER[source]}`
  const tool = (await $.tool.list()).find(
    t => t.name.startsWith('mcp__') && t.name.endsWith(suffix),
  )
  if (!tool) throw new Error(`no connected server has ${MARKER[source]}`)
  const server = tool.name.slice('mcp__'.length, -suffix.length)
  servers.set(source, server)

  return server
}

/** Calls a tool and reads its first text block as JSON. */
async function callJson(
  $: EngineInterface,
  server: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await $.mcp.call(server, tool, args)
  const text = result.content.find(b => typeof b.text === 'string')?.text ?? ''
  if (result.isError) throw new Error(text.slice(0, 120) || 'tool error')
  if (result.structuredContent !== undefined) return result.structuredContent

  return JSON.parse(text)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

async function notion(
  $: EngineInterface,
  config: Config,
  query: string,
  limit: number,
): Promise<Fragment[]> {
  const server = await serverOf($, config, 'notion')
  const answer = await callJson($, server, 'notion-search', {
    query,
    page_size: limit,
    max_highlight_length: 80,
  })

  return list(rec(answer).results)
    .map(rec)
    .filter(row => str(row.url) !== '' && str(row.title) !== '')
    .map(row => ({
      source: 'notion',
      title: str(row.title),
      // The view marker is not part of the page's address.
      address: str(row.url).replace(/\?pvs=\d+$/, ''),
      snippet: str(row.path) || str(row.highlight),
    }))
}

async function scuba(
  $: EngineInterface,
  config: Config,
  query: string,
  limit: number,
): Promise<Fragment[]> {
  const server = await serverOf($, config, 'scuba')
  const answer = await callJson($, server, 'search', {
    search_queries: [query],
    limit,
  })

  const read = (rows: unknown, kind?: string): Fragment[] =>
    list(rows)
      .map(rec)
      .map(row => ({
        source: 'scuba',
        title: str(row.title) || 'Untitled',
        // The address is `url`, the summary nested under `summaries`.
        address: str(row.url) || str(row.permalink),
        snippet: [
          kind && typeof row.capture_count === 'number'
            ? `${row.capture_count} captures`
            : '',
          (str(rec(row.summaries).abstract) || str(row.summary)).slice(0, 80),
        ]
          .filter(Boolean)
          .join(' · '),
        ...(kind ? { kind } : {}),
      }))
      .filter(row => row.address !== '')
  const collections = read(rec(answer).collections, 'collection')
  const captures = read(rec(answer).captures)

  // Both kinds, turn about, so neither crowds the other out of the list.
  const mixed: Fragment[] = []
  for (let n = 0; n < Math.max(collections.length, captures.length); n++) {
    const collection = collections[n]
    const capture = captures[n]
    if (collection) mixed.push(collection)
    if (capture) mixed.push(capture)
  }

  return mixed.slice(0, limit)
}

type Note = { name: string; path: string }
let notes: { at: number; vault: string; list: Note[] } | undefined

/**
 * Every note in the vault, read from the folder itself: no server needed.
 * Hidden folders are skipped, the walk is bounded, and the list is kept
 * for a minute so that typing does not walk the vault again and again.
 */
async function vaultNotes($: EngineInterface, vault: string): Promise<Note[]> {
  if (notes && notes.vault === vault && Date.now() - notes.at < 60_000) {
    return notes.list
  }
  const list: Note[] = []
  let level = ['']
  for (let depth = 0; depth < 8 && level.length > 0; depth++) {
    const next: string[] = []
    for (const folder of level) {
      if (list.length + next.length > 20_000) break
      const entries = await $.fs.list(folder ? `${vault}/${folder}` : vault)
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const path = folder ? `${folder}/${entry.name}` : entry.name
        if (entry.kind === 'dir') next.push(path)
        else if (entry.kind === 'file' && entry.name.endsWith('.md')) {
          list.push({ name: entry.name.slice(0, -3), path })
        }
      }
    }
    level = next
  }
  notes = { at: Date.now(), vault, list }

  return list
}

/** An Obsidian vault as a sample source: notes matched by their names. */
async function obsidian(
  $: EngineInterface,
  config: Config,
  query: string,
  limit: number,
): Promise<Fragment[]> {
  const vault = config.obsidianVault.replace(/\/$/, '')
  if (!vault) throw new Error('no vault folder set')
  const words = query.toLowerCase().split(/[\s-]+/).filter(Boolean)

  return (await vaultNotes($, vault))
    .filter(note => words.every(w => note.name.toLowerCase().includes(w)))
    .sort((x, y) => x.name.length - y.name.length)
    .slice(0, limit)
    .map(note => ({
      source: 'obsidian',
      title: note.name,
      address: `${vault}/${note.path}`,
      snippet: note.path,
    }))
}

const SEARCHED = ['obsidian', 'notion', 'scuba']

export const canSearch = (source: string): boolean => SEARCHED.includes(source)

/**
 * True when none of these sources could be asked: each is not set up, not
 * connected, or failed on its last try. A source that answered with nothing
 * does not count: that is "nothing found", not "nothing set up".
 */
export const noneAnswered = (sources: string[]): boolean =>
  sources.every(source => lastAnswer.get(source)?.state === 'unavailable')

/**
 * Whether a source can be reached now, without searching it: a server found
 * by its marker tool, or a vault folder set. For the guided first loop.
 */
export async function reachOf(
  $: EngineInterface,
  config: Config,
  source: string,
): Promise<string> {
  if (source === 'obsidian') {
    return config.obsidianVault
      ? 'vault folder set'
      : 'no vault folder set (plugin setting: Obsidian vault folder)'
  }
  try {
    await serverOf($, config, source)

    return 'connected'
  } catch {
    return 'not connected (connect it in Claude, then start a new session)'
  }
}

/** Said in the menu and on send when no source could be asked. */
export const SETUP_HINT = {
  menu: 'no source is set up',
  lines: [
    'Works without one: a link or quoted words, such as https://a.link⌘"a question"',
    'To search: set the Obsidian vault folder in the plugin settings, or connect Notion or Scuba. /1loop sources shows each.',
  ],
  send: 'no source answered: none is set up or connected; a link or quoted words work without one',
}

function ask(
  $: EngineInterface,
  config: Config,
  source: string,
  query: string,
  limit: number,
): Promise<Fragment[]> {
  if (source === 'notion') return notion($, config, query, limit)
  if (source === 'scuba') return scuba($, config, query, limit)

  return obsidian($, config, query, limit)
}

type Cached = { at: number; hits: Promise<Fragment[]> }
const cache = new Map<string, Cached>()

/**
 * Searches one source. Answers are kept for a minute and a search in flight
 * is shared. A source that fails answers nothing and is marked unavailable.
 */
export function search(
  $: EngineInterface,
  config: Config,
  source: string,
  query: string,
  limit: number,
): Promise<Fragment[]> {
  if (!canSearch(source) || !config.order.includes(source)) {
    return Promise.resolve([])
  }
  const key = `${source}\n${query.toLowerCase()}\n${limit}`
  const held = cache.get(key)
  if (held && Date.now() - held.at < 60_000) return held.hits

  const hits = ask($, config, source, query, limit).then(
    found => {
      lastAnswer.set(source, {
        state: found.length > 0 ? 'ok' : 'empty',
        note: `${found.length} for "${query}"`,
      })

      return found
    },
    (error: unknown) => {
      cache.delete(key)
      lastAnswer.set(source, {
        state: 'unavailable',
        note: error instanceof Error ? error.message.slice(0, 120) : 'failed',
      })
      if (config.isDebug) $.ui.log(`one-infinite-loop: ${source} did not answer`)

      return []
    },
  )
  cache.set(key, { at: Date.now(), hits })
  if (cache.size > 200) cache.delete(cache.keys().next().value ?? key)

  return hits
}

/** What `p` resolves to, or `fallback` once `ms` have passed. */
export function within<T>(
  $: EngineInterface,
  p: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    p,
    $.clock.sleep(Math.max(1, ms)).then(() => fallback),
  ])
}
