/**
 * Assistants Service Types
 */

import { Assistant } from '@parlo-lab/core'

export interface AssistantsService {
  getAssistants(): Promise<Assistant[] | null>
  createAssistant(assistant: Assistant): Promise<void>
  deleteAssistant(assistant: Assistant): Promise<void>
}
