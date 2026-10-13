import type { Message } from '../types'

const ADJECTIVES = ['貓咪', '水獺', '企鵝', '狐狸', '柴犬', '浣熊', '無尾熊', '刺蝟', '海豚', '兔子', '松鼠', '貓頭鷹']

export function randomNickname(): string {
  const animal = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const num = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return `匿名${animal} ${num}`
}

export function newId(): string {
  return crypto.randomUUID()
}

const SAMPLE_AUTHORS = [
  { authorId: 'sample-author-1', nickname: '匿名水獺 107' },
  { authorId: 'sample-author-2', nickname: '匿名企鵝 733' },
  { authorId: 'sample-author-3', nickname: '匿名柴犬 219' },
  { authorId: 'sample-author-4', nickname: '匿名浣熊 640' },
  { authorId: 'sample-author-5', nickname: '匿名刺蝟 381' },
]

const SAMPLE_LINES = [
  '有人在嗎？今天好熱',
  '在！剛下班，先開冷氣',
  '通勤真的好累，捷運根本是沙丁魚罐頭',
  '晚餐你們都吃什麼？我完全沒靈感',
  '巷口那間牛肉麵不錯，推薦',
  '我今天終於把拖了兩週的報告交出去了',
  '恭喜！是不是該好好犒賞自己',
  '最近有看什麼好看的影集嗎？',
  '最近在追一部懸疑的，每集結尾都很想罵人',
  '不要劇透喔',
  '放心，我只講我很喜歡',
  '週末有人要出門嗎？天氣好像會變好',
  '想去山上走走，但又怕人太多',
  '那就挑平日請假去啊',
  '哈哈哈這個主意不錯',
  '有沒有推薦的耳機？預算三千以內',
  '我用的那副還行，主要是降噪夠用',
  '深夜的泡麵是什麼原理，為什麼特別好吃',
  '大概是心理作用加上餓過頭',
  '早點睡啦各位',
  '好，我再滑十分鐘就睡',
  '這句話我聽過一百次了',
  '今天的夕陽超漂亮，有人看到嗎',
  '看到了！整片天都是橘色的',
  '咖啡續杯第三次了，今晚大概睡不著',
  '歡迎新朋友～',
  '剛進來，這裡都聊些什麼呀？',
  '什麼都聊，沒有主題，輕鬆就好',
  '好喔，那我先潛水觀察一下',
  '不用客氣，想說話就說',
]

/** 預先放約 60 則範例訊息，用來測試「最近 50 則」與「往上捲載入更早」。 */
export function createSeedMessages(count = 60): Message[] {
  const now = Date.now()
  const gap = 3 * 60_000
  const messages: Message[] = []
  for (let i = 0; i < count; i++) {
    const author = SAMPLE_AUTHORS[(i * 7 + (i % 3)) % SAMPLE_AUTHORS.length]
    messages.push({
      id: `seed-${String(i).padStart(3, '0')}`,
      authorId: author.authorId,
      nickname: author.nickname,
      content: SAMPLE_LINES[i % SAMPLE_LINES.length],
      createdAt: new Date(now - (count - i + 2) * gap).toISOString(),
    })
  }
  return messages
}

export const BOT_AUTHORS = SAMPLE_AUTHORS
export const BOT_LINES = SAMPLE_LINES
