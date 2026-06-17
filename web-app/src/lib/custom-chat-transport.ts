import type { UIMessage } from '@ai-sdk/react'
import {
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModelUsage,
  type UIMessageChunk,
} from 'ai'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  sendCodexAppServerChatMessage,
  shutdownCodexAppServerChatSession,
} from '@/lib/codex-app-server'

export type TokenUsageCallback = (
  usage: LanguageModelUsage,
  messageId: string
) => void

/**
 * The chat transport has one runtime path:
 *
 * UI -> Codex app-server -> selected model endpoint -> Codex event stream -> UI.
 *
 * Parlo owns provider/model selection and rendering. Codex owns the agent loop,
 * tools, approvals, files, shell, and stream semantics.
 */
export class CustomChatTransport implements ChatTransport<UIMessage> {
  private threadId?: string

  constructor(systemMessage?: string, threadId?: string) {
    void systemMessage
    this.threadId = threadId
  }

  async shutdown(): Promise<void> {
    if (this.threadId) {
      await shutdownCodexAppServerChatSession(this.threadId)
    }
  }

  updateSystemMessage(systemMessage: string | undefined) {
    void systemMessage
  }

  setOnTokenUsage(callback: TokenUsageCallback | undefined) {
    void callback
  }

  async updateRagToolsAvailability(
    hasDocuments: boolean,
    modelSupportsTools: boolean,
    ragFeatureAvailable: boolean
  ) {
    void hasDocuments
    void modelSupportsTools
    void ragFeatureAvailable
  }

  async refreshTools() {
    return
  }

  setContinueFromContent(content: string) {
    void content
  }

  async sendMessages(
    options: {
      chatId: string
      messages: UIMessage[]
      abortSignal: AbortSignal | undefined
    } & {
      trigger: 'submit-message' | 'regenerate-message'
      messageId: string | undefined
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    const threadId = this.threadId ?? options.chatId
    useAppState.getState().setCurrentStreamThreadId(threadId)

    const providerId = useModelProvider.getState().selectedProvider
    const provider = useModelProvider.getState().getProviderByName(providerId)
    const selectedModel = useModelProvider.getState().selectedModel

    if (!providerId || !provider || !selectedModel) {
      throw new Error('A selected model/provider is required to start Codex.')
    }

    return sendCodexAppServerChatMessage({
      threadId,
      messageId: options.messageId,
      messages: options.messages,
      provider,
      model: selectedModel,
      abortSignal: options.abortSignal,
    })
  }

  async reconnectToStream(
    options: { chatId: string } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    void options
    return null
  }
}
