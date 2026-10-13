import type { ChatEvents, Unsubscribe } from './types'

type Handler = (payload: never) => void

/** 很小的事件發送器，供各種 ChatService 實作共用。 */
export class Emitter {
  private handlers = new Map<keyof ChatEvents, Set<Handler>>()

  on<E extends keyof ChatEvents>(event: E, handler: (payload: ChatEvents[E]) => void): Unsubscribe {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler as Handler)
    return () => {
      set.delete(handler as Handler)
    }
  }

  emit<E extends keyof ChatEvents>(event: E, payload: ChatEvents[E]): void {
    this.handlers.get(event)?.forEach((handler) => (handler as (p: ChatEvents[E]) => void)(payload))
  }
}
