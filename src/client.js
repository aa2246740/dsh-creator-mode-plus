window.__ModuleLoader__.load({
  id: 'dsh-creator-mode-plus',
  factory: () => {
    const name = 'dsh-creator-mode-plus-client'
    const inject = ['loader']
    const endpoint = '/dsh-creator-mode-plus/client-failure'
    const fuseKey = 'dsh-creator-mode-plus:last-client-failure'

    function failedEntries(ctx) {
      const ids = []
      for (const entry of ctx.loader.entries()) {
        const state = entry.fiber?.state
        if (state !== 2) ids.push(entry.options.name)
      }
      return [...new Set(ids)].sort()
    }

    function bootFailureText() {
      const boot = document.querySelector('[data-dsh-boot]')
      const text = boot?.textContent || ''
      return text.includes('Failed to load plugins') ? text.slice(0, 8000) : undefined
    }

    function apply(ctx) {
      let disposed = false
      let reporting = false
      let timer
      let retryCount = 0
      let sawBootPage = Boolean(document.querySelector('[data-dsh-boot]'))

      const clearFuseWhenMounted = () => {
        if (document.querySelector('[data-dsh-boot]')) {
          sawBootPage = true
        } else if (sawBootPage) {
          sessionStorage.removeItem(fuseKey)
          sawBootPage = false
          retryCount = 0
        }
      }

      const report = async (message, exactId) => {
        if (disposed || reporting) return
        const failedIds = exactId ? [exactId] : failedEntries(ctx)
        if (failedIds.length === 0) return
        const signature = JSON.stringify(failedIds)
        if (sessionStorage.getItem(fuseKey) === signature) return
        reporting = true
        sessionStorage.setItem(fuseKey, signature)
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ failedIds, message: String(message || '').slice(0, 8000) }),
          })
          const result = await response.json()
          if (response.ok && result.reload === true && !disposed) {
            location.reload()
            return
          }
          if (!disposed && retryCount < 1) {
            retryCount += 1
            setTimeout(() => {
              sessionStorage.removeItem(fuseKey)
              void report(message, exactId)
            }, 2_000)
          }
        } catch (error) {
          console.warn('Creator Mode+ could not report the client-loader failure', error)
          if (!disposed && retryCount < 1) {
            retryCount += 1
            setTimeout(() => {
              sessionStorage.removeItem(fuseKey)
              void report(message, exactId)
            }, 2_000)
          }
        } finally {
          reporting = false
        }
      }

      const scan = () => {
        clearFuseWhenMounted()
        const message = bootFailureText()
        if (message) void report(message)
      }
      const scheduleScan = () => {
        clearTimeout(timer)
        timer = setTimeout(scan, 250)
      }

      ctx.on('internal/status', (fiber) => {
        const id = fiber.entry?.options?.name
        if (fiber.state === 3 && typeof id === 'string') {
          void report(`client loader entry ${id} entered FAILED`, id)
        } else {
          scheduleScan()
        }
      })

      const observer = new MutationObserver(scheduleScan)
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
      scheduleScan()
      ctx.effect(() => () => {
        disposed = true
        clearTimeout(timer)
        observer.disconnect()
      }, 'Creator Mode+ browser failure sentry')
    }

    return { name, inject, apply }
  },
})
