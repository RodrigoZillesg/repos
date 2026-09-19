import * as React from 'react'
import { cn } from '@/lib/utils'

export function Cartao({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-cartao)] border bg-[var(--color-superficie)] p-4',
        className,
      )}
      {...props}
    />
  )
}

export function Selo({
  tom = 'neutro',
  className,
  ...props
}: React.ComponentProps<'span'> & { tom?: 'neutro' | 'ok' | 'alerta' | 'acento' }) {
  const tons = {
    neutro: 'border-[var(--color-borda)] text-[var(--color-tinta-3)]',
    ok: 'border-[var(--color-ok)] text-[var(--color-ok)]',
    alerta: 'border-[var(--color-alerta)] text-[var(--color-alerta)]',
    acento: 'border-[var(--color-acento)] text-[var(--color-acento)]',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tons[tom],
        className,
      )}
      {...props}
    />
  )
}

export function Ponto({ cor }: { cor: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: cor }}
    />
  )
}
