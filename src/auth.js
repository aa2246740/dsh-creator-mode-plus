/** Validate only the official current-Host launch URL; never surface its value. */
export function privateStartupUrl(getUrl, port) {
  if (getUrl === undefined) return ''
  let value
  try { value = getUrl(port) } catch { throw new Error('WEB_AUTH_HANDOFF_FAILED: official Connection startup handoff failed') }
  if (value === undefined || value === '') return '' // older unauthenticated Web
  try {
    const url = new URL(value)
    if (url.origin !== `http://127.0.0.1:${port}` || url.username || url.password
      || url.pathname !== '/' || url.hash || [...url.searchParams.keys()].some(key => key !== 'token')
      || url.searchParams.getAll('token').length > 1 || (url.searchParams.has('token') && !url.searchParams.get('token'))) throw new Error()
    return url.href
  } catch { throw new Error('WEB_AUTH_ORIGIN_MISMATCH: official handoff must target the current loopback Host') }
}

/** Redact after stream assembly so secrets split across output chunks stay private. */
export function redactStartupOutput(text, startup) {
  if (!startup) return text
  let result = text.split(startup).join('<redacted-startup-url>')
  const token = new URL(startup).searchParams.get('token')
  if (token) {
    result = result.split(token).join('<redacted-token>')
    result = result.split(encodeURIComponent(token)).join('<redacted-token>')
  }
  return result
}
