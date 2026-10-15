import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatService } from '../chat/ChatService'
import type { ConnectionStatus, ErrorCode, Me, Message, PresenceMember, Reaction } from '../chat/types'
import { REACTION_EMOJIS, RateLimiter, TYPING_EXPIRE_MS, sanitize, validateContent } from '../rules'

export type Phase = 'entry' | 'entering' | 'lobby' | 'failed'
export type SendState = 'sending' | 'sent' | 'failed'

export interface ViewMessage extends Message {
  /** 只有自己的訊息會有送出狀態 */
  state?: SendState
}

export type Hint = 'rate-limited' | 'offline' | 'unknown' | null

/** 一則訊息上的一種表情：幾個人按、我有沒有按 */
export interface ReactionSummary {
  emoji: string
  count: number
  mine: boolean
}

const reactionKey = (r: Reaction) => `${r.messageId}|${r.authorId}|${r.emoji}`

const HINT_MS = 4000
const NOTICE_MS = 6000
const NOTICE_MAX = 3

function byTime(a: ViewMessage, b: ViewMessage): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1
}

function hintFor(code: ErrorCode): Hint {
  if (code === 'RATE_LIMITED') return 'rate-limited'
  if (code === 'OFFLINE') return 'offline'
  if (code === 'UNKNOWN') return 'unknown'
  return null
}

