import type { ReactionSummary, ViewMessage } from '../useChat'
import { ReactionBar } from './ReactionBar'

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
}

interface Props {
  message: ViewMessage
  mine: boolean
  onRetry: (id: string) => void
  reactions: ReactionSummary[]
  onReact: (messageId: string, emoji: string) => void
}

export function MessageItem({ message, mine, onRetry, reactions, onReact }: Props) {
  const time = formatTime(message.createdAt)

  if (!mine) {
    return (
      <div className="msg msg--other">
        <div className="msg__meta">
          {message.nickname} · {time}
        </div>
        <div className="bubble bubble--other">{message.content}</div>
        <ReactionBar messageId={message.id} summaries={reactions} mine={false} onReact={onReact} />
      </div>
    )
  }

  const state = message.state ?? 'sent'
  return (
    <div className="msg msg--mine">
      <div className={`bubble bubble--mine${state === 'sending' ? ' is-sending' : ''}${state === 'failed' ? ' is-failed' : ''}`}>
        {message.content}
      </div>
      <div className={`msg__meta msg__meta--mine${state === 'failed' ? ' is-failed' : ''}`}>
        {state === 'sent' && `${time} · 已送出`}
        {state === 'sending' && '傳送中…'}
        {state === 'failed' && (
          <>
            <span>傳送失敗</span>
            <button type="button" className="retry" onClick={() => onRetry(message.id)}>
              重試
            </button>
          </>
        )}
      </div>
      {state === 'sent' && <ReactionBar messageId={message.id} summaries={reactions} mine onReact={onReact} />}
    </div>
  )
}
