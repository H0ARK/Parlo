import { useEffect, useMemo, useState } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCodexUserInput } from '@/stores/codex-user-input-store'

export default function CodexUserInputDialog() {
  const pending = useCodexUserInput((state) => state.pending)
  const submitUserInput = useCodexUserInput((state) => state.submitUserInput)
  const cancelUserInput = useCodexUserInput((state) => state.cancelUserInput)

  const initialAnswers = useMemo(() => {
    if (!pending) return {}
    return Object.fromEntries(
      pending.questions.map((question) => [
        question.id,
        question.options?.[0]?.value ?? '',
      ])
    )
  }, [pending])

  const [answers, setAnswers] =
    useState<Record<string, string>>(initialAnswers)

  useEffect(() => {
    setAnswers(initialAnswers)
  }, [initialAnswers])

  if (!pending) return null

  const updateAnswer = (id: string, value: string) => {
    setAnswers((current) => ({ ...current, [id]: value }))
  }

  return (
    <Dialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) cancelUserInput()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <DialogTitle>Codex needs your input</DialogTitle>
              <DialogDescription className="mt-1 text-muted-foreground">
                Answer the questions below so the agent can continue.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {pending.questions.map((question) => (
            <div key={question.id} className="space-y-2">
              <Label htmlFor={`codex-input-${question.id}`}>
                {question.label}
              </Label>
              {question.description ? (
                <p className="text-xs text-muted-foreground">
                  {question.description}
                </p>
              ) : null}
              {question.options && question.options.length > 0 ? (
                <select
                  id={`codex-input-${question.id}`}
                  value={answers[question.id] ?? ''}
                  onChange={(event) =>
                    updateAnswer(question.id, event.target.value)
                  }
                  className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:ring-ring flex h-9 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {question.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`codex-input-${question.id}`}
                  value={answers[question.id] ?? ''}
                  onChange={(event) =>
                    updateAnswer(question.id, event.target.value)
                  }
                  autoFocus={pending.questions[0]?.id === question.id}
                />
              )}
            </div>
          ))}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => cancelUserInput()}>
            Skip
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => submitUserInput(answers)}
          >
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}