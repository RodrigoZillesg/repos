'use client'

import { useActionState } from 'react'
import { Botao } from '@/componentes/ui/botao'
import { Ajuda, Entrada, Rotulo } from '@/componentes/ui/campo'
import { Cartao } from '@/componentes/ui/cartao'
import { criarT } from '@/i18n/dicionario'
import { solicitarLink } from './acoes'

const t = criarT('pt-BR')

export default function Entrar() {
  const [estado, acao, pendente] = useActionState(solicitarLink, { enviado: false })

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Cartao className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2">
          <span
            className="grid h-7 w-7 place-items-center rounded-lg text-sm font-bold text-white"
            style={{ background: 'var(--color-acento)' }}
          >
            A
          </span>
          <h1 className="text-base font-semibold">{t('entrar.titulo')}</h1>
        </div>

        {estado.enviado ? (
          <p className="text-sm leading-relaxed text-[var(--color-tinta-2)]">
            {t('entrar.enviado')}
          </p>
        ) : (
          <form action={acao}>
            <p className="mb-4 text-sm leading-relaxed text-[var(--color-tinta-2)]">
              {t('entrar.descricao')}
            </p>
            <Rotulo htmlFor="email">{t('entrar.email')}</Rotulo>
            <Entrada
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="voce@platty.tech"
            />
            <Botao type="submit" disabled={pendente} className="mt-4 w-full">
              {t('entrar.acao')}
            </Botao>
            <Ajuda>Nenhuma senha é criada. O link vale 15 minutos e funciona uma vez só.</Ajuda>
          </form>
        )}
      </Cartao>
    </main>
  )
}
