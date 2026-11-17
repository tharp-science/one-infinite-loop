// The loop in a sent message is drawn coloured, on every surface that
// draws user messages.

import { expect, test } from 'claude-code/testing'

const MESSAGE = {
  plugin: 'one-infinite-loop',
  component: 'UserMessage',
  requestId: 'm1',
  props: {
    text: 'see skill⌘https://example.org/ please',
    origin: { kind: 'composer' },
    isExpanded: true,
  },
} as const

test('the loop is drawn as its own coloured glyph', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...MESSAGE, surface })
    const glyph = await ui.find({ type: 'Text', text: /^⌘$/ })
    expect(glyph?.text).toBe('⌘')
    expect(await ui.find({ type: 'Link' })).toBeDefined()
    await ui.unmount()
  }
})

test('a lone loop character is coloured too', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('clock.every', () => ({ value: undefined }))

  const ui = await $.ui.mount({
    ...MESSAGE,
    surface: 'desktop',
    props: { ...MESSAGE.props, text: '⌘' },
  })
  expect((await ui.find({ type: 'Text', text: /^⌘$/ }))?.text).toBe('⌘')
  await ui.unmount()
})

test('a message without a loop is left to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({
    ...MESSAGE,
    surface: 'desktop',
    props: { ...MESSAGE.props, text: 'press ⌘K to search' },
  })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('the picker pane draws a source choice and a search field', async ($, on) => {
  on('store.get', () => ({ value: undefined }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'one-infinite-loop',
      component: 'Pane',
      requestId: 'loop-pick',
      surface,
      props: {
        title: 'pick',
        isFocused: false,
        bodyColumns: 40,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 20 },
        view: {},
      },
    })
    expect(await ui.find({ key: 'query' })).toBeDefined()
    expect(await ui.find({ key: 'source' })).toBeDefined()
    await ui.unmount()
  }
})

test('typing a loop opens the menu above the prompt', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('prompt.edit', (_, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))

  // The kit raises the event at run time; its typings do not list it.
  const prompt = $.prompt as unknown as {
    edit: (e: object) => Promise<unknown>
  }
  await prompt.edit({
    origin: { kind: 'composer' },
    text: 'see ',
    cursor: 4,
    start: 4,
    end: 4,
    inputText: '⌘',
  })

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
  // Sources are one line of pills; the usage card is two lines.
  expect(await ui.find({ key: 'src-notion' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /connect two/ })).toBeDefined()
  await ui.unmount()
})

test('a loop typed after a picked fragment strings the two together', async ($, on) => {
  on('store.get', () => ({ value: undefined }))
  on('prompt.edit', (_, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  const prompt = $.prompt as unknown as {
    edit: (e: object) => Promise<{ text: string; cursor: number }>
  }

  const box = await prompt.edit({
    origin: { kind: 'composer' },
    text: 'see ⌘notion:field-notes ',
    cursor: 24,
    start: 24,
    end: 24,
    inputText: '⌘',
  })
  expect(box.text).toBe('see notion:field-notes⌘')
  expect(box.cursor).toBe(23)
})
