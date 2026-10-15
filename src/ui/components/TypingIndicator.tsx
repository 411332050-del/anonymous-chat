interface Props {
  typers: { authorId: string; nickname: string }[]
}

/** 輸入框上方的一行「某某 正在輸入…」。永遠佔一行高度，出現與消失時版面不會跳動。 */
export function TypingIndicator({ typers }: Props) {
  let text = ''
  if (typers.length === 1) text = `${typers[0].nickname} 正在輸入…`
  else if (typers.length === 2) text = `${typers[0].nickname}、${typers[1].nickname} 正在輸入…`
  else if (typers.length > 2) text = `${typers[0].nickname} 等 ${typers.length} 人正在輸入…`
  return (
    <div className="typing" role="status" aria-live="polite">
      {text}
    </div>
  )
}
