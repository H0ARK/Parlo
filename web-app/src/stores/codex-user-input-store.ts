import { create } from 'zustand'

export type CodexUserInputQuestion = {
  id: string
  label: string
  description?: string
  options?: Array<{ label: string; value: string }>
}

type PendingCodexUserInput = {
  questions: CodexUserInputQuestion[]
  resolve: (answers: Record<string, string>) => void
}

type CodexUserInputState = {
  pending: PendingCodexUserInput | null
  requestUserInput: (
    questions: CodexUserInputQuestion[]
  ) => Promise<Record<string, string>>
  submitUserInput: (answers: Record<string, string>) => void
  cancelUserInput: () => void
}

export const useCodexUserInput = create<CodexUserInputState>()((set, get) => ({
  pending: null,

  requestUserInput: (questions) => {
    if (questions.length === 0) {
      return Promise.resolve({})
    }

    return new Promise<Record<string, string>>((resolve) => {
      get().pending?.resolve({})
      set({
        pending: {
          questions,
          resolve,
        },
      })
    })
  },

  submitUserInput: (answers) => {
    const pending = get().pending
    if (!pending) return
    set({ pending: null })
    pending.resolve(answers)
  },

  cancelUserInput: () => {
    const pending = get().pending
    if (!pending) return
    set({ pending: null })
    pending.resolve({})
  },
}))