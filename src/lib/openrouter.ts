/**
 * OpenAI-compatible client for OpenRouter background job calls.
 *
 * The Anthropic SDK sends an `anthropic-version` header that causes OpenRouter
 * to route ALL requests (including Google model IDs) to Anthropic providers,
 * which fails with 404 for non-Anthropic models. The OpenAI SDK does not send
 * that header, so OpenRouter routes freely to the correct provider.
 *
 * Use this client for any background call using Google/non-Anthropic models.
 * Use the standard Anthropic client for Claude models.
 */
import OpenAI from 'openai'

export const openrouterClient = new OpenAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
})
