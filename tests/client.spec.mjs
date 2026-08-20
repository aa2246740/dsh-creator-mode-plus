import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, it } from 'node:test'

describe('Creator Mode+ browser sentry', () => {
  it('reports an exact FAILED loader entry and reloads only after Guardian approval', async () => {
    const source = readFileSync(join(import.meta.dirname, '../src/client.js'), 'utf8')
    let registration
    let statusListener
    let request
    let reloaded = false
    const storage = new Map()
    class Observer {
      observe() {}
      disconnect() {}
    }
    runInNewContext(source, {
      window: { __ModuleLoader__: { load(value) { registration = value } } },
      document: { documentElement: {}, querySelector: () => null },
      MutationObserver: Observer,
      sessionStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
      },
      location: { reload() { reloaded = true } },
      fetch: async (path, options) => {
        request = { path, options }
        return { ok: true, json: async () => ({ reload: true }) }
      },
      console,
      setTimeout,
      clearTimeout,
    })
    assert.equal(registration.id, 'dsh-creator-mode-plus')
    const exports = registration.factory()
    assert.deepEqual(Array.from(exports.inject), ['loader'])
    exports.apply({
      loader: { entries: () => [] },
      on(event, listener) {
        if (event === 'internal/status') statusListener = listener
      },
      effect() {},
    })
    statusListener({ state: 3, entry: { options: { name: 'broken-client' } } })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(request.path, '/dsh-creator-mode-plus/client-failure')
    assert.deepEqual(JSON.parse(request.options.body), {
      failedIds: ['broken-client'],
      message: 'client loader entry broken-client entered FAILED',
    })
    assert.equal(reloaded, true)
  })
})
