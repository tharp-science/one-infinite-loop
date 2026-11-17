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

const onMac = (on: Parameters<typeof world>[0], isMac: boolean) =>
  on('fs.exists', (_: unknown, e: { path: string }) => ({
    value: isMac && e.path === '/System/Library/CoreServices/SystemVersion.plist',
  }))

test('the loop alone starts the guided first loop, with the sources and the key installer', async ($, on) => {
  mock.store(on)
  const seen = world(on)
  onMac(on, true)
  await send($, '⌘')
  const block = seen.sent[0]?.context?.[0] ?? ''
  expect(block).toContain('start the guided first loop')
  expect(block).toContain('notion: connected')
  expect(block).toContain('scuba: connected')
  expect(block).toContain('obsidian: no vault folder set')
  expect(block).toMatch(/extras\/right-command\/install\.sh/)
  // Nothing is searched to say so.
  expect(seen.calls).toEqual([])
})

test('for a stranger, the loop alone says which sources are not connected', async ($, on) => {
  mock.store(on)
  const { seen } = stranger(on)
  await send($, '⌘')
  const block = seen.sent[0]?.context?.[0] ?? ''
  expect(block).toContain('notion: not connected')
  expect(block).toContain('web: on')
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
  expect(await ui.find({ type: 'Button', text: /use your words as written/ })).toBeDefined()
  await ui.unmount()
})

// The menu with Scuba and Notion connected and no vault folder set.
const connected = (on: Parameters<typeof world>[0]) => {
  const clock = mock.clock(on)
  const fills: string[] = []
  on('tool.list', () => ({
    value: ['notion-search', 'create_url_capture'].map(tool => ({
      name: `mcp__srv-${tool}__${tool}`,
      description: '',
      mcp: true,
    })),
  }))
  on('mcp.call', (_: unknown, e: { tool: string }) =>
    text(e.tool === 'notion-search' ? NOTION : SCUBA),
  )
  on('fs.list', () => ({ value: [] }))
  on('prompt.fill', (_: unknown, e: { text: string; cursor?: number }) => {
    fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.cursor ?? e.text.length }
  })

  return { clock, fills }
}

test('the menu names each source in a pill with what it found, and leaves out one not set up', async ($, on) => {
  mock.store(on)
  const { clock } = connected(on)
  await typeLoop($, on, '⌘river')
  await clock.advance(400)
  const ui = await $.ui.mount(ABOVE)
  expect(await ui.find({ type: 'Text', text: /^ notion 2 $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ scuba \d+ $/ })).toBeDefined()
  // No vault folder is set: Obsidian stays quiet, as the README says.
  expect(await ui.find({ type: 'Text', text: /not reached/ })).toBeUndefined()
  // A row: the title plain, its source in a pill.
  expect(await ui.find({ type: 'Text', text: /^ notion $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Found$/ })).toBeDefined()
  await ui.unmount()
})

test('a source that is set up but does not answer in time is named', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  on('tool.list', () => ({
    value: [{ name: 'mcp__srv__create_url_capture', description: '', mcp: true }],
  }))
  on('mcp.call', () => new Promise(() => {}))
  on('fs.list', () => ({ value: [] }))
  await typeLoop($, on, '⌘scuba:river')
  await clock.advance(4400)
  const ui = await $.ui.mount(ABOVE)
  expect(await ui.find({ type: 'Text', text: /not reached/ })).toBeDefined()
  await ui.unmount()
})

test('on a narrow band a long title is cut before its source pill', async ($, on) => {
  mock.store(on)
  const { clock } = connected(on)
  await typeLoop($, on, '⌘notion:field')
  await clock.advance(400)
  const ui = await $.ui.mount({ ...ABOVE, props: { ...ABOVE.props, bodyColumns: 40 } })
  const row = await ui.find({ key: 'loop-0' })
  expect(row?.text).toMatch(/^Field notes on rivers.*…/)
  expect(row?.text).toMatch(/ notion $/)
  await ui.unmount()
})

test('results beyond the band\'s rows are counted, not drawn', async ($, on) => {
  mock.store(on)
  const { clock } = connected(on)
  await typeLoop($, on, '⌘river')
  await clock.advance(400)
  const ui = await $.ui.mount({ ...ABOVE, props: { ...ABOVE.props, maxRows: 6 } })
  expect(await ui.find({ type: 'Text', text: /more · keep typing to narrow/ })).toBeDefined()
  expect(await ui.find({ key: 'loop-4' })).toBeUndefined()
  await ui.unmount()
})

