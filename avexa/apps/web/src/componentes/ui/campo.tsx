'use client'
import * as React from 'react'
import { cn } from '@/lib/utils'

const base =
  'w-full rounded-lg border bg-[var(--color-superficie)] px-3 text-sm text-[var(--color-tinta)] placeholder:text-[var(--color-tinta-3)] disabled:opacity-50'

export const Entrada = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(base, 'h-9', className)} {...props} />
  ),
)
Entrada.displayName = 'Entrada'

export const AreaTexto = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} rows={3} className={cn(base, 'py-2 leading-relaxed', className)} {...props} />
  ),
)
AreaTexto.displayName = 'AreaTexto'

/** Select nativo: menos bonito que o do Radix, muito melhor no teclado e no
 *  leitor de tela, e o inspetor de etapa é quase só select. */
export const Selecao = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(base, 'h-9 cursor-pointer appearance-none pr-8', className)} {...props} />
  ),
)
Selecao.displayName = 'Selecao'

export function Rotulo({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn('mb-1.5 block text-xs font-medium text-[var(--color-tinta-2)]', className)}
      {...props}
    />
  )
}

export function Ajuda({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p className={cn('mt-1.5 text-xs leading-relaxed text-[var(--color-tinta-3)]', className)} {...props} />
  )
}
