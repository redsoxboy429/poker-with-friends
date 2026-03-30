import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import LobbyPage from './LobbyPage.tsx'
import MultiplayerTable from './MultiplayerTable.tsx'
import { SocketProvider } from './useSocket.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SocketProvider>
      <BrowserRouter>
        <Routes>
          {/* Lobby — create or join a room */}
          <Route path="/" element={<LobbyPage />} />
          {/* Multiplayer room */}
          <Route path="/room/:code" element={<MultiplayerTable />} />
          {/* Local practice (existing single-player with bots) */}
          <Route path="/practice" element={<App />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  </StrictMode>,
)
