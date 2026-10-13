import { useState } from 'react'
import type { MockDebug } from '../chat/ChatService'

/** 展示模式的測試面板（網址加 ?debug=1 才會出現）。 */
export function DevPanel({ debug }: { debug: MockDebug }) {
  const [offline, setOffline] = useState(false)
  const [joinFail, setJoinFail] = useState(false)

  return (
    <div className="dev">
      <strong>測試面板</strong>
      <button
        type="button"
        onClick={() => {
          debug.setOffline(!offline)
          setOffline(!offline)
        }}
      >
        {offline ? '恢復連線' : '模擬斷線'}
      </button>
      <button type="button" onClick={() => debug.failNextSend()}>
        下一則傳送失敗
      </button>
      <button
        type="button"
        onClick={() => {
          debug.setJoinFailure(!joinFail)
          setJoinFail(!joinFail)
        }}
      >
        {joinFail ? '取消連線失敗' : '模擬連線失敗'}
      </button>
    </div>
  )
}