/** 把聊天服務的事件整理成畫面要用的狀態。畫面層只透過這裡碰聊天服務。 */
export function useChat(service: ChatService) {
  const [phase, setPhase] = useState<Phase>('entry')
  const [me, setMe] = useState<Me | null>(null)
  const [messages, setMessages] = useState<ViewMessage[]>([])
  const [reachedEnd, setReachedEnd] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState(false)
  const [onlineCount, setOnlineCount] = useState(0)
  const [members, setMembers] = useState<PresenceMember[]>([])
  const [reactionMap, setReactionMap] = useState<Map<string, Reaction>>(new Map())
  const [typers, setTypers] = useState<{ authorId: string; nickname: string }[]>([])
  const typingTimers = useRef(new Map<string, number>())
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([])
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')
  const [hint, setHint] = useState<Hint>(null)

  const meRef = useRef<Me | null>(null)
  const aliasRef = useRef('')
  const contents = useRef(new Map<string, string>())
  const rateLimiter = useRef(new RateLimiter())
  const hintTimer = useRef<number>()
  const noticeTimers = useRef(new Set<number>())
  const noticeSeq = useRef(0)
  const loadingRef = useRef(false)
  const messagesRef = useRef<ViewMessage[]>([])
  const reachedEndRef = useRef(false)
  messagesRef.current = messages
  reachedEndRef.current = reachedEnd

  const clearTyper = useCallback((authorId: string) => {
    window.clearTimeout(typingTimers.current.get(authorId))
    typingTimers.current.delete(authorId)
    setTypers((prev) => prev.filter((t) => t.authorId !== authorId))
  }, [])

  const applyReactionChange = useCallback((reaction: Reaction, active: boolean) => {
    setReactionMap((prev) => {
      const next = new Map(prev)
      if (active) next.set(reactionKey(reaction), reaction)
      else next.delete(reactionKey(reaction))
      return next
    })
  }, [])

  const showHint = useCallback((next: Hint) => {
    window.clearTimeout(hintTimer.current)
    setHint(next)
    if (next) hintTimer.current = window.setTimeout(() => setHint(null), HINT_MS)
  }, [])

  const merge = useCallback((incoming: ViewMessage[]) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]))
      for (const m of incoming) {
        const existing = map.get(m.id)
        // 自己的訊息收到伺服器確認後，保留原本的位置並改成已送出
        map.set(m.id, existing ? { ...existing, ...m } : m)
      }
      return Array.from(map.values()).sort(byTime)
    })
  }, [])

  /** 使用者按下「進入聊天室」才會走到這裡；不帶代號時（重試）沿用上一次輸入的代號。 */
  const enter = useCallback(async (alias?: string) => {
    if (alias !== undefined) aliasRef.current = alias
    setPhase('entering')
    try {
      const who = await service.join(aliasRef.current)
      meRef.current = who
      setMe(who)
      setPhase('lobby')
    } catch {
      setPhase('failed')
    }
  }, [service])

  useEffect(() => {
    const offs = [
      service.on('history:loaded', ({ messages: page, reachedEnd: end }) => {
        setMessages(page)
        setReachedEnd(end)
      }),
      service.on('message:new', (m) => {
        clearTyper(m.authorId)
        const mine = m.authorId === meRef.current?.authorId
        merge([mine ? { ...m, state: 'sent' } : m])
      }),
      service.on('presence:count', setOnlineCount),
      service.on('presence:list', setMembers),
      service.on('reactions:loaded', ({ messageIds, reactions }) => {
        const ids = new Set(messageIds)
        setReactionMap((prev) => {
          const next = new Map([...prev].filter(([, r]) => !ids.has(r.messageId)))
          reactions.forEach((r) => next.set(reactionKey(r), r))
          return next
        })
      }),
      service.on('reaction:changed', ({ reaction, active }) => {
        // 自己按的以 toggleReaction 的回傳為準，這裡只處理別人的
        if (reaction.authorId !== meRef.current?.authorId) applyReactionChange(reaction, active)
      }),
      service.on('typing', ({ authorId, nickname }) => {
        window.clearTimeout(typingTimers.current.get(authorId))
        typingTimers.current.set(authorId, window.setTimeout(() => clearTyper(authorId), TYPING_EXPIRE_MS))
        setTypers((prev) => (prev.some((t) => t.authorId === authorId) ? prev : [...prev, { authorId, nickname }]))
      }),
      service.on('presence:notice', ({ kind, nickname }) => {
        // 提示可以疊加（最多同時 3 則），各自 6 秒後消失，避免連續進出時被蓋掉
        const id = ++noticeSeq.current
        const text = `${nickname} ${kind === 'join' ? '進來了' : '離開了'}`
        setNotices((prev) => [...prev, { id, text }].slice(-NOTICE_MAX))
        const timer = window.setTimeout(() => {
          noticeTimers.current.delete(timer)
          setNotices((prev) => prev.filter((n) => n.id !== id))
        }, NOTICE_MS)
        noticeTimers.current.add(timer)
      }),
      service.on('connection:status', (status) => {
        setConnection(status)
        if (status === 'failed') setPhase('failed')
      }),
      service.on('send:error', ({ id, code }) => {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, state: 'failed' } : m)))
        showHint(hintFor(code))
      }),
    ]
    return () => {
      offs.forEach((off) => off())
      service.leave()
      window.clearTimeout(hintTimer.current)
      typingTimers.current.forEach((t) => window.clearTimeout(t))
      typingTimers.current.clear()
      noticeTimers.current.forEach((t) => window.clearTimeout(t))
      noticeTimers.current.clear()
    }
  }, [service, merge, showHint, clearTyper, applyReactionChange])

  /** 傳送；回傳 true 代表已受理（輸入框可以清空）。 */
  const send = useCallback(
    (raw: string): boolean => {
      const who = meRef.current
      if (!who) return false
      if (connection !== 'online') {
        showHint('offline')
        return false
      }
      const content = sanitize(raw)
      if (validateContent(content)) return false
      if (!rateLimiter.current.tryConsume()) {
        showHint('rate-limited')
        return false
      }
      const id = crypto.randomUUID()
      contents.current.set(id, content)
      merge([
        { id, authorId: who.authorId, nickname: who.nickname, content, createdAt: new Date().toISOString(), state: 'sending' },
      ])
      void service.sendMessage(id, content)
      return true
    },
    [connection, merge, service, showHint],
  )

  const retry = useCallback(
    (id: string) => {
      const content = contents.current.get(id)
      if (!content) return
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, state: 'sending' } : m)))
      void service.sendMessage(id, content)
    },
    [service],
  )

  const loadOlder = useCallback(async () => {
    if (loadingRef.current || reachedEndRef.current) return
    const oldest = messagesRef.current[0]
    if (!oldest) return
    loadingRef.current = true
    setLoadingOlder(true)
    setOlderError(false)
    try {
      const page = await service.loadOlder({ createdAt: oldest.createdAt, id: oldest.id })
      merge(page.messages)
      setReachedEnd(page.reachedEnd)
    } catch (error) {
      console.error('[chat] 載入更早的訊息失敗', error)
      setOlderError(true)
    } finally {
      loadingRef.current = false
      setLoadingOlder(false)
    }
  }, [merge, service])

  /** 離開聊天室，回到進入畫面（可以換代號再進入）。 */
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const who = meRef.current
      if (!who) return
      try {
        const active = await service.toggleReaction(messageId, emoji)
        applyReactionChange({ messageId, authorId: who.authorId, emoji }, active)
      } catch (error) {
        const code = error instanceof Error ? error.message : ''
        showHint(code === 'RATE_LIMITED' ? 'rate-limited' : code === 'OFFLINE' ? 'offline' : 'unknown')
      }
    },
    [service, applyReactionChange, showHint],
  )

  /** 每則訊息的表情統計，依固定順序排列 */
  const reactions = useMemo(() => {
    const byMessage = new Map<string, Map<string, { count: number; mine: boolean }>>()
    for (const r of reactionMap.values()) {
      const emojis = byMessage.get(r.messageId) ?? new Map()
      const cur = emojis.get(r.emoji) ?? { count: 0, mine: false }
      emojis.set(r.emoji, { count: cur.count + 1, mine: cur.mine || r.authorId === me?.authorId })
      byMessage.set(r.messageId, emojis)
    }
    const result = new Map<string, ReactionSummary[]>()
    for (const [messageId, emojis] of byMessage) {
      result.set(
        messageId,
        REACTION_EMOJIS.filter((e) => emojis.has(e)).map((e) => ({ emoji: e, ...emojis.get(e)! })),
      )
    }
    return result
  }, [reactionMap, me])

  const notifyTyping = useCallback(() => service.notifyTyping(), [service])

  const backToEntry = useCallback(() => {
    service.leave()
    typingTimers.current.forEach((t) => window.clearTimeout(t))
    typingTimers.current.clear()
    setTypers([])
    setReactionMap(new Map())
    noticeTimers.current.forEach((t) => window.clearTimeout(t))
    noticeTimers.current.clear()
    setNotices([])
    setMembers([])
    setOnlineCount(0)
    setMessages([])
    setMe(null)
    meRef.current = null
    setPhase('entry')
  }, [service])

  return { phase, backToEntry, me, messages, reachedEnd, loadingOlder, olderError, onlineCount, members, notices, typers, notifyTyping, reactions, toggleReaction, connection, hint, send, retry, loadOlder, enter }
}
