import type { ConnectionStatus, Me, PresenceMember } from '../../chat/types'
import { Composer } from '../components/Composer'
import { Header } from '../components/Header'
import { TypingIndicator } from '../components/TypingIndicator'
import { MessageList } from '../components/MessageList'
import type { Hint, ViewMessage } from '../useChat'

interface Props {
  me: Me
  messages: ViewMessage[]
  reachedEnd: boolean
  loadingOlder: boolean
  olderError: boolean
  onlineCount: number
  members: PresenceMember[]
  notices: { id: number; text: string }[]
  typers: { authorId: string; nickname: string }[]
  onTyping: () => void
  onLeave: () => void
  connection: ConnectionStatus
  hint: Hint
  onSend: (text: string) => boolean
  onRetry: (id: string) => void
  onLoadOlder: () => void
}

export function LobbyScreen(p: Props) {
  return (
    <div className="lobby">
      <Header me={p.me} onlineCount={p.onlineCount} members={p.members} notices={p.notices} connection={p.connection} onLeave={p.onLeave} />
      <div className="lobby__body">
        <MessageList
          messages={p.messages}
          meId={p.me.authorId}
          reachedEnd={p.reachedEnd}
          loadingOlder={p.loadingOlder}
          olderError={p.olderError}
          onLoadOlder={p.onLoadOlder}
          onRetry={p.onRetry}
        />
        <TypingIndicator typers={p.typers} />
        <Composer connection={p.connection} hint={p.hint} onSend={p.onSend} onTyping={p.onTyping} />
      </div>
    </div>
  )
}
