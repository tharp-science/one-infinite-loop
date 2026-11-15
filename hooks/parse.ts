// Grammar of the loop operator. Pure: no engine calls, so it is tested alone.
// The parser finds addresses-to-be; it never decides how a loop is read.

export const LOOP = '⌘'
export const SOURCES = ['obsidian', 'notion', 'scuba', 'web'] as const

export type Side = {
  kind: 'slug' | 'url' | 'path' | 'phrase'
  /** The side as typed, less wrapping punctuation: what gets looked up. */
  text: string
  /** Where the side stands in the prompt, for drawing it as a link. */
  start: number
  end: number
  /** Set on a source-qualified handle such as `notion:field-notes-on-rivers`. */
  source?: string
  slug?: string
  /** A phrase in double quotes: the person's own words, not a reference. */
  isQuoted?: boolean
}

type Form =
  | { form: 'infix'; left: Side; right: Side }
  | { form: 'prefix'; right: Side }
  | { form: 'open'; left: Side }
  | { form: 'undelimited'; text: string }
  | { form: 'chain'; sides: Side[] }
  | { form: 'unparsed'; text: string }

export type Span = { start: number; end: number }

/** A loop, and where its operator stands in the prompt (for drawing it). */
export type Loop = Form & { ops: Span[] }

type Atom = {
  type: 'ws' | 'op' | 'phrase' | 'word'
  text: string
  start: number
  end: number
}

const MODIFIERS = /^[⇧⌥⌃+]/
const KEY_NAMES = new Set([
  'enter',
  'return',
  'tab',
  'space',
  'esc',
  'shift',
  'option',
  'control',
])
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._/:…-]*$/
const URL_RE = /^https?:\/\/\S+$/
const PATH_RE = /^(\.{1,2}\/|\/|~\/)\S+$/

