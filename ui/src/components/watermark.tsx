import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/auth-context'

import { useWatermarkConfig } from '@/lib/api'

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

function formatTime(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes()) +
    ':' +
    pad(d.getSeconds())
  )
}

export function Watermark() {
  const { user } = useAuth()
  const { data: setting } = useWatermarkConfig()

  const [now, setNow] = useState(() => formatTime(new Date()))

  useEffect(() => {
    if (!setting?.watermarkEnabled || !user) return
    const timer = setInterval(() => {
      setNow(formatTime(new Date()))
    }, 1000)
    return () => clearInterval(timer)
  }, [setting?.watermarkEnabled, user])

  if (!setting?.watermarkEnabled || !user) return null

  const username = user.username || user.id
  const name = user.name || ''
  const line1 = name ? `${username}（${name}）` : username
  const line2 = now

  // Tiled watermark units, each rotated 45deg.
  // Grid: 5 rows x 4 cols covering viewport; gap via percentage.
  const rows = 5
  const cols = 4

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9999] select-none overflow-hidden"
    >
      <div
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
        }}
      >
        {Array.from({ length: rows * cols }).map((_, i) => (
          <div key={i} className="flex items-center justify-center">
            <div
              className="rotate-45 text-center text-muted-foreground/20"
              style={{ fontSize: '14px', lineHeight: 1.4 }}
            >
              <div className="font-bold">{line1}</div>
              <div className="text-xs">{line2}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Watermark
