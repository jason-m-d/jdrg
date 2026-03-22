/**
 * Langfuse observability client for Crosby.
 *
 * Production only — in dev, all exports are no-ops so local traces never
 * pollute the production Langfuse project.
 */

import type OpenAI from 'openai'
import { Langfuse, observeOpenAI } from 'langfuse'

const isProd = process.env.NODE_ENV === 'production'

// ---- Singleton client -------------------------------------------------------

let _client: Langfuse | null = null

export function getLangfuse(): Langfuse {
  if (!isProd) return createNoOpClient() as unknown as Langfuse
  if (_client) return _client

  _client = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_HOST,
  })
  return _client
}

/** Must be called before a serverless function returns to flush buffered events. */
export async function flushLangfuse(): Promise<void> {
  if (!isProd || !_client) return
  await _client.flushAsync()
}

// ---- observeOpenAI wrapper --------------------------------------------------

/**
 * Wraps an OpenAI-compatible client (openrouterClient) so every call is
 * automatically traced in Langfuse. In dev the original client is returned
 * unchanged.
 */
export function wrapOpenRouterClient<T extends OpenAI>(client: T): T {
  if (!isProd) return client
  return observeOpenAI(client as any) as unknown as T
}

// ---- No-op stubs for dev ----------------------------------------------------

function createNoOpClient(): Record<string, unknown> {
  const noop = (): typeof noOpObj => noOpObj
  const noOpObj: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'then') return undefined // not a Promise
        if (prop === 'id') return 'dev-noop'
        return typeof prop === 'string' ? noop : undefined
      },
    }
  )
  return noOpObj
}
