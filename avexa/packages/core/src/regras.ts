import { dentroDaJanela, proximaJanela } from './janela.ts'
import type { Canal, LimitesMotor, MotivoBloqueio } from './tipos.ts'

/** O que o motor precisa saber sobre a pessoa e a execução para decidir se um
 *  contato pode sair agora. Tudo é lido do banco antes de chamar a regra; a regra
 *  em si é pura, para poder ser testada sem infraestrutura. */
export interface FatosContato {
  canal: Canal
  /** Telefone ou e-mail do destinatário, já normalizado. */
  destinatario: string | null
  /** A pessoa está na lista de supressão global, por qualquer identificador? */
  suprimido: boolean
  /** A pessoa já respondeu em qualquer canal desta execução? */
  jaRespondeu: boolean
  /** O cliente contratou este canal? */
  canalAtivo: boolean
  /** O template exigido pelo canal está aprovado? Indefinido quando não se aplica. */
  templateAprovado?: boolean
  /** Quantas tentativas esta execução já fez. */
  tentativasFeitas: number
  /** Teto que o próprio fluxo pediu. Pode ser menor que o do sistema, nunca maior. */
  tetoDoFluxo?: number
  /** Quando saiu o último contato com esta pessoa, em qualquer cliente e canal. */
  ultimoContatoEm: Date | null
  fusoDoLead: string
}

export type Decisao =
  | { pode: true }
  | { pode: false; motivo: MotivoBloqueio; adiarPara?: Date; definitivo: boolean }

/** As seis regras que o motor aplica sozinho, na ordem em que importam.
 *
 *  A ordem não é arbitrária: um bloqueio definitivo (supressão, resposta, teto)
 *  precisa ser reconhecido antes de qualquer adiamento, senão o motor reagenda
 *  para sempre um contato que nunca poderia sair. */
export function podeContatar(f: FatosContato, l: LimitesMotor, agora: Date): Decisao {
  // 3. Opt-out vale em tudo — todos os canais, todos os clientes, para sempre.
  if (f.suprimido) return { pode: false, motivo: 'suprimido', definitivo: true }

  // 2. Parada na primeira resposta — respondeu em qualquer canal, cancela o resto.
  if (f.jaRespondeu) return { pode: false, motivo: 'ja_respondeu', definitivo: true }

  if (!f.canalAtivo) return { pode: false, motivo: 'canal_desligado', definitivo: true }
  if (!f.destinatario) return { pode: false, motivo: 'sem_destinatario', definitivo: true }

  // 5. Teto de tentativas — o fluxo pode pedir menos que o sistema, nunca mais.
  const teto = Math.min(l.tetoTentativas, f.tetoDoFluxo ?? l.tetoTentativas)
  if (f.tentativasFeitas >= teto) {
    return { pode: false, motivo: 'teto_de_tentativas', definitivo: true }
  }

  if (f.templateAprovado === false) {
    return { pode: false, motivo: 'template_nao_aprovado', definitivo: true }
  }

  // 1. Um canal por janela — nunca dois disparos para a mesma pessoa na mesma
  //    janela, mesmo que o fluxo peça. Vale entre clientes diferentes também.
  if (f.ultimoContatoEm) {
    const liberaEm = new Date(f.ultimoContatoEm.getTime() + l.intervaloMinimoMin * 60_000)
    if (liberaEm > agora) {
      return {
        pode: false,
        motivo: 'intervalo_minimo',
        adiarPara: proximaJanela(liberaEm, f.fusoDoLead, l),
        definitivo: false,
      }
    }
  }

  // 4. Só em horário útil, no fuso do lead. Fora da janela, espera a abertura.
  if (!dentroDaJanela(agora, f.fusoDoLead, l)) {
    return {
      pode: false,
      motivo: 'fora_da_janela',
      adiarPara: proximaJanela(agora, f.fusoDoLead, l),
      definitivo: false,
    }
  }

  return { pode: true }
}

/** 6. Subfluxo não vira laço.
 *
 *  Corta a cadeia se ela voltar a um fluxo que já está na pilha, ou se passar da
 *  profundidade máxima. As duas coisas separadas porque a segunda pega recursão
 *  indireta que a primeira deixaria passar em cadeia longa. */
export function podeChamarSubfluxo(
  cadeia: readonly string[],
  alvoId: string,
  l: LimitesMotor,
): { pode: boolean; motivo?: 'laco' | 'profundidade' } {
  if (cadeia.includes(alvoId)) return { pode: false, motivo: 'laco' }
  if (cadeia.length >= l.profundidadeMaxSubfluxo) return { pode: false, motivo: 'profundidade' }
  return { pode: true }
}
