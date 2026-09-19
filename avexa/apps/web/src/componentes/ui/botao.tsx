'use client'
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const variantes = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 whitespace-nowrap',
  {
    variants: {
      variante: {
        padrao:
          'bg-[var(--color-acento)] text-white hover:opacity-90 shadow-sm',
        contorno:
          'border bg-[var(--color-superficie)] text-[var(--color-tinta)] hover:bg-[var(--color-acento-suave)]',
        fantasma: 'text-[var(--color-tinta-2)] hover:bg-[var(--color-acento-suave)] hover:text-[var(--color-tinta)]',
        perigo: 'border border-[var(--color-alerta)] text-[var(--color-alerta)] hover:bg-[var(--color-alerta)] hover:text-white',
      },
      tamanho: {
        padrao: 'h-9 px-3.5',
        pequeno: 'h-7 px-2.5 text-xs',
        icone: 'h-9 w-9',
      },
    },
    defaultVariants: { variante: 'padrao', tamanho: 'padrao' },
  },
)

export interface PropsBotao
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variantes> {
  comoFilho?: boolean
}

export const Botao = React.forwardRef<HTMLButtonElement, PropsBotao>(
  ({ className, variante, tamanho, comoFilho = false, ...props }, ref) => {
    const Comp = comoFilho ? Slot : 'button'
    return <Comp ref={ref} className={cn(variantes({ variante, tamanho }), className)} {...props} />
  },
)
Botao.displayName = 'Botao'
