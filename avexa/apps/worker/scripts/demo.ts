/** Atividade de exemplo, para ter o que olhar no monitor durante o
 *  desenvolvimento.
 *
 *  Não é seed: o seed monta a estrutura, isto produz histórico. Leads espalhados
 *  pelos últimos dias, alguns respondendo, um pedindo para parar, com o relógio
 *  virtual posicionado no passado para as datas ficarem coerentes. */
import { eq } from 'drizzle-orm'
import { cliente, db, execucao, tentativa } from '@avexa/db'
import { encerrarFila, ingerirLead, suprimir } from '@avexa/servicos'
import { adaptadoresDoAmbiente } from '@avexa/adapters'
import { avancarExecucao } from '../src/executor.ts'
import type { Ambiente } from '../src/contexto.ts'

const slug = process.argv[2] ?? 'ihte'
const quantos = Number(process.argv[3] ?? 18)

const d = db()
const [c] = await d.select().from(cliente).where(eq(cliente.slug, slug)).limit(1)
if (!c) {
  console.error(`cliente ${slug} não existe — rode o seed antes`)
  process.exit(1)
}

const NOMES = [
  'Ana Ribeiro', 'Bruno Carvalho', 'Carla Souza', 'Diego Alves', 'Elena Costa',
  'Felipe Nunes', 'Gabriela Lima', 'Henrique Dias', 'Isabela Moreira', 'João Peixoto',
  'Karina Braga', 'Lucas Ferraz', 'Marina Tavares', 'Nuno Almeida', 'Olivia Santos',
  'Pedro Rocha', 'Queila Martins', 'Rafael Prado',
]

let relogio = new Date()
const amb: Ambiente = {
  db: d,
  adaptadores: adaptadoresDoAmbiente(),
  ia: null,
  agora: () => new Date(relogio),
}

let criados = 0
for (let i = 0; i < quantos; i++) {
  // Espalhados pelos últimos 13 dias, sempre dentro do horário comercial para
  // não empilhar todo mundo na abertura da janela seguinte.
  const diasAtras = 13 - Math.floor((i / quantos) * 13)
  const base = new Date(Date.now() - diasAtras * 86_400_000)
  base.setUTCHours(1 + (i % 6), (i * 7) % 60, 0, 0)
  relogio = base

  const nome = NOMES[i % NOMES.length]!
  const r = await ingerirLead(
    d,
    {
      clienteSlug: slug,
      fluxoSlug: 'lead-novo',
      dados: {
        nome,
        telefone: `+6141${String(3000000 + i * 137).slice(0, 7)}`,
        email: `${nome.toLowerCase().replace(/[^a-z]/g, '.')}@exemplo.com`,
        curso: ['IELTS', 'Business English', 'Inglês geral'][i % 3]!,
        utm_source: ['google-ads', 'meta', 'organico'][i % 3]!,
      },
    },
    relogio,
  )
  if (!r.aceito) continue
  criados++

  // Avança até parar, pulando o relógio para o vencimento de cada espera.
  for (let passo = 0; passo < 20; passo++) {
    await avancarExecucao(amb, r.execucaoId)
    const [ex] = await d.select().from(execucao).where(eq(execucao.id, r.execucaoId)).limit(1)
    if (!ex || ex.estado !== 'aguardando' || !ex.retomarEm) break
    if (ex.retomarEm.getTime() > Date.now()) break // ainda no futuro: fica esperando
    relogio = ex.retomarEm

    // Um em cada três responde no meio do caminho; um em cada nove pede parada.
    if (passo === 1 && i % 3 === 0) {
      const [alvo] = await d
        .select()
        .from(tentativa)
        .where(eq(tentativa.execucaoId, r.execucaoId))
        .orderBy(tentativa.criadoEm)
      if (alvo) {
        await d
          .update(tentativa)
          .set({ estado: 'respondida', respondidaEm: relogio })
          .where(eq(tentativa.id, alvo.id))
        if (i % 9 === 0) {
          await suprimir(d, { telefone: alvo.destinatario }, { motivo: 'pedido do lead', canal: alvo.canal })
        }
      }
    }
  }
}

const linhas = await d.select().from(tentativa).where(eq(tentativa.clienteId, c.id))
console.log(`[demo] ${criados} leads · ${linhas.length} tentativas registradas em ${c.nome}`)
await encerrarFila()
process.exit(0)
