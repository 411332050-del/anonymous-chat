import { useRef, useState } from 'react'
import { MAX_LENGTH, charCount, sanitize, validateContent } from '../../rules'
import type { ConnectionStatus } from '../../chat/types'
import type { Hint } from '../useChat'
import { SendIcon } from './Icons'

interface Props {
  connection: ConnectionStatus
  hint: Hint
  onSend: (text: string) => boolean
  /** 輸入框有內容且正在變動時呼叫（服務端自己節流） */
  onTyping: () => void
}

const HINT_TEXT: Record<Exclude<Hint, null>, string> = {
  'rate-limited': '發言太快了，請稍等幾秒',
  offline: '目前離線，連線後可再試',
  unknown: '送出失敗，請重試',
}

// 手機上 Enter 應該換行（送出靠按鈕）；有實體鍵盤的裝置 Enter 才送出。
const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches

export function Composer({ connection, hint, onSend, onTyping }: Props) {
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const offline = connection !== 'online'
  const count = charCount(text)
  const overLimit = count > MAX_LENGTH
  const clean = sanitize(text)
  const canSend = !offline && validateContent(clean) === null

  const submit = () => {
    if (!canSend) return
    if (onSend(text)) {
      setText('')
      area.current?.focus()
    }
  }

  const hintText = offline ? HINT_TEXT.offline : hint ? HINT_TEXT[hint] : null

  return (
    <footer className="composer">
      {hintText && (
        <div className={`composer__hint${offline ? ' is-warn' : ''}`} role="status">
          {hintText}
        </div>
      )}
      <div className="composer__row">
        <div className={`composer__box${overLimit ? ' is-over' : ''}`}>
          <label htmlFor="message-input" className="sr-only">
            輸入訊息
          </label>
          <textarea
            id="message-input"
            ref={area}
            rows={2}
            value={text}
            disabled={offline}
            placeholder={offline ? '連線後才能發言' : '說點什麼…'}
            onChange={(e) => {
              setText(e.target.value)
              if (e.target.value.trim().length > 0) onTyping()
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
              if (isTouchDevice()) return
              e.preventDefault()
              submit()
            }}
          />
          <div className="composer__foot">
            {overLimit ? <span className="over">超過 {MAX_LENGTH} 字，請刪減後再送出</span> : <span />}
            <span className={overLimit ? 'over' : 'count'}>
              {count} / {MAX_LENGTH}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="send"
          disabled={!canSend}
          aria-label={canSend ? '送出訊息' : '送出訊息（目前無法送出）'}
          onClick={submit}
        >
          <SendIcon />
        </button>
      </div>
    </footer>
  )
}
