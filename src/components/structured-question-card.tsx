'use client'

import { useState } from 'react'
import { Check, Pencil, Send } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Question {
  number: number
  text: string
  options?: string[]
  multi_select?: boolean
}

interface StructuredQuestionCardProps {
  event: { questions: Question[] }
  onSendMessage: (text: string) => void
}

export function StructuredQuestionCard({ event, onSendMessage }: StructuredQuestionCardProps) {
  const { questions } = event
  const [answers, setAnswers] = useState<Record<number, string[]>>({})
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({})
  const [showOther, setShowOther] = useState<Record<number, boolean>>({})
  const [sent, setSent] = useState(false)
  const [focusQuestion, setFocusQuestion] = useState<number | null>(null)

  const allAnswered = questions.every(q => {
    const a = answers[q.number]
    return a && a.length > 0
  })

  function toggleOption(qNumber: number, option: string, multiSelect: boolean) {
    if (sent) return
    setAnswers(prev => {
      const current = prev[qNumber] || []
      if (multiSelect) {
        return {
          ...prev,
          [qNumber]: current.includes(option)
            ? current.filter(o => o !== option)
            : [...current.filter(o => o !== '__other__'), option],
        }
      }
      return { ...prev, [qNumber]: [option] }
    })
    // Clear "other" if selecting a real option
    if (option !== '__other__') {
      setShowOther(prev => ({ ...prev, [qNumber]: false }))
    }
  }

  function handleOther(qNumber: number) {
    if (sent) return
    setShowOther(prev => ({ ...prev, [qNumber]: true }))
  }

  function commitOther(qNumber: number) {
    const text = (otherInputs[qNumber] || '').trim()
    if (!text) return
    setAnswers(prev => {
      const current = (prev[qNumber] || []).filter(o => o !== '__other__')
      return { ...prev, [qNumber]: [...current, text] }
    })
    setShowOther(prev => ({ ...prev, [qNumber]: false }))
    setOtherInputs(prev => ({ ...prev, [qNumber]: '' }))
  }

  function formatAnswers(): string {
    return questions
      .map(q => {
        const a = answers[q.number] || []
        return a.join(', ')
      })
      .join('\n')
  }

  function handleSend() {
    if (!allAnswered || sent) return
    setSent(true)
    onSendMessage(formatAnswers())
  }

  function handleEdit() {
    if (!allAnswered || sent) return
    setSent(true)
    // For edit, we call with a special prefix that the parent can detect
    // Actually, we need a way to just populate without sending.
    // We'll use a convention: prefix with __EDIT__ which the parent strips and puts in input
    onSendMessage('__EDIT__' + formatAnswers())
  }

  function handleAnswerClick(qNumber: number) {
    if (sent) return
    setFocusQuestion(qNumber)
  }

  // Summary line
  const answeredQuestions = questions.filter(q => (answers[q.number] || []).length > 0)

  return (
    <div className="border border-border px-4 py-3 space-y-3">
      {questions.map(q => {
        const selected = answers[q.number] || []
        const isFocused = focusQuestion === null || focusQuestion === q.number

        return (
          <div
            key={q.number}
            className={cn(
              'transition-opacity',
              !isFocused && focusQuestion !== null && 'opacity-40'
            )}
          >
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-[0.6875rem] tabular-nums text-muted-foreground/50 font-medium shrink-0">
                {q.number}.
              </span>
              <span className="text-[0.8125rem] text-foreground/90">{q.text}</span>
            </div>

            {q.options && (
              <div className="flex flex-wrap gap-1.5 pl-5">
                {q.options.map(opt => {
                  const isSelected = selected.includes(opt)
                  return (
                    <button
                      key={opt}
                      onClick={() => toggleOption(q.number, opt, !!q.multi_select)}
                      disabled={sent}
                      className={cn(
                        'px-2.5 py-1 text-[0.75rem] border transition-all',
                        sent
                          ? isSelected
                            ? 'border-foreground/20 bg-foreground/5 text-foreground/70'
                            : 'border-border/50 text-muted-foreground/30'
                          : isSelected
                            ? 'border-foreground/30 bg-foreground/10 text-foreground'
                            : 'border-border text-muted-foreground/70 hover:border-foreground/20 hover:text-foreground/80'
                      )}
                    >
                      {isSelected && <Check className="size-3 inline mr-1 -mt-px" />}
                      {opt}
                    </button>
                  )
                })}

                {/* Other option */}
                {!sent && !showOther[q.number] && (
                  <button
                    onClick={() => handleOther(q.number)}
                    className="px-2.5 py-1 text-[0.75rem] border border-dashed border-border text-muted-foreground/50 hover:border-foreground/20 hover:text-muted-foreground transition-all"
                  >
                    Other...
                  </button>
                )}

                {showOther[q.number] && (
                  <div className="flex items-center gap-1">
                    <input
                      value={otherInputs[q.number] || ''}
                      onChange={e => setOtherInputs(prev => ({ ...prev, [q.number]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitOther(q.number)
                        if (e.key === 'Escape') setShowOther(prev => ({ ...prev, [q.number]: false }))
                      }}
                      placeholder="Type your answer"
                      className="bg-transparent border border-border px-2 py-1 text-[0.75rem] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors w-40"
                      autoFocus
                    />
                    <button
                      onClick={() => commitOther(q.number)}
                      className="p-1 text-muted-foreground/50 hover:text-foreground transition-colors"
                    >
                      <Check className="size-3" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* No options — free text input */}
            {!q.options && !sent && (
              <div className="pl-5">
                <input
                  value={(answers[q.number] || [])[0] || ''}
                  onChange={e => setAnswers(prev => ({ ...prev, [q.number]: e.target.value ? [e.target.value] : [] }))}
                  placeholder="Type your answer"
                  className="bg-transparent border border-border px-2.5 py-1.5 text-[0.75rem] outline-none placeholder:text-muted-foreground/30 focus:border-foreground/30 transition-colors w-full max-w-xs"
                />
              </div>
            )}
            {!q.options && sent && selected.length > 0 && (
              <div className="pl-5 text-[0.75rem] text-foreground/70">{selected[0]}</div>
            )}
          </div>
        )
      })}

      {/* Answer summary */}
      {answeredQuestions.length > 0 && !sent && (
        <div className="border-t border-border/50 pt-2.5 pl-1">
          <div className="text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground/40 mb-1.5">Your answers</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {questions.map(q => {
              const a = answers[q.number] || []
              if (a.length === 0) return null
              return (
                <button
                  key={q.number}
                  onClick={() => handleAnswerClick(q.number)}
                  className="text-[0.75rem] text-foreground/70 hover:text-foreground transition-colors"
                >
                  <span className="text-muted-foreground/50 tabular-nums">{q.number}.</span>{' '}
                  {a.join(', ')}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      {!sent && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSend}
            disabled={!allAnswered}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] border transition-all',
              allAnswered
                ? 'border-foreground/20 text-foreground hover:bg-foreground/5'
                : 'border-border text-muted-foreground/30 cursor-not-allowed'
            )}
          >
            <Send className="size-3" />
            Send
          </button>
          <button
            onClick={handleEdit}
            disabled={!allAnswered}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-[0.75rem] border transition-all',
              allAnswered
                ? 'border-border text-muted-foreground/70 hover:text-foreground hover:border-foreground/20'
                : 'border-border text-muted-foreground/30 cursor-not-allowed'
            )}
          >
            <Pencil className="size-3" />
            Edit first
          </button>
        </div>
      )}

      {/* Sent confirmation */}
      {sent && (
        <div className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground/40 pt-1">
          <Check className="size-3" />
          Answers sent
        </div>
      )}
    </div>
  )
}
