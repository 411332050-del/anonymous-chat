import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactionSummary, ViewMessage } from '../useChat'
import { ArrowDownIcon, ChatIcon, SpinnerIcon } from './Icons'
import { MessageItem } from './MessageItem'

interface Props {
  messages: ViewMessage[]
  meId: string
  reachedEnd: boolean
  loadingOlder: boolean
  olderError: boolean
  onLoadOlder: () => void
  onRetry: (id: string) => void
  reactions: Map<string, ReactionSummary[]>
  onReact: (messageId: string, emoji: string) => void
}

const BOTTOM_SLOP = 80
const TOP_TRIGGER = 40

export function MessageList({ messages, meId, reachedEnd, loadingOlder, olderError, onLoadOlder, onRetry, reactions, onReact }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const prev = useRef<{ firstId?: string; lastId?: string; count: number; height: number }>({ count: 0, height: 0 })
  const [unread, setUnread] = useState(0)

  const scrollToBottom = useCallback(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
    atBottom.current = true
    setUnread(0)
  }, [])

  // 訊息變動後決定要不要捲動：
  //  - 前面多了舊訊息：維持使用者原本看的位置
  //  - 後面多了新訊息：在底部或是自己發的就捲到底，否則顯示「有 N 則新訊息」
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const before = prev.current
    const firstId = messages[0]?.id
    const lastMessage = messages[messages.length - 1]

    if (before.count === 0) {
      scrollToBottom()
    } else if (firstId !== before.firstId && lastMessage?.id === before.lastId) {
      el.scrollTop += el.scrollHeight - before.height
    } else if (lastMessage && lastMessage.id !== before.lastId) {
      const added = messages.length - before.count
      if (atBottom.current || lastMessage.authorId === meId) {
        scrollToBottom()
      } else {
        setUnread((n) => n + Math.max(added, 1))
      }
    }
    prev.current = { firstId, lastId: lastMessage?.id, count: messages.length, height: el.scrollHeight }
  }, [messages, meId, scrollToBottom])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLOP
    if (atBottom.current) setUnread(0)
    // 失敗後不再自動重試，等使用者按「重試」，避免一直捲動就一直打 API
    if (el.scrollTop < TOP_TRIGGER && !olderError) onLoadOlder()
  }

  return (
    <div className="list-wrap">
      <div className="list" ref={scroller} onScroll={onScroll}>
        {messages.length === 0 ? (
          <div className="empty">
            <ChatIcon />
            <p>還沒有人說話，來打個招呼吧</p>
          </div>
        ) : (
          <div className="list__inner">
            {loadingOlder && (
              <div className="list__note">
                <SpinnerIcon size={14} />
                載入更早的訊息…
              </div>
            )}
            {olderError && !loadingOlder && (
              <div className="list__note list__note--error" role="status">
                <span>載入更早的訊息失敗</span>
                <button type="button" className="retry" onClick={onLoadOlder}>
                  重試
                </button>
              </div>
            )}
            {reachedEnd && !loadingOlder && <div className="list__note">— 已經是最早的訊息 —</div>}
            {messages.map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                mine={m.authorId === meId}
                onRetry={onRetry}
                reactions={reactions.get(m.id) ?? []}
                onReact={onReact}
              />
            ))}
          </div>
        )}
      </div>
      {unread > 0 && (
        <button type="button" className="new-pill" onClick={scrollToBottom}>
          <ArrowDownIcon />
          有 {unread} 則新訊息
        </button>
      )}
    </div>
  )
}
