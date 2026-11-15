// Handles: fragments picked once, kept in the mod's store across sessions.

import type { EngineInterface } from 'claude-code'

import { slugify } from './parse'

export type Fragment = {
  source: string
  title: string
  address: string
  snippet?: string
  /** What sort of thing it is, where a source has several: a collection. */
  kind?: string
}

export type Handle = {
  slug: string
  source: string
  address: string
  title: string
  usedAt: number
}

const KEY = 'handles'
const MOST = 2000

const isHandle = (v: unknown): v is Handle => {
  const h = v as Handle | null

  return (
    typeof h === 'object' &&
    h !== null &&
    typeof h.slug === 'string' &&
    typeof h.source === 'string' &&
    typeof h.address === 'string' &&
    typeof h.title === 'string' &&
    typeof h.usedAt === 'number'
  )
}

export async function loadHandles($: EngineInterface): Promise<Handle[]> {
  const stored = await $.store.get(KEY)

  return Array.isArray(stored) ? stored.filter(isHandle) : []
}

function save($: EngineInterface, handles: Handle[]): Promise<void> {
  return $.store.set(
    KEY,
    [...handles].sort((a, b) => b.usedAt - a.usedAt).slice(0, MOST),
  )
}

export const findHandle = (
  handles: readonly Handle[],
  slug: string,
  source?: string,
): Handle | undefined =>
  handles.find(h => h.slug === slug && (!source || h.source === source))

/** The slug a fragment gets: its own if it has one, else one no other holds. */
export const slugFor = (
  handles: readonly Handle[],
  fragment: Fragment,
): string => {
  const known = handles.find(
    h => h.source === fragment.source && h.address === fragment.address,
  )
  if (known) return known.slug
  const base = slugify(fragment.title) || 'untitled'
  const taken = (slug: string) =>
    handles.some(h => h.source === fragment.source && h.slug === slug)
  let slug = base
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`

  return slug
}

/** Saves a handle, or marks an existing one as just used. */
export async function keepHandle(
  $: EngineInterface,
  handle: Omit<Handle, 'usedAt'>,
): Promise<void> {
  const handles = await loadHandles($)
  const rest = handles.filter(
    h => !(h.slug === handle.slug && h.source === handle.source),
  )
  await save($, [...rest, { ...handle, usedAt: Date.now() }])
}

/** Removes a handle, written `slug` or `source:slug`; says how many went. */
export async function forgetHandle(
  $: EngineInterface,
  name: string,
): Promise<number> {
  const handles = await loadHandles($)
  const colon = name.indexOf(':')
  const source = colon > 0 ? name.slice(0, colon) : undefined
  const slug = colon > 0 ? name.slice(colon + 1) : name
  const rest = handles.filter(
    h => !(h.slug === slug && (!source || h.source === source)),
  )
  if (rest.length !== handles.length) await save($, rest)

  return handles.length - rest.length
}
