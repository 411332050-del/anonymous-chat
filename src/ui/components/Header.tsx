import type { ConnectionStatus, Me } from '../../chat/types'
import { SpinnerIcon } from './Icons'

interface Props {
  me: Me
  onlineCount: number
  connection: ConnectionStatus
}

export function Header({ me, onlineCount, connection }: Props) {
  return (
    <>
      <header className="header">
        <h1 className="header__title">匿名聊天室</h1>
        <div className="header__online">
          <span className="dot" aria-hidden="true" />
          <span>目前 {onlineCount} 人在線</span>
        </div>
        <div className="header__me">
          你是：<span className="header__nickname">{me.nickname}</span>
        </div>
      </header>
      {connection === 'reconnecting' && (
        <div className="banner" role="status">
          <SpinnerIcon size={14} />
          重新連線中…
        </div>
      )}
    </>
  )
}
