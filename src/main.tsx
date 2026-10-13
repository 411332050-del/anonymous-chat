import { createRoot } from 'react-dom/client'
import { createChatService } from './chat/createChatService'
import './styles.css'
import { App } from './ui/App'

createRoot(document.getElementById('root')!).render(<App service={createChatService()} />)
