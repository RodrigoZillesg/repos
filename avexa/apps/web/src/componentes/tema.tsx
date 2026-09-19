'use client'
import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Botao } from '@/componentes/ui/botao'

/** Alternador de tema.
 *
 *  Sem tema escolhido, o `data-tema` fica ausente e o sistema operacional decide
 *  — é o padrão certo, e o botão só grava preferência quando alguém a expressa. */
export function AlternarTema() {
  const [tema, setTema] = useState<'claro' | 'escuro' | null>(null)

  useEffect(() => {
    const guardado = localStorage.getItem('avexa-tema')
    if (guardado === 'claro' || guardado === 'escuro') {
      setTema(guardado)
      document.documentElement.dataset.tema = guardado
    }
  }, [])

  function alternar() {
    const escuro =
      tema === null ? !window.matchMedia('(prefers-color-scheme: dark)').matches : tema === 'claro'
    const novo = escuro ? 'escuro' : 'claro'
    setTema(novo)
    document.documentElement.dataset.tema = novo
    try {
      localStorage.setItem('avexa-tema', novo)
    } catch {
      // Navegação privada ou armazenamento bloqueado: o tema vale só nesta aba.
    }
  }

  return (
    <Botao variante="fantasma" tamanho="icone" onClick={alternar} aria-label="Alternar tema">
      {tema === 'escuro' ? <Sun size={15} /> : <Moon size={15} />}
    </Botao>
  )
}
