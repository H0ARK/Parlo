import type { UIMessage } from '@ai-sdk/react'
import type { LanguageModel } from 'ai'

/**
 * Approximate token count using a character-based heuristic.
 *
 * On average, 1 token ≈ 4 characters for English text across most
 * tokenizers (GPT, Claude, etc.). This is intentionally conservative
 * so the trimmer leaves a safety margin.
 */
const CHARS_PER_TOKEN = 3.5

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function messageToText(message: UIMessage): string {
  const parts: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      parts.push(part.text)
    } else if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
      parts.push(JSON.stringify(part))
    }
  }

  const metadata = message.metadata as
    | { inline_file_contents?: Array<{ name?: string; content?: string }> }
    | undefined
  if (Array.isArray(metadata?.inline_file_contents)) {
    for (const file of metadata.inline_file_contents) {
      if (file?.content) {
        parts.push(`File: ${file.name || 'attachment'}\n${file.content}`)
      }
    }
  }

  return parts.join('\n')
}

export function estimateMessageTokens(message: UIMessage): number {
  const text = messageToText(message)
  // Add a small overhead per message for role/formatting tokens
  return estimateTokens(text) + 4
}

export interface ContextManagerConfig {
  maxContextTokens: number
  maxOutputTokens: number
  autoCompact: boolean
}

export interface TrimResult {
  messages: UIMessage[]
  trimmedCount: number
  compactedSummary?: string
}

/**
 * Trim messages to fit within the context budget.
 *
 * Strategy:
 * 1. Always keep the system prompt (counted separately) and the most recent message
 * 2. Walk backwards from the newest message, accumulating tokens
 * 3. Drop the oldest messages that don't fit
 * 4. Never drop the first user message if it would leave no context
 */
export function trimMessages(
  messages: UIMessage[],
  config: ContextManagerConfig,
  systemPromptTokens: number = 0
): TrimResult {
  const { maxContextTokens, maxOutputTokens } = config

  if (maxContextTokens <= 0) {
    return { messages, trimmedCount: 0 }
  }

  const inputBudget = maxContextTokens - maxOutputTokens - systemPromptTokens
  if (inputBudget <= 0) {
    return { messages: messages.slice(-1), trimmedCount: messages.length - 1 }
  }

  // Estimate tokens for each message
  const estimates = messages.map((msg) => ({
    message: msg,
    tokens: estimateMessageTokens(msg),
  }))

  // Walk backwards, accumulating tokens
  let totalTokens = 0
  const kept: UIMessage[] = []

  for (let i = estimates.length - 1; i >= 0; i--) {
    const { message, tokens } = estimates[i]
    if (totalTokens + tokens > inputBudget && kept.length > 0) {
      break
    }
    totalTokens += tokens
    kept.unshift(message)
  }

  // Ensure we always have at least the last message
  if (kept.length === 0 && messages.length > 0) {
    kept.push(messages[messages.length - 1])
  }

  return {
    messages: kept,
    trimmedCount: messages.length - kept.length,
  }
}

/**
 * Compact by deterministic trimming. LLM summarization is intentionally not
 * used here; Codex app-server owns the only agent/model execution path.
 */
export async function compactMessages(
  messages: UIMessage[],
  config: ContextManagerConfig,
  model: LanguageModel,
  systemPromptTokens: number = 0
): Promise<TrimResult> {
  const { maxContextTokens, maxOutputTokens } = config

  if (maxContextTokens <= 0) {
    return { messages, trimmedCount: 0 }
  }

  const inputBudget = maxContextTokens - maxOutputTokens - systemPromptTokens
  if (inputBudget <= 0) {
    return { messages: messages.slice(-1), trimmedCount: messages.length - 1 }
  }

  // First figure out which messages would be kept/dropped
  const trimResult = trimMessages(messages, config, systemPromptTokens)

  if (trimResult.trimmedCount === 0) {
    return trimResult
  }

  void model
  return trimResult
}
