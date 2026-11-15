// On send and in the menu: the resolver and the sample sources, against
// results in the shapes the real servers return.

import { expect, mock, test } from 'claude-code/testing'

type Call = { server: string; tool: string }
type World = { calls: Call[]; sent: { text: string; context?: readonly string[] }[] }

const text = (value: unknown) => ({
  value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false },
})

// Scuba: the address is `url`, the summary nested under `summaries`.
const SCUBA = {
  captures: [
    { id: 'c1', title: 'Mapping the river delta', url: 'https://scuba.app/captures/c1', summaries: { abstract: 'A survey' } },
    { id: 'c2', title: 'Open river model', url: 'https://scuba.app/captures/c2', summaries: { abstract: 'A model' } },
  ],
  collections: [
    { id: 'k1', title: 'River Papers', url: 'https://scuba.app/collections/k1', capture_count: 40, summaries: { abstract: 'Primary sources' } },
    { id: 'k2', title: 'River Strategy', url: 'https://scuba.app/collections/k2', capture_count: 9, summaries: { abstract: 'Strategy' } },
    { id: 'k3', title: 'Coastal notes', url: 'https://scuba.app/collections/k3', capture_count: 114, summaries: { abstract: 'Coasts' } },
    { id: 'k4', title: 'Strategic rivers: scenarios', url: 'https://scuba.app/collections/k4', capture_count: 12, summaries: { abstract: 'Scenarios' } },
  ],
}
const NOTION = {
  results: [
    { id: 'n1', title: 'Field notes on rivers — a working history', url: 'https://app.notion.com/p/n1?pvs=204', path: 'Docs' },
    { id: 'n2', title: 'A glossary of loops', url: 'https://app.notion.com/p/n2?pvs=204', path: 'Docs' },
  ],
}
// An Obsidian vault is read from its folder: no server stands behind it.
const entry = (name: string, kind: 'file' | 'dir') => ({
  name,
  kind,
  size: 0,
  mtimeMs: 0,
  isLink: false,
})
const VAULT: Record<string, ReturnType<typeof entry>[]> = {
  '/vault': [
    entry('.obsidian', 'dir'),
    entry('notes', 'dir'),
    entry('home-copy.md', 'file'),
  ],
  '/vault/notes': [entry('home-copy-old.md', 'file'), entry('picture.png', 'file')],
  '/vault/.obsidian': [entry('home-copy-hidden.md', 'file')],
}

/** Stands for the engine beneath the mod: tools, servers, and the send. */
const world = (on: Parameters<Parameters<typeof test>[1] extends infer B ? B extends (...a: infer A) => unknown ? (...a: A) => unknown : never : never>[1], fail = false): World => {
  const seen: World = { calls: [], sent: [] }
  // The clock stands still, so no search is cut off by its time limit.
  mock.clock(on)
  on('tool.list', () => ({
    value: ['notion-search', 'create_url_capture'].map(tool => ({
      name: `mcp__srv-${tool}__${tool}`,
      description: '',
      mcp: true,
    })),
  }))
  on('mcp.call', (_: unknown, e: { server: string; tool: string }) => {
    seen.calls.push({ server: e.server, tool: e.tool })
    if (fail) throw new Error('server down')
    if (e.tool === 'notion-search') return text(NOTION)

    return text(SCUBA)
  })
  on('fs.list', (_: unknown, e: { path: string }) => ({
    value: VAULT[e.path] ?? [],
  }))
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => {
    seen.sent.push({ text: e.text, context: e.context })

    return { text: e.text, context: e.context }
  })

  return seen
}

const send = ($: { prompt: unknown }, typed: string) =>
  ($.prompt as { submit: (e: object) => Promise<unknown> }).submit({
    text: typed,
    origin: { kind: 'composer' },
    wait: false,
  })

test('a prompt without a loop calls no source and is passed on untouched', async ($, on) => {
  mock.store(on)
  const seen = world(on)
  await send($, 'press ⌘K to search, then ⌘+C')
  expect(seen.calls).toEqual([])
  expect(seen.sent[0]?.context).toBe(undefined)
})

