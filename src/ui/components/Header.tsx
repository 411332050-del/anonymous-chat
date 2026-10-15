import { useState } from 'react'
import type { ConnectionStatus, Me, PresenceMember } from '../../chat/types'
import { SpinnerIcon } from './Icons'

interface Props {
  me: Me
  onlineCount: number
  members: PresenceMember[]
  notice: string | null
  connection: ConnectionStatus
}

export function Header({ me, onlineCount, members, notice, connection }: Props) {
  const [open, setOpen] = useState(false)
  // 自己排最前面，其餘依名稱排序
  const sorted = [...members].sort((a, b) =>
    a.authorId === me.authorId ? -1 : b.authorId === me.authorId ? 1 : a.nickname.localeCompare(b.nickname, 'zh-Hant'),
  )

  return (
    <>
      <header className="header">
        <h1 className="header__title">匿名聊天室</h1>
        <button
          type="button"
          className="header__online"
          aria-expanded={open}
          aria-controls="online-list"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="dot" aria-hidden="true" />
          <span>目前 {onlineCount} 人在線</span>
          <span aria-hidden="true" className="header__caret">{open ? '▲' : '▼'}</span>
        </button>
        <div className="header__me">
          你是：<span className="header__nickname">{me.nickname}</span>
        </div>
        {open && (
          <ul id="online-list" className="online-list" aria-label="在線名單">
            {sorted.map((m) => (
              <li key={m.authorId}>
                {m.nickname}
                {m.authorId === me.authorId && <span className="online-list__you">（你）</span>}
              </li>
            ))}
          </ul>
        )}
      </header>
      {connection === 'reconnecting' && (
        <div className="banner" role="status">
          <SpinnerIcon size={14} />
          重新連線中…
        </div>
      )}
      <div className="presence-notice" role="status" aria-live="polite">
        {notice}
      </div>
    </>
  )
}
