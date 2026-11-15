// The sound of a loop that closed: Apple's Sosumi, played from the copy that
// ships with macOS. The file is never bundled: the macOS licence (section 2J)
// forbids redistributing it, while playing the Mac's own copy is ordinary use.
// Where the file is absent (Windows, Linux, a phone) nothing plays.

import type { EngineInterface } from 'claude-code'

import type { Resolved } from './resolve'

export const SOSUMI = '/System/Library/Sounds/Sosumi.aiff'

/** Every side of every loop has an address or is written out: nothing missing or ambiguous. */
export const allResolved = (resolved: Resolved[]): boolean =>
  resolved.length > 0 &&
  resolved.every(({ sides }) =>
    [...sides.values()].every(
      side => side.status === 'resolved' || side.status === 'written',
    ),
  )

let bytes: string | undefined

/** Plays Sosumi once; never throws, and reads the file once it is found. */
export async function chime($: EngineInterface): Promise<void> {
  try {
    if (bytes === undefined) {
      if (!(await $.fs.exists(SOSUMI))) return
      const read = await $.fs.read(SOSUMI, { as: 'bytes' })
      bytes = typeof read === 'string' ? undefined : read.base64
    }
    if (bytes) await $.audio.play({ base64: bytes, mime: 'audio/aiff' })
  } catch {
    // A sound is never worth an error: a refused read or a surface with no
    // player leaves the send as it was.
  }
}