test('a sentence that only mentions the loop attaches nothing', async ($, on) => {
  mock.store(on)
  const seen = world(on)
  await send($, 'can we make the ⌘ stand out a little more?')
  expect(seen.calls).toEqual([])
  expect(seen.sent[0]?.context).toBe(undefined)
})

test('scuba: collections and captures turn about, five at most', async ($, on) => {
  mock.store(on)
  const seen = world(on)
  await send($, '⌘scuba:river')
  const block = seen.sent[0]?.context?.[0] ?? ''
  expect(block).toContain('[one-infinite-loop]')
  expect(block).toContain('left side open')
  expect(block).toContain('ambiguous, 5 candidates')
  expect(block.indexOf('scuba collection | River Papers')).toBeLessThan(
    block.indexOf('scuba | Mapping the river delta'),
  )
  expect(block).toContain('https://scuba.app/captures/c1')
})

test('notion: a typed slug that starts one title resolves to it', async ($, on) => {
  mock.store(on)
  const seen = world(on)
  await send($, '"how does this hold up?"⌘notion:field-notes-on-rivers')
  const block = seen.sent[0]?.context?.[0] ?? ''
  expect(block).toContain('as written')
  expect(block).toContain('https://app.notion.com/p/n1 | resolved (single match)')
  // The quoted side is never searched: one call, to Notion.
  expect(seen.calls.map(c => c.tool)).toEqual(['notion-search'])
})

test(
  'obsidian: notes are found by name in the vault folder, hidden folders left out',
  { options: { obsidianVault: '/vault' } },
  async ($, on) => {
    mock.store(on)
    const seen = world(on)
    await send($, '⌘obsidian:home-copy')
    const block = seen.sent[0]?.context?.[0] ?? ''
    expect(block).toContain('/vault/home-copy.md | resolved (single match)')
    expect(block).not.toContain('.obsidian')
    // The vault needs no server.
    expect(seen.calls).toEqual([])
  },
)

test('obsidian: with no vault folder set the source stays quiet', async ($, on) => {
  mock.store(on)
  const seen = world(on)
  await send($, '⌘obsidian:home-copy')
  expect(seen.sent[0]?.context?.[0] ?? '').toContain('missing')
})

test('three on one string reach Claude as one chain', async ($, on) => {
  mock.store(on)
  const seen = world(on)
  await send($, 'https://a.example/x⌘https://b.example/y⌘https://c.example/z')
  const block = seen.sent[0]?.context?.[0] ?? ''
  expect(block).toContain('form: chain (3 on one string')
  expect(block).toContain('https://c.example/z | resolved (address)')
})

test('the loop alone asks for instructions', async ($, on) => {
  mock.store(on)
  const seen = world(on)
  await send($, '⌘')
  expect(seen.sent[0]?.context?.[0] ?? '').toContain('asks for instructions')
  expect(seen.calls).toEqual([])
})

test('with every source down, the prompt still goes through', async ($, on) => {
  mock.store(on)
  const seen = world(on, true)
  await send($, 'skill⌘oral-history')
  expect(seen.sent.length).toBe(1)
  expect(seen.sent[0]?.text).toBe('skill⌘oral-history')
  expect(seen.sent[0]?.context?.[0] ?? '').toContain('missing')
})

