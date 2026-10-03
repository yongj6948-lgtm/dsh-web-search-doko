/**
 * Minimal MCP-over-HTTP client for keyless vendor endpoints. `mcp.exa.ai` and
 * `search.parallel.ai` expose a `tools/call` JSON-RPC method over streamable
 * HTTP, answering either a plain JSON envelope or an SSE `data:` frame. No
 * handshake is required for a single tool call.
 * @module dsh-web-search-doko/keyless/mcp
 */

import { isAbortError, isRateLimitish, KeylessError } from './errors.js'

/** Options for one `tools/call`. */
export interface McpCallOptions {
  /** Vendor id used in error messages. */
  readonly vendor: string
  /** Wall-clock timeout in milliseconds. */
  readonly timeoutMs: number
  /** Caller cancellation, merged with the timeout. */
  readonly signal?: AbortSignal
}

/**
 * POST one MCP `tools/call` and return the first text content item.
 *
 * @param url - MCP endpoint URL.
 * @param tool - tool name to call.
 * @param args - tool arguments.
 * @param options - vendor id, timeout, and caller signal.
 * @returns the tool's text payload.
 * @throws {KeylessError} on transport, HTTP, JSON-RPC, or tool error.
 */
export async function mcpCall(
  url: string,
  tool: string,
  args: Record<string, unknown>,
  options: McpCallOptions,
): Promise<string> {
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal !== undefined ? AbortSignal.any([options.signal, timeout]) : timeout
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'user-agent': 'dsh-web-search-doko',
      },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    if (isAbortError(error)) {
      if (options.signal?.aborted === true) {
        throw new KeylessError(options.vendor, 'request aborted', false, error)
      }
      throw new KeylessError(options.vendor, `timed out after ${options.timeoutMs}ms`, false, error)
    }
    throw new KeylessError(options.vendor, `request failed: ${String(error)}`, false, error)
  }

  const body = await response.text()
  if (!response.ok) {
    const rateLimited = response.status === 429 || isRateLimitish(body)
    throw new KeylessError(options.vendor, `HTTP ${response.status}: ${body.slice(0, 300)}`, rateLimited)
  }
  return parseMcpBody(options.vendor, body)
}

/**
 * Extract the first non-empty `text` content item from an MCP response body,
 * accepting either a bare JSON envelope or SSE `data:` frames. Surfaces JSON-RPC
 * errors and `isError` tool results as {@link KeylessError}.
 *
 * @param vendor - vendor id for error messages.
 * @param body - raw response body.
 * @returns the text payload.
 */
export function parseMcpBody(vendor: string, body: string): string {
  const stripped = body.trim()
  const candidates: string[] = stripped.startsWith('{') ? [stripped] : []
  for (const line of body.split(/\r\n|\r|\n/)) {
    if (line.startsWith('data: ')) candidates.push(line.slice('data: '.length))
  }

  let sawEnvelope = false
  for (const candidate of candidates) {
    let envelope: unknown
    try {
      envelope = JSON.parse(candidate)
    } catch {
      continue
    }
    if (typeof envelope !== 'object' || envelope === null) continue
    const record = envelope as Record<string, unknown>
    const jsonRpcError = record['error']
    if (typeof jsonRpcError === 'object' && jsonRpcError !== null) {
      const message = (jsonRpcError as Record<string, unknown>)['message']
      throw new KeylessError(vendor, typeof message === 'string' ? message : 'MCP JSON-RPC error')
    }
    const result = record['result']
    if (typeof result !== 'object' || result === null) continue
    const resultRecord = result as Record<string, unknown>
    const rawContent = resultRecord['content']
    const texts = Array.isArray(rawContent)
      ? rawContent.flatMap((item) => {
        const text = typeof item === 'object' && item !== null ? (item as Record<string, unknown>)['text'] : undefined
        return typeof text === 'string' ? [text] : []
      })
      : []
    if (resultRecord['isError'] === true) {
      const message = texts.find((text) => text.length > 0) ?? 'MCP tool call failed'
      throw new KeylessError(vendor, message, isRateLimitish(message))
    }
    const text = texts.find((value) => value.length > 0)
    if (text !== undefined) return text
    sawEnvelope = true
  }

  throw new KeylessError(vendor, sawEnvelope ? 'MCP response contained no text content' : 'unrecognized MCP response shape')
}