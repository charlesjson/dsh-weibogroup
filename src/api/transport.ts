/** Keep credentials on the configured origin, reject login redirects, and forward cancellation. */
export function authenticatedFetch(baseUrl: URL, signal: AbortSignal, fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    signal.throwIfAborted()
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== baseUrl.origin) throw new Error('Cross-origin API request blocked')
    const response = await fetchImpl(input, {
      ...init,
      redirect: 'manual',
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      return Response.json({ code: 'LAZYCAT_LOGIN_REQUIRED', error: 'API 仍被懒猫入口认证拦截，请检查 public_path。' }, { status: 502 })
    }
    return response
  }
}
