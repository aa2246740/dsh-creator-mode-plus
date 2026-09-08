import assert from 'node:assert/strict'
import { test } from 'node:test'
import { privateStartupUrl, redactStartupOutput } from '../src/auth.js'

test('official startup input is origin-bound and diagnostics never echo it', () => {
  const secret = 'private-secret'
  const url = `http://127.0.0.1:43127/?token=${secret}`
  assert.equal(privateStartupUrl(() => url, 43127), url)
  assert.equal(privateStartupUrl(undefined, 43127), '')
  assert.equal(privateStartupUrl(() => undefined, 43127), '')
  for (const invalid of [url.replace('43127','3080'), url+'&token=again', url+'#fragment', url.replace('/?', '/other?')]) {
    assert.throws(() => privateStartupUrl(() => invalid, 43127), error => /WEB_AUTH_/.test(error.message) && !error.message.includes(secret))
  }
  assert.throws(() => privateStartupUrl(() => { throw new Error(url) }, 43127), error => !error.message.includes(secret))
  const chunks = [url.slice(0,35),url.slice(35), ' token: '+secret]
  assert.doesNotMatch(redactStartupOutput(chunks.join(''), url), /private-secret/)
})
