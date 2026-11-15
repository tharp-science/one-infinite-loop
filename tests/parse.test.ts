// The grammar, case by case.

import { expect, test } from 'claude-code/testing'

import { fits, parse, sidesOf, slugify } from '../hooks/parse'

const forms = (text: string) => parse(text).map(k => k.form)
const sides = (text: string) =>
  parse(text).map(k => [
    'left' in k ? k.left.text : undefined,
    'right' in k ? k.right.text : undefined,
  ])

test('infix, tight, spaced and spelled out', async () => {
  for (const text of [
    'skill⌘oral-history',
    'skill ⌘ oral-history',
    'skill i/c/w oral-history',
  ]) {
    expect(forms(text)).toEqual(['infix'])
    expect(sides(text)).toEqual([['skill', 'oral-history']])
  }
  expect(sides('a⌘b')).toEqual([['a', 'b']])
})

test('prefix, two prefixes and open', async () => {
  expect(sides('⌘oral-history')).toEqual([[undefined, 'oral-history']])
  expect(forms('⌘skill ⌘oral-history')).toEqual(['prefix', 'prefix'])
  expect(forms('skill⌘')).toEqual(['open'])
  expect(sides('skill⌘')).toEqual([['skill', undefined]])
})

test('a source-qualified handle', async () => {
  const [loop] = parse('⌘notion:field-notes-on-rivers')
  expect(loop?.form).toBe('prefix')
  if (loop?.form !== 'prefix') return
  expect(loop.right.source).toBe('notion')
  expect(loop.right.slug).toBe('field-notes-on-rivers')
})

test('addresses and phrases', async () => {
  const [loop] = parse('https://example.org/ ⌘ ./notes/draft.md')
  expect(loop?.form).toBe('infix')
  if (loop?.form !== 'infix') return
  expect(loop.left.kind).toBe('url')
  expect(loop.right.kind).toBe('path')
  expect(sides('"the home page copy" ⌘ [the oral history]')).toEqual([
    ['the home page copy', 'the oral history'],
  ])
})

test('what the mod leaves to Claude', async () => {
  expect(forms('the home page copy ⌘ the oral history')).toEqual([
    'undelimited',
  ])
  expect(forms('a⌘b⌘')).toEqual(['unparsed'])
  expect(forms('compare skill ⌘ oral-history')).toEqual(['undelimited'])
})

test('what is not a loop', async () => {
  for (const text of [
    'press ⌘K',
    '⌘⇧P',
    '⌘+C',
    '⌘Enter',
    'run `skill⌘oral-history` here',
    '```\nskill⌘oral-history\n```',
    '> skill⌘oral-history',
    'icw',
    'no loop at all',
  ]) {
    expect(forms(text)).toEqual([])
  }
})

test('sentence punctuation is not part of a side', async () => {
  expect(sides('see (skill⌘oral-history).')).toEqual([
    ['skill', 'oral-history'],
  ])
})

test('a slug keeps the letters under accents', async () => {
  expect(slugify('Über die Brücke')).toBe('uber-die-brucke')
})

test('two picked handles with the loop between them are one infix', async () => {
  const [loop, ...rest] = parse('notion:field-notes⌘scuba:river-papers')
  expect(rest).toEqual([])
  expect(loop?.form).toBe('infix')
  if (loop?.form !== 'infix') return
  expect(loop.left.source).toBe('notion')
  expect(loop.right.source).toBe('scuba')
})

test('quotes mark the person\'s own words, brackets a phrase to look up', async () => {
  const [loop] = parse('"how does this hold up?"⌘[the oral history]')
  expect(loop?.form).toBe('infix')
  if (loop?.form !== 'infix') return
  expect(loop.left.isQuoted).toBe(true)
  expect(loop.right.isQuoted).toBe(false)
})

test('a long title keeps its beginning and end, cut in the middle', async () => {
  const title = 'A short history of the river and the people who mapped it'
  const slug = slugify(title)
  expect(slug).toBe('a-short-history…who-mapped-it')
  expect(fits(title, slug)).toBe('whole')
  expect(fits(title, 'a-short-history-of-the-river')).toBe('start')
  expect(fits(title, 'mountain')).toBe(undefined)
  const [loop] = parse(`⌘notion:${slug} `)
  expect(loop?.form).toBe('prefix')
  if (loop?.form === 'prefix') expect(loop.right.slug).toBe(slug)
})

test('three on one string are one loop of several', async () => {
  const [loop, ...rest] = parse('notion:a-b⌘scuba:c-d⌘obsidian:e-f')
  expect(rest).toEqual([])
  expect(loop?.form).toBe('chain')
  expect(loop ? sidesOf(loop).map(s => s.source) : []).toEqual([
    'notion',
    'scuba',
    'obsidian',
  ])
})
