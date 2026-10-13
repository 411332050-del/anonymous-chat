import type { ConnectionStatus, Me } from '../../chat/types'
import { Composer } from '../components/Composer'
import { Header } from '../components/Header'
import { MessageList } from '../components/MessageList'
import type { Hint, ViewMessage } from '../useChat'

interface Props {
  me: Me
  messages: ViewMessage[]
  reachedEnd: boolean
  loadingOlder: boolean
  olderError: boolean
  onlineCount: number
  connection: ConnectionStatus
  hint: Hint
  onSend: (text: string) => boolean
  onRetry: (id: string) => void
  onLoadOlder: () => void
}

export function LobbyScreen(p: Props) {
  return (
    <div className="lobby">
      <Header me={p.me} onlineCount={p.onlineCount} connection={p.connection} />
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
        <Composer connection={p.connection} hint={p.hint} onSend={p.onSend} />
      </div>
    </div>
  )
}
