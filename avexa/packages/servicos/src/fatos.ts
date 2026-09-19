import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { clienteCanal, tentativa, type Db } from '@avexa/db'
import type { Canal, FatosContato } from '@avexa/core'
import { estaSuprimido } from './supressao.ts'

/** Reúne do banco tudo que as regras do motor precisam saber.
 *
 *  As regras em si são puras e vivem em @avexa/core; esta função é a única que
 *  toca o banco. A separação existe para que a decisão de contatar possa ser
 *  testada sem infraestrutura, e para que fique óbvio onde procurar quando uma
 *  regra decidir errado: ou o fato veio errado daqui, ou a regra está errada lá. */

export interface ContextoFatos {
  clienteId: string
  execucaoId: string
  pessoaId: string
  canal: Canal
  telefone: string | null
  email: string | null
  fusoDoLead: string
  tentativasFeitas: number
  tetoDoFluxo?: number
  templateAprovado?: boolean
}

/** Os fatos que as regras consomem, mais o que só o envio precisa.
 *
 *  O remetente fica fora de `FatosContato` de propósito: as regras de @avexa/core
 *  decidem SE contata, não DE ONDE sai. Misturar as duas coisas obrigaria o
 *  simulador e os testes puros a inventarem um número. */
export interface FatosDoContato {
  fatos: FatosContato
  remetente: string | null
  vozId: string | null
}

export async function carregarFatosContato(db: Db, c: ContextoFatos): Promise<FatosDoContato> {
  const [suprimido, respondeu, canal, ultimo] = await Promise.all([
    estaSuprimido(db, { telefone: c.telefone, email: c.email }),
    jaRespondeu(db, c.execucaoId),
    canalDoCliente(db, c.clienteId, c.canal),
    ultimoContatoDaPessoa(db, c.pessoaId),
  ])

  const fatos: FatosContato = {
    canal: c.canal,
    destinatario: c.canal === 'email' ? c.email : c.telefone,
    suprimido,
    jaRespondeu: respondeu,
    canalAtivo: canal.ativo,
    tentativasFeitas: c.tentativasFeitas,
    ultimoContatoEm: ultimo,
    fusoDoLead: c.fusoDoLead,
    ...(c.tetoDoFluxo !== undefined ? { tetoDoFluxo: c.tetoDoFluxo } : {}),
    ...(c.templateAprovado !== undefined ? { templateAprovado: c.templateAprovado } : {}),
  }

  return { fatos, remetente: canal.remetente, vozId: canal.vozId }
}

/** Respondeu em qualquer canal desta execução. */
async function jaRespondeu(db: Db, execucaoId: string): Promise<boolean> {
  const linhas = await db
    .select({ id: tentativa.id })
    .from(tentativa)
    .where(and(eq(tentativa.execucaoId, execucaoId), isNotNull(tentativa.respondidaEm)))
    .limit(1)
  return linhas.length > 0
}

/** Canais em que cada cliente fala do PRÓPRIO número.
 *
 *  Só telefonia. O WhatsApp sai sempre do número único da Avexa (a Cloud API
 *  manda pelo phoneNumberId da nossa WABA, e não há outro para mandar), e o
 *  e-mail sai sempre do remetente único verificado no Resend. A lista está
 *  aqui, explícita, para que um `config.numero` gravado por engano num desses
 *  canais não consiga trocar o remetente — no WhatsApp isso não daria erro
 *  claro, daria mensagem não entregue. */
const CANAIS_COM_NUMERO_PROPRIO = new Set<Canal>(['sms', 'ligacao'])

export interface CanalDoCliente {
  ativo: boolean
  /** O número dedicado deste cliente, quando existe e quando o canal é de
   *  telefonia. O lead precisa reconhecer quem está ligando, e o SMS tem que
   *  sair do mesmo número da ligação. */
  remetente: string | null
  /** Id do número na Vapi. A ligação não sai por E.164: a Vapi identifica o
   *  número por id próprio, e o número comprado no Twilio só serve para voz
   *  depois de importado lá. */
  vozId: string | null
}

/** Estado e ajustes do canal para este cliente.
 *
 *  Lê `config` além de `ativo`. A reserva de número na ativação grava
 *  `config.numero` desde sempre; até aqui ninguém lia, e todo cliente acabava
 *  falando pelo número global do .env. */
export async function canalDoCliente(
  db: Db,
  clienteId: string,
  canal: Canal,
): Promise<CanalDoCliente> {
  const [linha] = await db
    .select({ ativo: clienteCanal.ativo, config: clienteCanal.config })
    .from(clienteCanal)
    .where(and(eq(clienteCanal.clienteId, clienteId), eq(clienteCanal.canal, canal)))
    .limit(1)

  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  return {
    ativo: linha?.ativo ?? false,
    remetente: CANAIS_COM_NUMERO_PROPRIO.has(canal) ? texto(linha?.config?.numero) : null,
    vozId: canal === 'ligacao' ? texto(linha?.config?.vozId) : null,
  }
}

/** Último contato com esta pessoa, **em qualquer cliente e qualquer canal**.
 *
 *  A regra de um canal por janela é sobre a pessoa, não sobre o cliente: dois
 *  clientes da Avexa não podem ligar para o mesmo lead com dez minutos de
 *  diferença só porque não se conhecem. */
async function ultimoContatoDaPessoa(db: Db, pessoaId: string): Promise<Date | null> {
  const [linha] = await db
    .select({ em: tentativa.executadaEm })
    .from(tentativa)
    .where(
      and(
        eq(tentativa.pessoaId, pessoaId),
        isNotNull(tentativa.executadaEm),
        inArray(tentativa.estado, ['enviada', 'entregue', 'lida', 'respondida']),
      ),
    )
    .orderBy(desc(tentativa.executadaEm))
    .limit(1)

  return linha?.em ?? null
}
