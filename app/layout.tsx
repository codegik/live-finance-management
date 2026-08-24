import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'Live Finance',
  description: 'O orçamento da casa, mês a mês.',
}

/**
 * `themeColor` follows the palette rather than being pinned to one hex: the
 * browser paints its own chrome with it, and a dark bar above a light page is
 * the seam that makes an app look bolted together.
 */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0b0d' },
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <script src="https://cdn.pluggy.ai/pluggy-connect/v2.9.2/pluggy-connect.js" async />
      </head>
      <body>{children}</body>
    </html>
  )
}
