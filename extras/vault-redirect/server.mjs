#!/usr/bin/env node
// Makes vault notes clickable from surfaces that only open web links.
// GET http://localhost:<port>/vault/<path inside the vault> answers with a
// redirect to obsidian://open?path=<that file>. It reads nothing, writes
// nothing, and listens on this machine only.
//
//   LOOP_VAULT_ROOT=/path/to/vault node server.mjs
//
// Then set the mod's "Obsidian link base" to http://localhost:27124/vault/

import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const root = process.env.LOOP_VAULT_ROOT ? resolve(process.env.LOOP_VAULT_ROOT) : ''
const port = Number(process.env.LOOP_PORT ?? 27124)
if (!root || !existsSync(root)) {
  console.error('Set LOOP_VAULT_ROOT to the folder of your Obsidian vault.')
  process.exit(1)
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const prefix = '/vault/'
  if (request.method !== 'GET' || !url.pathname.startsWith(prefix)) {
    response.writeHead(404).end('Not found')
    return
  }
  let relative
  try {
    relative = decodeURIComponent(url.pathname.slice(prefix.length))
  } catch {
    response.writeHead(400).end('Bad path')
    return
  }
  const file = resolve(root, relative)
  // Nothing outside the vault, and only notes that exist.
  if (!file.startsWith(root + sep) || !existsSync(file)) {
    response.writeHead(404).end('No such note in the vault')
    return
  }
  response
    .writeHead(302, { Location: `obsidian://open?path=${encodeURIComponent(file)}` })
    .end()
}).listen(port, '127.0.0.1', () => {
  console.log(`vault redirect on http://localhost:${port}/vault/ for ${root}`)
})
