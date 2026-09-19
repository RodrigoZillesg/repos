import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Avexa',
  description: 'Painel de operação multicanal da Platty',
}

export default function LayoutRaiz({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
