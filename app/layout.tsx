import type { ReactNode } from 'react'
import './globals.css'

export const metadata = { title: 'Live Finance' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script src="https://cdn.pluggy.ai/pluggy-connect/v2.9.2/pluggy-connect.js" async />
      </head>
      <body>{children}</body>
    </html>
  )
}
