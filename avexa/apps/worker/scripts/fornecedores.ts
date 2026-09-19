/** Diz quais canais estão de pé, sem revelar credencial nenhuma.
 *
 *  Depois de gravar segredos no servidor, a pergunta é sempre a mesma: pegou?
 *  Ler o .env responderia, mas expõe as chaves no log. Isto responde olhando
 *  pelo mesmo caminho que o motor usa — se aparece aqui, o motor enxerga.
 *
 *      pnpm --filter @avexa/worker fornecedores
 */
import { adaptadoresDoAmbiente } from '@avexa/adapters'

const cfg = adaptadoresDoAmbiente()

const CANAIS = [
  ['email', 'e-mail (Resend)'],
  ['sms', 'SMS (Twilio)'],
  ['whatsapp', 'WhatsApp'],
  ['ligacao', 'ligação (Vapi)'],
] as const

for (const [chave, rotulo] of CANAIS) {
  console.log(`${cfg[chave] ? '  ativo ' : 'inativo '} ${rotulo}`)
}

// A IA e as integrações não passam pelo mapa de adaptadores, então são lidas
// direto — mas só a presença, nunca o valor.
const presente = (v?: string) => (v && v.trim() ? '  ativo ' : 'inativo ')
console.log(`${presente(process.env.GEMINI_API_KEY)} IA (Gemini)`)
console.log(`${presente(process.env.GOOGLE_CLIENT_SECRET)} Google (Calendar/Sheets)`)
console.log(`${presente(process.env.CALENDLY_CLIENT_SECRET)} Calendly`)
console.log(`${presente(process.env.HUBSPOT_CLIENT_SECRET)} HubSpot`)

if (cfg.email) {
  // O remetente não é segredo e é a causa mais comum de recusa do Resend:
  // domínio não verificado aparece aqui antes de estourar num envio real.
  console.log(`\nremetente de e-mail: ${cfg.email.remetente}`)
}
