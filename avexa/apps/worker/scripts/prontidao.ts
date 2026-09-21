/** O que falta para um cliente fazer contato de verdade.
 *
 *  A ativação tem nove passos e vários dependem de coisa que não está no nosso
 *  controle: o cliente conectar a agenda, o número ser importado na Vapi, o
 *  template ser aprovado. O resultado é que "o cliente está pronto?" não tem
 *  resposta olhando uma tela só — e a pergunta importa, porque o modo como
 *  isso falha é silêncio: o fluxo roda, a etapa é pulada, e ninguém é contatado.
 *
 *  Este script responde. Só lê: não liga canal, não publica agente, não manda
 *  lead. É seguro rodar contra produção a qualquer momento.
 *
 *      pnpm --filter @avexa/worker prontidao            # todos os clientes
 *      pnpm --filter @avexa/worker prontidao <slug>     # um só, em detalhe
 */
import { eq } from 'drizzle-orm'
import { agenteVoz, cliente, db, fluxo, integracao, numero } from '@avexa/db'
import { estadoDosCanais } from '@avexa/servicos'
import { adaptadoresDoAmbiente } from '@avexa/adapters'

const d = db()
const alvo = process.argv[2]?.trim()

const OK = '  ok   '
const FALTA = ' falta '
const NOTA = '  ·    '

/** Fornecedores globais: valem para todos os clientes, então são conferidos uma
 *  vez. Sem eles nenhum cliente fica pronto, por melhor que esteja o cadastro. */
