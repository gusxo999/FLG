import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installLayoutDebugApi } from './debug/debugApi'
import { openLayoutLinkFromLocation } from './layoutLink/openInApp'

installLayoutDebugApi()
// 주소에 배치 링크가 있으면 **그리기 전에** 연다 — 저장을 메모리로 돌린 뒤에 넣어야 사용자의 배치를 안 덮는다.
openLayoutLinkFromLocation()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
