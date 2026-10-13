import type { DebuggableChatService } from '../chat/ChatService'
import { DEBUG_PANEL } from '../config'
import { DevPanel } from './DevPanel'
import { EnteringScreen } from './screens/EnteringScreen'
import { FailedScreen } from './screens/FailedScreen'
import { LobbyScreen } from './screens/LobbyScreen'
import { useChat } from './useChat'

export function App({ service }: { service: DebuggableChatService }) {
  const chat = useChat(service)

  return (
    <>
      {chat.phase === 'entering' && <EnteringScreen />}
      {chat.phase === 'failed' && <FailedScreen onRetry={chat.enter} />}
      {chat.phase === 'lobby' && chat.me && (
        <LobbyScreen
          me={chat.me}
          messages={chat.messages}
          reachedEnd={chat.reachedEnd}
          loadingOlder={chat.loadingOlder}
          onlineCount={chat.onlineCount}
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
