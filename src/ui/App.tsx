import type { DebuggableChatService } from '../chat/ChatService'
import { DEBUG_PANEL } from '../config'
import { DevPanel } from './DevPanel'
import { EntryScreen } from './screens/EntryScreen'
import { EnteringScreen } from './screens/EnteringScreen'
import { FailedScreen } from './screens/FailedScreen'
import { LobbyScreen } from './screens/LobbyScreen'
import { useChat } from './useChat'

export function App({ service }: { service: DebuggableChatService }) {
  const chat = useChat(service)

  return (
    <>
      {chat.phase === 'entry' && <EntryScreen onEnter={chat.enter} />}
      {chat.phase === 'entering' && <EnteringScreen />}
      {chat.phase === 'failed' && <FailedScreen onRetry={() => void chat.enter()} onBack={chat.backToEntry} />}
      {chat.phase === 'lobby' && chat.me && (
        <LobbyScreen
          me={chat.me}
          messages={chat.messages}
          reachedEnd={chat.reachedEnd}
          loadingOlder={chat.loadingOlder}
          olderError={chat.olderError}
          onlineCount={chat.onlineCount}
          members={chat.members}
          notices={chat.notices}
          typers={chat.typers}
          reactions={chat.reactions}
          onReact={chat.toggleReaction}
          onTyping={chat.notifyTyping}
          onLeave={chat.backToEntry}
          connection={chat.connection}
          hint={chat.hint}
          onSend={chat.send}
          onRetry={chat.retry}
          onLoadOlder={chat.loadOlder}
        />
      )}
      {DEBUG_PANEL && service.debug && <DevPanel debug={service.debug} />}
    </>
  )
}
