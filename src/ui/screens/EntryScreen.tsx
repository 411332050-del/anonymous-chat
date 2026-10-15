import { useState, type FormEvent } from 'react'
import { CHAT_MODE } from '../../config'
import { ALIAS_MAX_LENGTH, aliasProblem, sanitizeAlias } from '../../rules'

/** 打開網頁看到的第一個畫面：輸入代號，按「進入聊天室」才會連線。 */
export function EntryScreen({ onEnter }: { onEnter: (alias: string) => void }) {
  const [value, setValue] = useState('')
  const alias = sanitizeAlias(value)
  const problem = aliasProblem(alias)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!problem) onEnter(alias)
  }

  return (
    <div className="center-screen entry">
      <form className="entry__form" onSubmit={submit} noValidate>
        <div className="center-screen__text">
          <h1>匿名聊天室</h1>
          <p>輸入一個代號，進入大家共用的聊天室</p>
        </div>
        <div className="entry__field">
          <label htmlFor="alias">代號</label>
          <input
            id="alias"
            name="alias"
            placeholder="輸入你的代號"
            maxLength={ALIAS_MAX_LENGTH}
            autoComplete="off"
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-describedby="alias-problem"
          />
          <p id="alias-problem" className="entry__problem" role="status">
            {problem ?? ' '}
          </p>
        </div>
        <button type="submit" className="primary" disabled={problem !== null}>
          進入聊天室
        </button>
        <p className="entry__hint">你的名稱會是「代號#三碼編號」，編號由系統產生，不能自己指定。</p>
      </form>
      {CHAT_MODE === 'demo' && (
        <div className="demo-note">展示模式：目前訊息只存在你的瀏覽器，不會傳給其他裝置。</div>
      )}
    </div>
  )
}
