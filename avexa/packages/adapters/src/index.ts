import { segredoDoWebhookVapi } from './vapi.ts'
import type { AdaptadorCanal, Canal } from '@avexa/core'
import { adaptadorSeco } from '@avexa/core'
import { adaptadorResend, type ConfigResend } from './resend.ts'
import { adaptadorTwilioSms, type ConfigTwilio } from './twilio.ts'
import { adaptadorVapi, type ConfigVapi } from './vapi.ts'
import { adaptadorWhatsApp, type ConfigWhatsApp } from './whatsapp.ts'

export * from './http.ts'
export * from './google.ts'
export * from './calendly.ts'
export * from './hubspot.ts'
export * from './webhook.ts'
export * from './resend.ts'
export * from './twilio.ts'
export * from './vapi.ts'
export * from './whatsapp.ts'

export interface ConfigAdaptadores {
  email?: ConfigResend
  sms?: ConfigTwilio
  whatsapp?: ConfigWhatsApp
  ligacao?: ConfigVapi
}

/** Monta o mapa de adaptadores a partir do ambiente.
 *
 *  Um canal sem credencial simplesmente não entra no mapa; o motor trata isso
 *  como canal indisponível e pula a etapa, em vez de estourar na hora do envio. */
export function adaptadoresDoAmbiente(
  env: Record<string, string | undefined> = process.env,
): ConfigAdaptadores {
  const cfg: ConfigAdaptadores = {}

  if (env.RESEND_API_KEY) {
    cfg.email = {
      apiKey: env.RESEND_API_KEY,
      remetente: env.EMAIL_REMETENTE ?? 'Avexa <contato@avexa.global>',
    }
  }
  // Sem TWILIO_REMETENTE: o remetente normal é o número do cliente, e exigir
  // um número global aqui deixaria o canal desligado justamente na operação
  // multi-cliente, que é a que interessa.
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    cfg.sms = {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      ...(env.TWILIO_REMETENTE ? { remetente: env.TWILIO_REMETENTE } : {}),
      ...(env.TWILIO_STATUS_CALLBACK ? { statusCallback: env.TWILIO_STATUS_CALLBACK } : {}),
    }
  }
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) {
    cfg.whatsapp = {
      token: env.WHATSAPP_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      ...(env.WHATSAPP_VERSAO ? { versao: env.WHATSAPP_VERSAO } : {}),
    }
  }
  // Sem exigir assistente e número globais: cada cliente tem os seus, e
  // exigir os globais deixaria a voz desligada justamente na operação
  // multi-cliente — o mesmo defeito que o SMS tinha com TWILIO_REMETENTE.
  if (env.VAPI_API_KEY) {
    cfg.ligacao = {
      apiKey: env.VAPI_API_KEY,
      ...(env.VAPI_ASSISTANT_ID ? { assistantId: env.VAPI_ASSISTANT_ID } : {}),
      ...(env.VAPI_PHONE_NUMBER_ID ? { phoneNumberId: env.VAPI_PHONE_NUMBER_ID } : {}),
      // Derivado do APP_SECRET, o mesmo valor que a publicação do agente
      // manda para a Vapi. Nunca dois segredos para manter iguais à mão.
      ...(segredoDoWebhookVapi(env) ? { segredoWebhook: segredoDoWebhookVapi(env)! } : {}),
    }
  }
  return cfg
}

/** Devolve o adaptador do canal, ou `null` se ele não estiver configurado.
 *
 *  Em modo seco devolve sempre o adaptador que registra e não envia: é o que
 *  permite rodar o fluxo inteiro em espelho, com cada tentativa gravada e nenhum
 *  lead recebendo nada. */
export function criarAdaptador(
  canal: Canal,
  cfg: ConfigAdaptadores,
  opcoes: { seco?: boolean } = {},
): AdaptadorCanal | null {
  if (opcoes.seco) return adaptadorSeco(canal)

  switch (canal) {
    case 'email':
      return cfg.email ? adaptadorResend(cfg.email) : null
    case 'sms':
      return cfg.sms ? adaptadorTwilioSms(cfg.sms) : null
    case 'whatsapp':
      return cfg.whatsapp ? adaptadorWhatsApp(cfg.whatsapp) : null
    case 'ligacao':
      return cfg.ligacao ? adaptadorVapi(cfg.ligacao) : null
    default:
      // Telegram e o que vier depois: existe no enum antes do adaptador, de
      // propósito, para que acrescentar um canal não exija migração de banco.
      return null
  }
}