test('a source pill keeps the words typed, and all sources undoes the narrowing', async ($, on) => {
  mock.store(on)
  const { clock, fills } = connected(on)
  await typeLoop($, on, '⌘scuba:egret')
  await clock.advance(400)
  const ui = await $.ui.mount(ABOVE)
  await ui.press({ key: 'src-notion' })
  expect(fills.at(-1)).toBe('⌘notion:egret')
  await ui.press({ key: 'src-all' })
  expect(fills.at(-1)).toBe('⌘egret')
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

test('on the desktop, typing icw offers the loop character, and a click puts it in', async ($, on) => {
  mock.store(on)
  const { clock } = stranger(on)
  const fills: string[] = []
  on('prompt.fill', (_: unknown, e: { text: string; cursor?: number }) => {
    fills.push(e.text)

    return { isFilled: true, text: e.text, cursor: e.cursor ?? e.text.length }
  })
  await typeLoop($, on, 'see icw')
  await clock.advance(10)
  const ui = await $.ui.mount(ABOVE)
  expect(await ui.find({ type: 'Button', text: /in correspondence with/ })).toBeDefined()
  await ui.press({ key: 'loop-0' })
  expect(fills.at(-1)).toBe('see ⌘')
  await ui.unmount()
})

test('off macOS, the loop alone names no key installer and says icw instead', async ($, on) => {
  mock.store(on)
  const seen = world(on)
  onMac(on, false)
  await send($, '⌘')
  const block = seen.sent[0]?.context?.[0] ?? ''
  expect(block).not.toContain('install.sh')
  expect(block).toContain('no key installer for this system')
  expect(block).toContain('icw')
  expect(block).toContain('PowerToys')
  expect(block).toContain('No loop shortcut is set')
})

const typed = async ($: { prompt: unknown }, on: Parameters<typeof world>[0], before: string, char: string) => {
  on('prompt.read', () => ({ value: { text: before + char, cursor: before.length + 1 } }))
  on('prompt.edit', (_: unknown, e: { text: string; start: number; end: number; inputText: string }) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))

  return ($.prompt as { edit: (e: object) => Promise<{ text: string; cursor: number }> }).edit({
    origin: { kind: 'composer' },
    text: before,
    cursor: before.length,
    start: before.length,
    end: before.length,
    inputText: char,
  })
}

test('a loop shortcut of your own becomes the loop character as you type it', { options: { loopShortcut: ';;' } }, async ($, on) => {
  mock.store(on)
  stranger(on)
  const box = await typed($, on, 'see ;', ';')
  expect(box.text).toBe('see ⌘')
  expect(box.cursor).toBe(5)
})

test('a loop shortcut made only of letters or digits is ignored, so no word is ever replaced', { options: { loopShortcut: 'and' } }, async ($, on) => {
  mock.store(on)
  stranger(on)
  const box = await typed($, on, 'this an', 'd')
  expect(box.text).toBe('this and')
})

const sendFrom = ($: { prompt: unknown }, typed: string, kind: string) =>
  ($.prompt as { submit: (e: object) => Promise<unknown> }).submit({
    text: typed,
    origin: { kind },
    wait: false,
  })

for (const kind of ['bridge', 'sdk'] as const) {
  test(`a loop sent with origin ${kind} (a phone through Remote Control, the desktop host) is resolved too`, async ($, on) => {
    mock.store(on)
    const seen = world(on)
    await sendFrom($, 'https://a.example/x⌘"is this still true?"', kind)
    expect(seen.sent[0]?.context?.[0] ?? '').toContain('https://a.example/x | resolved (address)')
  })
}

test('from a phone, the key installer is not offered, and iOS text replacement is named', async ($, on) => {
  mock.store(on)
  const seen = world(on)
  onMac(on, true)
  await sendFrom($, '⌘', 'bridge')
  const block = seen.sent[0]?.context?.[0] ?? ''
  expect(block).not.toContain('install.sh')
  expect(block).toContain('Remote Control')
  expect(block).toContain('Text Replacement')
})

// Sosumi: the Mac's own copy is played when every loop resolves; never shipped.
const SOSUMI = '/System/Library/Sounds/Sosumi.aiff'
const settle = async () => {
  for (let n = 0; n < 50; n += 1) await Promise.resolve()
}
const withSosumi = (on: Parameters<typeof world>[0], isThere: boolean) => {
  const played: { base64?: string; mime?: string }[] = []
  on('fs.exists', (_: unknown, e: { path: string }) => ({
    value: isThere && e.path === SOSUMI,
  }))
  on('fs.read', (_: unknown, e: { path: string }) => ({
    value: e.path === SOSUMI ? { base64: 'Rk9STQ==' } : '',
  }))
  on('audio.play', (_: unknown, e: { clip: { base64?: string; mime?: string } }) => {
    played.push(e.clip)

    return { value: undefined }
  })

  return played
}

test('a message whose loops all resolve plays the Mac\'s own Sosumi', async ($, on) => {
  mock.store(on)
  world(on)
  const played = withSosumi(on, true)
  await send($, 'https://a.link⌘"a question"')
  await settle()
  expect(played).toEqual([{ base64: 'Rk9STQ==', mime: 'audio/aiff' }])
})

test('a loop with a side left unresolved plays nothing', async ($, on) => {
  mock.store(on)
  world(on)
  const played = withSosumi(on, true)
  await send($, 'notion:zzzz-nowhere⌘"a question"')
  await settle()
  expect(played).toEqual([])
})

test('without the Mac\'s sound file (Windows, Linux) a resolved loop plays nothing', async ($, on) => {
  mock.store(on)
  world(on)
  const played = withSosumi(on, false)
  await send($, 'https://a.link⌘"a question"')
  await settle()
  expect(played).toEqual([])
})

test('a message with no loop plays nothing', async ($, on) => {
  mock.store(on)
  world(on)
  const played = withSosumi(on, true)
  await send($, 'press ⌘K to search')
  await settle()
  expect(played).toEqual([])
})
