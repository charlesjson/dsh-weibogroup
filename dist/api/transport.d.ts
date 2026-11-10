/** Keep credentials on the configured origin, reject login redirects, and forward cancellation. */
export declare function authenticatedFetch(baseUrl: URL, signal: AbortSignal, fetchImpl?: typeof fetch): typeof fetch;