function fornecedores(): { linhas: string[]; faltando: string[] } {
  const cfg = adaptadoresDoAmbiente()
  const tem = (v?: string) => Boolean(v && v.trim())
  const itens: Array<[string, boolean, string]> = [
    ['Twilio (SMS e compra de número)', Boolean(cfg.sms), 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN'],
    ['Vapi (ligação)', Boolean(cfg.ligacao), 'VAPI_API_KEY'],
    ['Resend (e-mail)', Boolean(cfg.email), 'RESEND_API_KEY / EMAIL_REMETENTE'],
    ['WhatsApp', Boolean(cfg.whatsapp), 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID'],
    ['IA (qualificação e roteiro)', tem(process.env.GEMINI_API_KEY), 'GEMINI_API_KEY'],
    ['APP_SECRET (cifra credenciais)', (process.env.APP_SECRET ?? '').length >= 32, 'APP_SECRET'],
    ['DOMINIO (webhooks de retorno)', tem(process.env.DOMINIO), 'DOMINIO'],
  ]
  return {
    linhas: itens.map(([nome, ok, env]) => `${ok ? OK : FALTA}${nome}${ok ? '' : ` — ${env}`}`),
    faltando: itens.filter(([, ok]) => !ok).map(([nome]) => nome),
  }
}

const cfgAdapt = adaptadoresDoAmbiente()

console.log('== Fornecedores (valem para todos os clientes) ==')
const forn = fornecedores()
for (const l of forn.linhas) console.log(l)

const clientes = await d.select().from(cliente).orderBy(cliente.nome)
const escolhidos = alvo ? clientes.filter((c) => c.slug === alvo) : clientes

if (escolhidos.length === 0) {
  console.error(alvo ? `\nnenhum cliente com o slug ${alvo}` : '\nnenhum cliente cadastrado')
  process.exit(1)
}

let algumPronto = false

for (const c of escolhidos) {
  console.log(`\n== ${c.nome} (${c.slug}) ==`)
  const pendencias: string[] = []

  // 1. Cadastro. O fuso decide a janela de contato e o país decide como um
  //    telefone sem DDI é normalizado: errar qualquer um dos dois não dá erro,
  //    dá contato na hora errada ou telefone perdido.
  console.log(`${NOTA}${c.fusoHorario} · ${c.pais} · status ${c.status}`)
  console.log(
    c.dryRun
      ? `${NOTA}MODO SECO: o fluxo roda inteiro e nada é enviado`
      : `${OK}modo seco desligado — os contatos saem de verdade`,
  )

  // 2. Número. O mesmo atende voz e SMS.
  const [num] = await d.select().from(numero).where(eq(numero.clienteId, c.id)).limit(1)
  if (num) console.log(`${OK}número ${num.e164} (${num.status})`)
  else console.log(`${NOTA}sem número — só WhatsApp e e-mail podem ser ligados`)

  // 3. Canais, com o mesmo cálculo de pré-requisito que a tela usa.
  const canais = await estadoDosCanais(d, c.id)
  const ligados = canais.filter((x) => x.ativo)
  for (const x of canais) {
    if (x.ativo) {
      // Canal contratado mas sem fornecedor global é o pior caso: a tela diz
      // contratado, o fluxo tem a etapa, e o envio morre no adaptador.
      const temFornecedor = Boolean(cfgAdapt[x.canal as keyof typeof cfgAdapt])
      if (temFornecedor) console.log(`${OK}${x.canal} contratado`)
      else {
        console.log(`${FALTA}${x.canal} contratado, mas o fornecedor não está configurado`)
        pendencias.push(`fornecedor de ${x.canal}`)
      }
    } else if (x.falta) {
      console.log(`${NOTA}${x.canal} desligado — para ligar: ${x.falta}`)
    } else {
      console.log(`${NOTA}${x.canal} desligado (pode ser ligado agora)`)
    }
  }
  if (ligados.length === 0) pendencias.push('nenhum canal contratado')

  // 4. Agente de voz, só se a ligação estiver contratada.
  if (canais.find((x) => x.canal === 'ligacao')?.ativo) {
    const [ag] = await d.select().from(agenteVoz).where(eq(agenteVoz.clienteId, c.id)).limit(1)
    if (!ag) {
      console.log(`${FALTA}ligação contratada e sem agente de voz`)
      pendencias.push('agente de voz')
    } else if (!ag.vapiAssistantId) {
      console.log(`${FALTA}agente existe mas nunca foi publicado na Vapi`)
      pendencias.push('publicar o agente')
    } else {
      const pendente = !ag.publicadoEm || ag.atualizadoEm > ag.publicadoEm
      console.log(
        pendente
          ? `${NOTA}agente publicado, mas há alteração salva depois — republique`
          : `${OK}agente publicado na Vapi`,
      )
    }
  }

  // 5. Fluxo publicado. Sem ele a URL de webhook aceita o lead e não acontece
  //    nada: a execução não tem o que executar.
  const fluxos = await d.select().from(fluxo).where(eq(fluxo.clienteId, c.id))
  const publicados = fluxos.filter((f) => f.versaoPublicadaId)
  if (publicados.length === 0) {
    console.log(`${FALTA}nenhum fluxo publicado (${fluxos.length} rascunho(s))`)
    pendencias.push('publicar um fluxo')
  } else {
    console.log(`${OK}${publicados.length} fluxo(s) publicado(s)`)
    for (const f of publicados) {
      console.log(`${NOTA}  https://${process.env.DOMINIO ?? 'DOMINIO'}/api/hooks/v1/${c.slug}/${f.slug}`)
    }
  }

  // 6. Destino de entrega. Um fluxo impecável que qualifica o lead e não o
  //    entrega em lugar nenhum não serviu para nada.
  const destinos = await d.select().from(integracao).where(eq(integracao.clienteId, c.id))
  const ativos = destinos.filter((x) => x.ativo)
  if (ativos.length === 0) {
    console.log(`${FALTA}nenhum destino de entrega conectado (CRM, planilha, webhook ou e-mail)`)
    pendencias.push('um destino de entrega')
  } else {
    console.log(`${OK}destinos: ${ativos.map((x) => x.tipo).join(', ')}`)
  }

  // Veredito.
  const travas = [...pendencias, ...forn.faltando.filter((f) => f.startsWith('APP_SECRET'))]
  if (travas.length === 0) {
    algumPronto = true
    console.log(
      c.dryRun
        ? `\n  PRONTO para um lead de teste em modo seco. Para contato real, desligue o modo seco em Clientes.`
        : `\n  PRONTO para contato real. Um lead entrando agora é contatado de verdade.`,
    )
  } else {
    console.log(`\n  FALTA: ${travas.join(' · ')}`)
  }
}

console.log(
  algumPronto
    ? '\nPara mandar um lead de teste: pnpm --filter @avexa/worker e2e'
    : '\nNenhum cliente pronto ainda.',
)
process.exit(0)
