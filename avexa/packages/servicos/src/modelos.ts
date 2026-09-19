import type { Canal } from '@avexa/core'

/** Modelos de partida da Avexa.
 *
 *  A biblioteca de um cliente novo nasce daqui, com as variáveis preenchidas a
 *  partir do que ele vende. Ficam neste pacote, e não no seed, porque o seed e o
 *  provisionamento precisam ser a mesma coisa: se divergirem, o cliente criado
 *  pelo painel não se parece com o cliente de desenvolvimento, e o bug só
 *  aparece em produção. */

export interface ModeloAvexa {
  canal: Canal
  nome: string
  assunto?: string
  corpo: string
  /** Variáveis com valor padrão. `produto` é substituído pelo que o cliente vende. */
  variaveis: Record<string, string>
  /** E-mail e SMS são nossos e já nascem aprovados; WhatsApp passa pela Meta. */
  aprovaSozinho: boolean
}

export const MODELOS_AVEXA: readonly ModeloAvexa[] = [
  {
    canal: 'whatsapp',
    nome: 'Primeiro contato',
    corpo:
      'Oi {{nome}}! Aqui é da {{cliente}}. Vi seu interesse em {{produto}} — posso te mandar as opções?',
    variaveis: { produto: '' },
    aprovaSozinho: false,
  },
  {
    canal: 'whatsapp',
    nome: 'Confirmação de reunião',
    corpo: 'Oi {{nome}}, confirmando nossa conversa em {{data}} às {{hora}}. Combinado?',
    variaveis: { data: '', hora: '' },
    aprovaSozinho: false,
  },
  {
    canal: 'sms',
    nome: 'Lembrete',
    corpo:
      '{{cliente}}: ainda dá tempo de garantir sua vaga em {{produto}}. Responda PARAR para não receber mais.',
    variaveis: { produto: '' },
    aprovaSozinho: true,
  },
  {
    canal: 'email',
    nome: 'Retomada',
    assunto: '{{nome}}, ainda quer começar?',
    corpo:
      'Oi {{nome}},\n\nTentamos falar com você sobre {{produto}}. Responda este e-mail e a gente segue daqui.\n\n{{cliente}}',
    variaveis: { produto: '' },
    aprovaSozinho: true,
  },
  {
    canal: 'email',
    nome: 'Boas-vindas',
    assunto: 'Recebemos seu contato, {{nome}}',
    corpo:
      'Oi {{nome}},\n\nRecebemos seu interesse em {{produto}} e já estamos preparando as informações. Em instantes alguém do time fala com você.\n\n{{cliente}}',
    variaveis: { produto: '' },
    aprovaSozinho: true,
  },
] as const

/** Roteiros de voz de partida, por situação. */
export const ROTEIROS_AVEXA: Record<string, string> = {
  'Qualificação inicial':
    'Você liga em nome da {{cliente}} para alguém que acabou de pedir informação sobre {{produto}}. Descubra o que a pessoa procura, qual o prazo dela e se tem alguma restrição de horário. Seja breve e não insista se ela pedir para encerrar.',
  'Retorno de interesse':
    'Você liga em nome da {{cliente}} para alguém que demonstrou interesse em {{produto}} há alguns dias e não respondeu às mensagens. Retome de onde parou, sem soar cobrança.',
  'Confirmação de agendamento':
    'Você liga em nome da {{cliente}} para confirmar uma reunião já marcada sobre {{produto}}. Confirme dia e hora, e ofereça remarcar se não servir mais.',
}
