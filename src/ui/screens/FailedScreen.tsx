import { WarningIcon } from '../components/Icons'

export function FailedScreen({ onRetry, onBack }: { onRetry: () => void; onBack: () => void }) {
  return (
    <div className="center-screen center-screen--error">
      <WarningIcon />
      <div className="center-screen__text">
        <h1>目前無法連線到聊天室</h1>
        <p>請檢查網路後再試一次</p>
      </div>
      <button type="button" className="primary" onClick={onRetry}>
        重試
      </button>
      <button type="button" className="link-button" onClick={onBack}>
        改用其他代號
      </button>
    </div>
  )
}
