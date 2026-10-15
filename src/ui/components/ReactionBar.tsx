import { useState } from 'react'
import { REACTION_EMOJIS } from '../../rules'
import type { ReactionSummary } from '../useChat'

interface Props {
  messageId: string
  summaries: ReactionSummary[]
  mine: boolean
  onReact: (messageId: string, emoji: string) => void
}

/** 訊息下方的表情回應：已有的表情（點一下按或收回）加一個「＋」展開選單。 */
export function ReactionBar({ messageId, summaries, mine, onReact }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className={`reactions${mine ? ' reactions--mine' : ''}`}>
      {summaries.map((s) => (
        <button
          key={s.emoji}
          type="button"
          className={`reaction-chip${s.mine ? ' is-mine' : ''}`}
          aria-pressed={s.mine}
          aria-label={`${s.emoji} ${s.count} 人${s.mine ? '（你按過，點一下收回）' : ''}`}
          onClick={() => onReact(messageId, s.emoji)}
        >
          <span aria-hidden="true">{s.emoji}</span>
          <span className="reaction-chip__count">{s.count}</span>
        </button>
      ))}
      <button
        type="button"
        className="reaction-add"
        aria-expanded={open}
        aria-label="新增表情回應"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '×' : '＋'}
      </button>
      {open && (
        <div className="reaction-picker" role="group" aria-label="選一個表情">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="reaction-picker__item"
              aria-label={`回應 ${emoji}`}
              onClick={() => {
                onReact(messageId, emoji)
                setOpen(false)
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