test('the menu searches live and a click writes the handle into the draft', async ($, on) => {
  mock.store(on)
  const seen: World = { calls: [], sent: [] }
  const clock = mock.clock(on)
  const draft = { text: 'see ⌘scuba:rive', cursor: 15 }
  const fills: { text: string; cursor?: number }[] = []
  on('tool.list', () => ({
    value: [{ name: 'mcp__srv__create_url_capture', description: '', mcp: true }],
  }))
  on('mcp.call', (_: unknown, e: { server: string; tool: string }) => {
    seen.calls.push({ server: e.server, tool: e.tool })

    return text(SCUBA)
  })
  on('prompt.edit', (_: unknown, e: { text: string; start: number; end: number; inputText: string }) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  on('prompt.read', () => ({ value: draft }))
  on('prompt.fill', (_: unknown, e: { text: string; cursor?: number }) => {
    fills.push({ text: e.text, cursor: e.cursor })

    return { isFilled: true, text: e.text, cursor: e.cursor ?? e.text.length }
  })

  const prompt = $.prompt as unknown as { edit: (e: object) => Promise<unknown> }
  await prompt.edit({
    origin: { kind: 'composer' },
    text: 'see ⌘scuba:riv',
    cursor: 14,
    start: 14,
    end: 14,
    inputText: 'e',
  })
  // Nothing is asked until the typing has paused.
  expect(seen.calls).toEqual([])
  await clock.advance(200)

  const ui = await $.ui.mount({
    plugin: 'one-infinite-loop',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    surface: 'desktop',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 12,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 11 },
      view: {},
    },
  })
  expect(seen.calls.map(c => c.tool)).toEqual(['search'])
  const row = await ui.find({ type: 'Button', text: /River Papers/ })
  expect(row).toBeDefined()
  await ui.press({ key: 'loop-0' })
  expect(fills.at(-1)?.text).toBe('see ⌘scuba:river-papers ')
  await ui.unmount()
})

// A stranger: no server connected, no vault folder, nothing picked before.
const stranger = (on: Parameters<typeof world>[0]) => {
  const seen: World = { calls: [], sent: [] }
  const clock = mock.clock(on)
  on('tool.list', () => ({ value: [] }))
  on('fs.list', () => ({ value: [] }))
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => {
    seen.sent.push({ text: e.text, context: e.context })

    return { text: e.text, context: e.context }
  })

  return { seen, clock }
}

const ABOVE = {
  plugin: 'one-infinite-loop',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  surface: 'desktop',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 11 },
    view: {},
  },
} as const

const typeLoop = async ($: { prompt: unknown }, on: Parameters<typeof world>[0], word: string) => {
  on('prompt.read', () => ({ value: { text: word, cursor: word.length } }))
  on('prompt.edit', (_: unknown, e: { text: string; start: number; end: number; inputText: string }) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  await ($.prompt as { edit: (e: object) => Promise<unknown> }).edit({
    origin: { kind: 'composer' },
    text: word.slice(0, -1),
    cursor: word.length - 1,
    start: word.length - 1,
    end: word.length - 1,
    inputText: word.slice(-1),
  })
}

test('with no source set up, the menu says so and shows what works without one', async ($, on) => {
  mock.store(on)
  const { clock } = stranger(on)
  await typeLoop($, on, '⌘heron')
  await clock.advance(400)
  const ui = await $.ui.mount(ABOVE)
  expect(await ui.find({ type: 'Text', text: /no source is set up/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /https:\/\/.*⌘"/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\/1loop sources/ })).toBeDefined()
  await ui.unmount()
})

test('a source that answers with nothing still says nothing found, without the setup hint', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  on('tool.list', () => ({
    value: [{ name: 'mcp__srv__create_url_capture', description: '', mcp: true }],
  }))
  on('mcp.call', () => text({ captures: [], collections: [] }))
  on('fs.list', () => ({ value: [] }))
  await typeLoop($, on, '⌘scuba:egret')
  await clock.advance(400)
  const ui = await $.ui.mount(ABOVE)
  expect(await ui.find({ type: 'Text', text: /nothing found/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /no source is set up/ })).toBeUndefined()
  await ui.unmount()
})

test('with no source set up, a search on send tells Claude why it is missing', async ($, on) => {
  mock.store(on)
  const { seen } = stranger(on)
  await send($, '⌘kestrel what is in here?')
  const block = seen.sent[0]?.context?.[0] ?? ''
  expect(block).toContain('"kestrel" -> missing (no source answered')
  expect(block).toContain('a link or quoted words')
})
