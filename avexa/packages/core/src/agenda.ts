import { dentroDaJanela, proximaJanela } from './janela.ts'
import type { LimitesMotor } from './tipos.ts'

/** Busca de horários livres.
 *
 *  Recebe os intervalos ocupados que o calendário devolveu e produz horários
 *  oferecíveis. É puro de propósito: agenda é onde erro de fuso e de borda vira
 *  reunião marcada em cima de outra, e isso precisa ser testável sem Google. */

export interface Intervalo {
  inicio: Date
  fim: Date
}

export interface PedidoHorarios {
  /** A partir de quando procurar. */
  de: Date
  /** Até quando procurar. */
  ate: Date
  duracaoMin: number
  /** Ocupados, em qualquer ordem, podendo se sobrepor. */
  ocupados: readonly Intervalo[]
  /** Fuso do lead: a janela de contato é o horário dele, não o nosso. */
  fuso: string
  limites: LimitesMotor
  /** Quantos horários devolver. */
  quantos?: number
  /** Passo da varredura, em minutos. Horário quebrado não se oferece a ninguém. */
  passoMin?: number
  /** Folga antes e depois de cada compromisso existente. */
  folgaMin?: number
}

function normalizar(ocupados: readonly Intervalo[], folgaMs: number): Intervalo[] {
  const expandidos = ocupados
    .filter((o) => o.fim > o.inicio)
    .map((o) => ({
      inicio: new Date(o.inicio.getTime() - folgaMs),
      fim: new Date(o.fim.getTime() + folgaMs),
    }))
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime())

  // Funde sobreposições: dois consultores ocupados no mesmo horário são um
  // buraco só, e comparar contra a lista crua faria a varredura testar o mesmo
  // instante várias vezes.
  const fundidos: Intervalo[] = []
  for (const atual of expandidos) {
    const ultimo = fundidos[fundidos.length - 1]
    if (ultimo && atual.inicio <= ultimo.fim) {
      if (atual.fim > ultimo.fim) ultimo.fim = atual.fim
    } else {
      fundidos.push({ ...atual })
    }
  }
  return fundidos
}

const colide = (inicio: Date, fim: Date, ocupados: readonly Intervalo[]): boolean =>
  ocupados.some((o) => inicio < o.fim && fim > o.inicio)

/** Horários oferecíveis, em ordem, dentro da janela de contato do lead. */
export function horariosLivres(p: PedidoHorarios): Date[] {
  const passo = p.passoMin ?? 30
  const quantos = p.quantos ?? 3
  const duracaoMs = p.duracaoMin * 60_000
  const ocupados = normalizar(p.ocupados, (p.folgaMin ?? 0) * 60_000)

  const achados: Date[] = []
  // Arredonda para o próximo múltiplo do passo: oferecer 14h07 é estranho.
  const passoMs = passo * 60_000
  let t = new Date(Math.ceil(p.de.getTime() / passoMs) * passoMs)

  // Teto de varredura: uma janela longa com agenda cheia não pode girar sem fim.
  for (let i = 0; i < 5000 && t < p.ate && achados.length < quantos; i++) {
    const fim = new Date(t.getTime() + duracaoMs)

    // A reunião inteira precisa caber na janela, não só o começo dela: um
    // encontro de 45 minutos às 19h30 terminaria depois do fechamento.
    if (
      dentroDaJanela(t, p.fuso, p.limites) &&
      dentroDaJanela(new Date(fim.getTime() - 60_000), p.fuso, p.limites) &&
      fim <= p.ate &&
      !colide(t, fim, ocupados)
    ) {
      achados.push(new Date(t))
      t = new Date(t.getTime() + duracaoMs)
      continue
    }

    // Fora da janela, pula direto para a próxima abertura em vez de varrer a
    // madrugada inteira de meia em meia hora.
    if (!dentroDaJanela(t, p.fuso, p.limites)) {
      const abre = proximaJanela(t, p.fuso, p.limites)
      t = new Date(Math.max(abre.getTime(), t.getTime() + passoMs))
      continue
    }
    t = new Date(t.getTime() + passoMs)
  }

  return achados
}

/** Rodízio entre consultores: quem tem menos compromissos na janela recebe o
 *  próximo. Empate resolve pela ordem da lista, para ser determinístico. */
export function escolherConsultor(
  consultores: readonly string[],
  ocupadosPor: Readonly<Record<string, readonly Intervalo[]>>,
  inicio: Date,
  fim: Date,
): string | null {
  if (consultores.length === 0) return null

  const livres = consultores.filter((c) => !colide(inicio, fim, ocupadosPor[c] ?? []))
  if (livres.length === 0) return null

  return livres.reduce((melhor, c) =>
    (ocupadosPor[c]?.length ?? 0) < (ocupadosPor[melhor]?.length ?? 0) ? c : melhor,
  )
}
