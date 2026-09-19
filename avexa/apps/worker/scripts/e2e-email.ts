/** Manda um e-mail de verdade pelo Resend e conta o que aconteceu.
 *
 *  Configuração de e-mail só está provada quando um e-mail chega. Chave certa
 *  com domínio não verificado passa em qualquer checagem de presença e falha
 *  no envio — é justamente esse caso que este script pega.
 *
 *      pnpm --filter @avexa/worker e2e:email rodrigo.zillesg@platty.tech
 */
import { adaptadorResend, adaptadoresDoAmbiente } from '@avexa/adapters'

const destinatario = (process.argv[2] ?? '').trim()
if (!destinatario.includes('@')) {
  console.error('uso: pnpm --filter @avexa/worker e2e:email <destinatario>')
  process.exit(1)
}

const cfg = adaptadoresDoAmbiente().email
if (!cfg) {
  console.error('RESEND_API_KEY não está no ambiente — o canal de e-mail está inativo')
  process.exit(1)
}

console.log(`remetente: ${cfg.remetente}`)
console.log(`destinatário: ${destinatario}`)

const agora = new Date().toISOString()
const r = await adaptadorResend(cfg).enviar({
  tentativaId: `verificacao-${Date.now()}`,
  canal: 'email',
  destinatario,
  assunto: 'Avexa — verificação de envio',
  texto:
    `Este e-mail foi disparado pela verificação de configuração do Avexa em ${agora}.\n\n` +
    `Se ele chegou, o canal de e-mail está funcionando: o link de acesso ao painel\n` +
    `passa a chegar por aqui, e as sequências podem usar e-mail como canal.\n`,
})

if (!r.ok) {
  // A mensagem do Resend é onde mora o motivo de verdade (domínio não
  // verificado, remetente recusado, chave sem permissão).
  console.error(`FALHOU: ${r.erro}`)
  console.error(r.reenviavel ? '(o erro é temporário; vale tentar de novo)' : '(erro definitivo)')
  process.exit(1)
}

console.log(`enviado. id no Resend: ${r.provedorId ?? '(sem id)'}`)
process.exit(0)
