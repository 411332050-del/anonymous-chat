import { CHAT_MODE } from '../../config'
import { SpinnerIcon } from '../components/Icons'

export function EnteringScreen() {
  return (
    <div className="center-screen">
      <SpinnerIcon size={40} />
      <div className="center-screen__text">
        <h1>正在進入聊天室…</h1>
        <p>正在為你準備匿名身分</p>
      </div>
      {CHAT_MODE === 'demo' && (
        <div className="demo-note">展示模式：目前訊息只存在你的瀏覽器，不會傳給其他裝置。</div>
      )}
    </div>
  )
}