/** Blanks code fences, code spans and quoted lines, keeping every offset. */
const mask = (text: string): string => {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  let out = text.replace(/```[\s\S]*?(```|$)/g, blank)
  out = out.replace(/`[^`\n]*`/g, blank)

  return out
    .split('\n')
    .map(line => (/^\s*>/.test(line) ? blank(line) : line))
    .join('\n')
}

const atomsOf = (line: string, offset: number): Atom[] => {
  const atoms: Atom[] = []
  const re = /(\s+)|(⌘)|("[^"\n]*"|\[[^\]\n]*\])|([^\s⌘"[]+|["[])/g
  for (const m of line.matchAll(re)) {
    const start = offset + m.index
    const text = m[0]
    const type = m[1] ? 'ws' : m[2] ? 'op' : m[3] ? 'phrase' : 'word'
    atoms.push({ type, text, start, end: start + text.length })
  }

  // `i/c/w` standing alone is the operator spelled out.
  return atoms.map((a, i) => {
    const alone =
      a.type === 'word' &&
      a.text === 'i/c/w' &&
      atoms[i - 1]?.type !== 'word' &&
      atoms[i + 1]?.type !== 'word'

    return alone ? { ...a, type: 'op' as const } : a
  })
}

/** Reads one atom as a side, or says it cannot be one. */
const sideOf = (atom: Atom | undefined): Side | undefined => {
  if (!atom) return undefined
  if (atom.type === 'phrase') {
    const text = atom.text.slice(1, -1).trim()

    const isQuoted = atom.text.startsWith('"')

    return text
      ? { kind: 'phrase', text, start: atom.start, end: atom.end, isQuoted }
      : undefined
  }
  if (atom.type !== 'word') return undefined

  // Sentence punctuation around a side is not part of it.
  const lead = /^[(]+/.exec(atom.text)?.[0].length ?? 0
  const trail = /[.,;:!?)…]+$/.exec(atom.text.slice(lead))?.[0].length ?? 0
  const text = atom.text.slice(lead, atom.text.length - trail)
  const start = atom.start + lead
  const at = { text, start, end: start + text.length }
  if (!text) return undefined
  if (URL_RE.test(text)) return { kind: 'url', ...at }
  if (PATH_RE.test(text)) return { kind: 'path', ...at }
  if (!SLUG.test(text)) return undefined

  const colon = text.indexOf(':')
  const source = colon > 0 ? text.slice(0, colon) : ''
  if ((SOURCES as readonly string[]).includes(source)) {
    const slug = text.slice(colon + 1)

    return slug ? { kind: 'slug', ...at, source, slug } : undefined
  }

  return { kind: 'slug', ...at, slug: text }
}

/** A side that needs no guessing about where it starts or ends. */
const isFirm = (side: Side) => side.kind !== 'slug'

/** ⌘K, ⌘⇧P, ⌘+C, ⌘Enter: a keyboard shortcut, not a loop. */
const isShortcut = (right: Atom): boolean => {
  if (right.type !== 'word') return false
  if (MODIFIERS.test(right.text)) return true
  const word = right.text.replace(/[.,;:!?)]+$/, '')

  return [...word].length === 1 || KEY_NAMES.has(word.toLowerCase())
}

type Found = {
  loop: Form
  first: Atom
  last: Atom
  used: Atom[]
  ops: Atom[]
}

const loopsOfLine = (line: string, offset: number, whole: string): Found[] => {
  const atoms = atomsOf(line, offset)
  const found: Found[] = []
  const solid = (a: Atom | undefined) =>
    a && (a.type === 'word' || a.type === 'phrase') ? a : undefined
  const span = (a: Atom, b: Atom) => whole.slice(a.start, b.end)

  atoms.forEach((op, k) => {
    if (op.type !== 'op') return
    const tightL = solid(atoms[k - 1])
    const tightR = solid(atoms[k + 1])
    const left = sideOf(tightL)
    const right = sideOf(tightR)

    if (tightL || tightR) {
      if (!tightL && tightR && isShortcut(tightR)) return
      if (left && right) {
        found.push({
          loop: { form: 'infix', left, right },
          first: tightL!,
          last: tightR!,
          used: [tightL!, tightR!],
          ops: [op],
        })
      } else if (right && !tightL) {
        found.push({
          loop: { form: 'prefix', right },
          first: op,
          last: tightR!,
          used: [tightR!],
          ops: [op],
        })
      } else if (left && !tightR) {
        found.push({
          loop: { form: 'open', left },
          first: tightL!,
          last: op,
          used: [tightL!],
          ops: [op],
        })
      }

      return
    }

    // Spaced: the sides are the neighbours across the whitespace, and only
    // count when nothing has to be guessed about where each one ends.
    const before = atoms.slice(0, k).filter(a => a.type !== 'ws')
    const after = atoms.slice(k + 1).filter(a => a.type !== 'ws')
    const nearL = before.at(-1)
    const nearR = after[0]
    if (!nearL && !nearR) return
    const l = sideOf(nearL?.type === 'op' ? undefined : nearL)
    const r = sideOf(nearR?.type === 'op' ? undefined : nearR)
    const firmL = l && (isFirm(l) || before.length === 1)
    const firmR = r && (isFirm(r) || after.length === 1)
    const first = before[0] ?? op
    const last = after.at(-1) ?? op

    if (l && r && firmL && firmR) {
      found.push({
        loop: { form: 'infix', left: l, right: r },
        first: nearL!,
        last: nearR!,
        used: [nearL!, nearR!],
        ops: [op],
      })
    } else if (l && firmL && !nearR) {
      found.push({
        loop: { form: 'open', left: l },
        first: nearL!,
        last: op,
        used: [nearL!],
        ops: [op],
      })
    } else {
      found.push({
        loop: { form: 'undelimited', text: span(first, last).trim() },
        first,
        last,
        used: [nearL, nearR].filter((a): a is Atom => a !== undefined),
        ops: [op],
      })
    }
  })

  // A side claimed by two operators makes a chain: one loop of several
  // sides. How they pair up is a reading, and is not decided here.
  const sidesIn = (loop: Form): Side[] | undefined =>
    loop.form === 'infix'
      ? [loop.left, loop.right]
      : loop.form === 'chain'
        ? loop.sides
        : undefined
  const merged: Found[] = []
  for (const f of found) {
    const prev = merged.at(-1)
    if (prev && prev.used.some(a => f.used.includes(a))) {
      const sides = sidesIn(prev.loop)
      const loop: Form =
        sides && f.loop.form === 'infix'
          ? { form: 'chain', sides: [...sides, f.loop.right] }
          : { form: 'unparsed', text: span(prev.first, f.last).trim() }
      merged[merged.length - 1] = {
        loop,
        first: prev.first,
        last: f.last,
        used: [...prev.used, ...f.used],
        ops: [...prev.ops, ...f.ops],
      }
    } else {
      merged.push(f)
    }
  }

  return merged
}

/** Every loop in a prompt, in the order written. */
export const parse = (text: string): Loop[] => {
  if (!text.includes(LOOP) && !text.includes('i/c/w')) return []
  const masked = mask(text)
  const loops: Loop[] = []
  let offset = 0
  for (const line of masked.split('\n')) {
    for (const f of loopsOfLine(line, offset, text)) {
      const ops = f.ops.map(a => ({ start: a.start, end: a.end }))
      loops.push({ ...f.loop, ops })
    }
    offset += line.length + 1
  }

  return loops
}

/**
 * Where every loop character stands that is not a keyboard shortcut or
 * inside code or a quotation: what gets coloured, a lone one included.
 */
export const glyphsOf = (text: string): Span[] => {
  if (!text.includes(LOOP)) return []
  const spans: Span[] = []
  let offset = 0
  for (const line of mask(text).split('\n')) {
    const atoms = atomsOf(line, offset)
    atoms.forEach((op, k) => {
      if (op.type !== 'op' || op.text !== LOOP) return
      const before = atoms[k - 1]
      const after = atoms[k + 1]
      const isTightLeft = before?.type === 'word' || before?.type === 'phrase'
      if (!isTightLeft && after && isShortcut(after)) return
      spans.push({ start: op.start, end: op.end })
    })
    offset += line.length + 1
  }

  return spans
}

/** The sides of a loop that can be looked up. */
export const sidesOf = (loop: Loop): Side[] =>
  loop.form === 'infix'
    ? [loop.left, loop.right]
    : loop.form === 'prefix'
      ? [loop.right]
      : loop.form === 'open'
        ? [loop.left]
        : loop.form === 'chain'
          ? loop.sides
          : []

/** A title in plain letters: lower case, accents dropped, hyphens between. */
export const plain = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    // Accents go, their letters stay: für is fur, not fu-r.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * A title as a handle's slug. A long one keeps its beginning and its end
 * and is cut in the middle, at whole words, the way a file manager shows a
 * long file name.
 */
export const slugify = (title: string): string => {
  const whole = plain(title)
  if (whole.length <= 32) return whole
  const words = whole.split('-')
  const take = (from: string[], most: number): string[] => {
    const kept: string[] = []
    for (const word of from) {
      if ([...kept, word].join('-').length > most) break
      kept.push(word)
    }

    return kept
  }
  const head = take(words, 16)
  const tail = take([...words].reverse(), 14).reverse()
  const start = head.length > 0 ? head.join('-') : whole.slice(0, 16)
  const end = tail.length > 0 ? tail.join('-') : whole.slice(-14)

  return `${start}…${end}`
}

/** Whether a slug as typed names this title: whole, by its start, or cut. */
export const fits = (
  title: string,
  wanted: string,
): 'whole' | 'start' | undefined => {
  const full = plain(title)
  const cut = wanted.indexOf('…')
  if (cut >= 0) {
    const head = plain(wanted.slice(0, cut))
    const tail = plain(wanted.slice(cut + 1))

    return full.startsWith(head) && full.endsWith(tail) ? 'whole' : undefined
  }
  const want = plain(wanted)
  if (!want) return undefined

  return full === want ? 'whole' : full.startsWith(want) ? 'start' : undefined
}
