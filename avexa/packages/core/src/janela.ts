import type { LimitesMotor } from './tipos.ts'

/** Aritmética de fuso sem dependência externa, via Intl.
 *
 *  Tudo aqui existe por causa de uma regra só: o relógio do lead manda. Uma espera
 *  de duas horas disparada às 19h não vence às 21h — ela vence às 9h da manhã
 *  seguinte, porque o tempo só corre dentro da janela de contato. */

interface Partes {
  ano: number
  mes: number
  dia: number
  hora: number
  minuto: number
  /** 0 = domingo. */
  diaSemana: number
}

const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const formatadores = new Map<string, Intl.DateTimeFormat>()

function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    })
    formatadores.set(fuso, f)
  }
  return f
}

/** Decompõe um instante no relógio de parede do fuso indicado. */
export function partesEm(instante: Date, fuso: string): Partes {
  const p = formatador(fuso).formatToParts(instante)
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '0'
  return {
    ano: Number(v('year')),
    mes: Number(v('month')),
    dia: Number(v('day')),
    hora: Number(v('hour')),
    minuto: Number(v('minute')),
    diaSemana: Math.max(0, DIAS.indexOf(v('weekday'))),
  }
}

function deslocamentoMs(instante: Date, fuso: string): number {
  const p = partesEm(instante, fuso)
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, 0, 0)
  // Descarta segundos e milissegundos dos dois lados para não contaminar a conta.
  const base = Math.floor(instante.getTime() / 60000) * 60000
  return comoUtc - base
}

/** Converte um relógio de parede do fuso para o instante UTC correspondente.
 *  Aplica o deslocamento duas vezes para acertar a virada de horário de verão. */
export function deFusoParaUtc(
  fuso: string,
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
): Date {
  const palpite = Date.UTC(ano, mes - 1, dia, hora, minuto, 0, 0)
  const d1 = deslocamentoMs(new Date(palpite), fuso)
  const t1 = palpite - d1
  const d2 = deslocamentoMs(new Date(t1), fuso)
  return new Date(palpite - d2)
}

function diaPermitido(diaSemana: number, l: LimitesMotor): boolean {
  if (diaSemana === 6) return l.contatarSabado
  if (diaSemana === 0) return l.contatarDomingo
  return true
}

/** O instante cai dentro da janela de contato do lead? */
export function dentroDaJanela(instante: Date, fuso: string, l: LimitesMotor): boolean {
  const p = partesEm(instante, fuso)
  if (!diaPermitido(p.diaSemana, l)) return false
  const min = p.hora * 60 + p.minuto
  return min >= l.janelaInicioMin && min < l.janelaFimMin
}

/** O primeiro instante a partir de `instante` que cai dentro da janela.
 *  Devolve o próprio `instante` se ele já estiver dentro. */
export function proximaJanela(instante: Date, fuso: string, l: LimitesMotor): Date {
  if (dentroDaJanela(instante, fuso, l)) return instante

  const p = partesEm(instante, fuso)
  const min = p.hora * 60 + p.minuto
  // Antes de abrir, no mesmo dia: espera abrir. Senão, começa a busca amanhã.
  let { ano, mes, dia } = p
  let diaSemana = p.diaSemana
  const abreHoje = diaPermitido(diaSemana, l) && min < l.janelaInicioMin

  if (!abreHoje) {
    const d = new Date(Date.UTC(ano, mes - 1, dia))
    d.setUTCDate(d.getUTCDate() + 1)
    ano = d.getUTCFullYear()
    mes = d.getUTCMonth() + 1
    dia = d.getUTCDate()
    diaSemana = d.getUTCDay()
  }

  // No máximo uma semana à frente: além disso a configuração é que está errada.
  for (let i = 0; i < 8; i++) {
    if (diaPermitido(diaSemana, l)) {
      return deFusoParaUtc(
        fuso,
        ano,
        mes,
        dia,
        Math.floor(l.janelaInicioMin / 60),
        l.janelaInicioMin % 60,
      )
    }
    const d = new Date(Date.UTC(ano, mes - 1, dia))
    d.setUTCDate(d.getUTCDate() + 1)
    ano = d.getUTCFullYear()
    mes = d.getUTCMonth() + 1
    dia = d.getUTCDate()
    diaSemana = d.getUTCDay()
  }
  throw new Error('Nenhum dia de contato permitido na configuração')
}

/** Soma uma duração contando só o tempo que corre dentro da janela.
 *
 *  É a diferença entre "esperar 2 horas" e "esperar 2 horas úteis": a segunda é a
 *  que o produto promete. */
export function somarDentroDaJanela(
  inicio: Date,
  minutos: number,
  fuso: string,
  l: LimitesMotor,
): Date {
  if (minutos <= 0) return proximaJanela(inicio, fuso, l)

  let atual = proximaJanela(inicio, fuso, l)
  let restante = minutos

  // Cada volta consome o que sobra do dia corrente e pula para a próxima abertura.
  for (let i = 0; i < 400 && restante > 0; i++) {
    const p = partesEm(atual, fuso)
    const min = p.hora * 60 + p.minuto
    const sobraNoDia = l.janelaFimMin - min

    if (restante < sobraNoDia) {
      return new Date(atual.getTime() + restante * 60000)
    }
    restante -= sobraNoDia
    // Vai para o fechamento e pede a próxima abertura a partir dali.
    atual = proximaJanela(new Date(atual.getTime() + sobraNoDia * 60000), fuso, l)
  }

  if (restante > 0) throw new Error('Espera longa demais para a janela configurada')
  return atual
}

const UNIDADES: Record<string, number> = {
  minuto: 1,
  minutos: 1,
  hora: 60,
  horas: 60,
  dia: 1440,
  dias: 1440,
}

/** Lê as durações como o construtor as apresenta: "5 minutos", "2 horas", "3 dias". */
export function duracaoEmMinutos(texto: string): number {
  const m = /^\s*(\d+)\s+(\p{L}+)\s*$/u.exec(texto)
  if (!m) throw new Error(`Duração não reconhecida: ${texto}`)
  const fator = UNIDADES[m[2]!.toLowerCase()]
  if (fator === undefined) throw new Error(`Unidade não reconhecida: ${m[2]}`)
  return Number(m[1]) * fator
}
