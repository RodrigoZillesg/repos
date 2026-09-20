import type { Canal, TipoEtapa } from './tipos.ts'

/** Definição de um tipo de etapa.
 *
 *  É a única fonte de verdade do construtor: a paleta, o inspetor e o validador do
 *  motor leem daqui. Acrescentar um tipo de etapa é acrescentar uma entrada nesta
 *  tabela, não editar três telas. */
export interface CampoEtapa {
  k: string
  rotulo: string
  tipo: 'texto' | 'textarea' | 'select' | 'url' | 'template' | 'fluxo' | 'agenda'
  opcoes?: readonly string[]
  /** Para o tipo `template`: de qual canal listar. */
  canalTemplate?: Canal
  /** Só aparece quando esta condição sobre a configuração da etapa for verdadeira. */
  visivelSe?: (cfg: Record<string, string>) => boolean
}

export interface DefEtapa {
  nome: string
  grupo: 'Início' | 'Controle' | 'Canais' | 'Integração' | 'Inteligência' | 'Saída'
  descricao: string
  campos: readonly CampoEtapa[]
  /** Canal usado pela etapa. Se o cliente não contratou, a etapa não pode ser inserida. */
  canal?: Canal
  /** Não pode ser inserida nem removida pelo operador. */
  fixa?: boolean
  /** Abre ramos `sim` e `nao`. */
  ramos?: boolean
  /** Abre um bloco interno `corpo`. */
  corpo?: boolean
  /** Uma linha de resumo mostrada no cartão da etapa. */
  resumo: (cfg: Record<string, string>) => string
}

const OPS = [
  'é igual a',
  'é diferente de',
  'é maior que',
  'é menor que',
  'começa com',
  'termina com',
] as const

/** Para onde esta etapa manda a reunião.
 *
 *  O campo `agenda` já foi um select de dois rótulos fixos que só ligava e
 *  desligava o rodízio. Hoje ele guarda o id de uma agenda do cliente, ou fica
 *  vazio para dizer "todas as configuradas" — é assim que dois ramos do mesmo
 *  fluxo marcam em times diferentes.
 *
 *  Os dois rótulos antigos continuam sendo lidos porque estão salvos em fluxos
 *  publicados: um deles virando "id de agenda" faria a marcação falhar em
 *  produção com "nenhuma das agendas configuradas está acessível". */
const AGENDA_LEGADA: Record<string, boolean> = {
  'Time comercial do cliente': false,
  'Rodízio entre consultores': true,
}

export interface RoteamentoDeAgenda {
  /** Agenda específica, ou `null` para todas as configuradas no cliente. */
  calendario: string | null
  rodizio: boolean
}

export function roteamentoDaEtapa(cfg: Record<string, string>): RoteamentoDeAgenda {
  const a = (cfg.agenda ?? '').trim()
  if (a in AGENDA_LEGADA) return { calendario: null, rodizio: AGENDA_LEGADA[a]! }
  if (a) return { calendario: a, rodizio: false }
  return { calendario: null, rodizio: cfg.distribuicao !== 'Primeira disponível' }
}

export const ETAPAS: Record<TipoEtapa, DefEtapa> = {
  entrada: {
    nome: 'Entrada de lead',
    grupo: 'Início',
    fixa: true,
    descricao:
      'O ponto onde o lead entra neste fluxo. Cada fluxo tem a sua própria URL: é ela que entregamos ao cliente para colar na saída do formulário, no CRM ou em qualquer outra fonte.',
    campos: [
      { k: 'url', rotulo: 'URL do webhook (entregue ao cliente)', tipo: 'url' },
      {
        k: 'metodo',
        rotulo: 'Método',
        tipo: 'select',
        opcoes: ['POST (JSON)', 'POST (form-urlencoded)', 'GET (query string)'],
      },
      { k: 'campos', rotulo: 'Campos esperados', tipo: 'texto' },
      { k: 'utm', rotulo: 'Capturar UTMs', tipo: 'select', opcoes: ['Sim, todas as utm_*', 'Não'] },
      { k: 'extra', rotulo: 'Campos personalizados', tipo: 'textarea' },
      {
        k: 'idade',
        rotulo: 'Idade máxima do lead',
        tipo: 'select',
        opcoes: ['15 minutos', '1 hora', '24 horas', '72 horas'],
      },
      {
        k: 'dedupe',
        rotulo: 'Se o lead já existir',
        tipo: 'select',
        opcoes: ['Ignorar o novo envio', 'Atualizar e não recontatar', 'Recontatar após 30 dias'],
      },
    ],
    resumo: (c) =>
      `${(c.metodo ?? '').split(' ')[0]} · ${c.utm === 'Não' ? 'sem UTMs' : 'com UTMs'} · descarta acima de ${c.idade}`,
  },

  guarda: {
    nome: 'Checar permissão',
    grupo: 'Controle',
    fixa: true,
    descricao:
      'Barreira antes do primeiro contato: consulta a supressão global, confere o opt-in e valida o horário local do lead. O motor aplica esta etapa mesmo que ela não apareça desenhada.',
    campos: [
      {
        k: 'janela',
        rotulo: 'Janela de contato (fuso do lead)',
        tipo: 'select',
        opcoes: ['09:00 às 20:00', '08:00 às 21:00', '10:00 às 18:00'],
      },
      { k: 'fds', rotulo: 'Contatar aos fins de semana', tipo: 'select', opcoes: ['Não', 'Sim'] },
    ],
    resumo: (c) => `${c.janela} · fim de semana: ${(c.fds ?? '').toLowerCase()}`,
  },

  ligacao: {
    nome: 'Ligação',
    grupo: 'Canais',
    canal: 'ligacao',
    descricao:
      'A assistente de voz liga do número dedicado do cliente, conduz a conversa e registra a transcrição. A gravação é anunciada na abertura da chamada.',
    campos: [
      {
        k: 'roteiro',
        rotulo: 'Roteiro',
        tipo: 'select',
        opcoes: ['Qualificação inicial', 'Retorno de interesse', 'Confirmação de agendamento'],
      },
      {
        k: 'ring',
        rotulo: 'Tempo de chamada',
        tipo: 'select',
        opcoes: ['20 segundos', '30 segundos', '45 segundos'],
      },
      {
        k: 'vm',
        rotulo: 'Se cair na caixa postal',
        tipo: 'select',
        opcoes: ['Deixar recado', 'Desligar sem recado'],
      },
      { k: 'obs', rotulo: 'Instrução extra para a assistente', tipo: 'textarea' },
    ],
    resumo: (c) => `${c.roteiro} · ${(c.vm ?? '').toLowerCase()}`,
  },

  whatsapp: {
    nome: 'WhatsApp',
    grupo: 'Canais',
    canal: 'whatsapp',
    descricao:
      'Sai do número da Avexa. Fora da janela de 24 horas é preciso usar um template aprovado; depois que o lead responde, a conversa é livre.',
    campos: [
      {
        k: 'modo',
        rotulo: 'Tipo de mensagem',
        tipo: 'select',
        opcoes: ['Template aprovado', 'Conversa livre (janela aberta)'],
      },
      {
        k: 'template',
        rotulo: 'Template',
        tipo: 'template',
        canalTemplate: 'whatsapp',
        visivelSe: (c) => c.modo !== 'Conversa livre (janela aberta)',
      },
      { k: 'conversa', rotulo: 'Continuar em conversa com IA', tipo: 'select', opcoes: ['Sim', 'Não'] },
    ],
    resumo: (c) =>
      `${c.modo === 'Template aprovado' ? `Template: ${c.template || '—'}` : 'Conversa livre'}${
        c.conversa === 'Sim' ? ' · segue com IA' : ''
      }`,
  },

  sms: {
    nome: 'SMS',
    grupo: 'Canais',
    canal: 'sms',
    descricao:
      'Enviado do mesmo número que liga para o lead, para ele reconhecer a origem. Todo SMS carrega a instrução de opt-out.',
    campos: [
      { k: 'template', rotulo: 'Template', tipo: 'template', canalTemplate: 'sms' },
      { k: 'link', rotulo: 'Incluir link de agendamento', tipo: 'select', opcoes: ['Sim', 'Não'] },
    ],
    resumo: (c) => `${c.template || '—'}${c.link === 'Sim' ? ' · com link' : ''}`,
  },

  email: {
    nome: 'E-mail',
    grupo: 'Canais',
    canal: 'email',
    descricao:
      'Enviado pelo Resend, sempre de um endereço do domínio da Avexa, com o template visual deste cliente.',
    campos: [
      { k: 'template', rotulo: 'Template', tipo: 'template', canalTemplate: 'email' },
      {
        k: 'replyto',
        rotulo: 'Responder para',
        tipo: 'select',
        opcoes: ['Time do cliente', 'Caixa da Avexa'],
      },
    ],
    resumo: (c) => `${c.template || '—'} · resposta: ${(c.replyto ?? '').toLowerCase()}`,
  },

  espera: {
    nome: 'Esperar',
    grupo: 'Controle',
    descricao:
      'Segura o lead antes da próxima ação. O relógio só corre dentro da janela de contato: uma espera de 2 horas às 19h continua na manhã seguinte.',
    campos: [
      {
        k: 'dur',
        rotulo: 'Duração',
        tipo: 'select',
        opcoes: ['5 minutos', '30 minutos', '2 horas', '6 horas', '24 horas', '3 dias'],
      },
      { k: 'cancel', rotulo: 'Cancelar se o lead responder', tipo: 'select', opcoes: ['Sim', 'Não'] },
    ],
    resumo: (c) => `${c.dur}${c.cancel === 'Sim' ? ' · cancela se responder' : ''}`,
  },

  condicao: {
    nome: 'Condição',
    grupo: 'Controle',
    ramos: true,
    descricao:
      'Divide o fluxo em dois caminhos, avaliada com os dados acumulados até ali, inclusive UTMs e campos personalizados vindos do webhook.',
    campos: [
      {
        k: 'campo',
        rotulo: 'Verificar',
        tipo: 'select',
        opcoes: [
          'Lead respondeu',
          'Score do lead',
          'Canal preferido',
          'Tentativas feitas',
          'Atendeu a ligação',
          'utm_source',
          'utm_campaign',
          'Campo personalizado',
        ],
      },
      {
        k: 'chave',
        rotulo: 'Nome do campo personalizado',
        tipo: 'texto',
        visivelSe: (c) => c.campo === 'Campo personalizado',
      },
      { k: 'op', rotulo: 'Condição', tipo: 'select', opcoes: OPS },
      { k: 'valor', rotulo: 'Valor', tipo: 'texto' },
    ],
    resumo: (c) =>
      `${c.campo === 'Campo personalizado' ? c.chave || 'campo' : c.campo} ${c.op} ${c.valor || '—'}`,
  },

  loop: {
    nome: 'Repetir',
    grupo: 'Controle',
    corpo: true,
    descricao:
      'Repete o bloco interno até bater o limite ou até a condição de saída acontecer. O teto de tentativas do sistema continua valendo por cima.',
    campos: [
      { k: 'max', rotulo: 'Repetições no máximo', tipo: 'select', opcoes: ['2', '3', '4'] },
      {
        k: 'sair',
        rotulo: 'Sair antes quando',
        tipo: 'select',
        opcoes: ['O lead responder', 'O lead for qualificado', 'Nunca (só pelo limite)'],
      },
    ],
    resumo: (c) => `até ${c.max}x · sai quando: ${(c.sair ?? '').toLowerCase()}`,
  },

  subfluxo: {
    nome: 'Executar outro fluxo',
    grupo: 'Controle',
    descricao:
      'Chama outro fluxo deste cliente e devolve o resultado. O motor corta a cadeia se um subfluxo voltar ao fluxo que o chamou, para não criar laço infinito.',
    campos: [
      { k: 'alvo', rotulo: 'Fluxo a executar', tipo: 'fluxo' },
      {
        k: 'modo',
        rotulo: 'Depois de chamar',
        tipo: 'select',
        opcoes: [
          'Esperar terminar e seguir',
          'Disparar e seguir na hora',
          'Entregar o lead e encerrar aqui',
        ],
      },
    ],
    resumo: (c) => `${c.alvo || '—'} · ${(c.modo ?? '').toLowerCase()}`,
  },

  webhookout: {
    nome: 'Webhook de saída',
    grupo: 'Integração',
    descricao:
      'Manda os dados do lead para um sistema do cliente no meio do fluxo, com reenvio automático se a resposta não for bem-sucedida.',
    campos: [
      { k: 'url', rotulo: 'URL de destino', tipo: 'texto' },
      { k: 'metodo', rotulo: 'Método', tipo: 'select', opcoes: ['POST', 'PUT', 'PATCH'] },
      {
        k: 'payload',
        rotulo: 'O que enviar',
        tipo: 'select',
        opcoes: ['Lead completo com UTMs', 'Lead e score', 'Só o resultado do contato', 'Personalizado'],
      },
      { k: 'headers', rotulo: 'Cabeçalhos', tipo: 'textarea' },
      {
        k: 'retry',
        rotulo: 'Se falhar',
        tipo: 'select',
        opcoes: ['Tentar de novo 3 vezes', 'Tentar de novo 5 vezes', 'Seguir sem reenviar'],
      },
    ],
    resumo: (c) => `${c.metodo} ${(c.url || '—').replace(/^https?:\/\//, '').slice(0, 32)}`,
  },

  score: {
    nome: 'Qualificar com IA',
    grupo: 'Inteligência',
    descricao:
      'Lê tudo que aconteceu (transcrição, conversa, respostas) e devolve um score de 0 a 100 com o motivo.',
    campos: [
      { k: 'criterio', rotulo: 'Critérios de pontuação', tipo: 'textarea' },
      { k: 'corte', rotulo: 'Nota de corte', tipo: 'select', opcoes: ['50', '60', '70', '80'] },
    ],
    resumo: (c) => `corte em ${c.corte} pontos`,
  },

  agendar: {
    nome: 'Agendar reunião',
    grupo: 'Inteligência',
    descricao:
      'Oferece horários da agenda do time do cliente dentro da própria conversa e confirma o compromisso.',
    campos: [
      { k: 'agenda', rotulo: 'Agenda', tipo: 'agenda' },
      {
        k: 'distribuicao',
        rotulo: 'Entre as agendas',
        tipo: 'select',
        opcoes: ['Rodízio entre consultores', 'Primeira disponível'],
        // Com uma agenda só não há entre quem distribuir, e o campo só
        // confundiria quem abre o inspetor.
        visivelSe: (c) => roteamentoDaEtapa(c).calendario === null,
      },
      { k: 'dur', rotulo: 'Duração', tipo: 'select', opcoes: ['15 minutos', '30 minutos', '45 minutos'] },
      {
        k: 'lembrete',
        rotulo: 'Lembrete antes',
        tipo: 'select',
        opcoes: ['1 hora', '24 horas', 'Não enviar'],
      },
    ],
    resumo: (c) => {
      const r = roteamentoDaEtapa(c)
      const onde = r.calendario ?? (r.rodizio ? 'rodízio entre as agendas' : 'primeira agenda livre')
      return `${c.dur ?? '30 minutos'} · ${onde} · lembrete: ${(c.lembrete ?? 'não enviar').toLowerCase()}`
    },
  },

  marcar: {
    nome: 'Marcar lead',
    grupo: 'Controle',
    descricao:
      'Grava uma etiqueta no lead para usar depois em condições, relatórios ou em outro fluxo.',
    campos: [{ k: 'tag', rotulo: 'Etiqueta', tipo: 'texto' }],
    resumo: (c) => c.tag || 'sem etiqueta',
  },

  entregar: {
    nome: 'Entregar ao time',
    grupo: 'Saída',
    descricao: 'Manda o lead com score, resumo e transcrição para onde o cliente trabalha.',
    campos: [
      {
        k: 'destino',
        rotulo: 'Destino',
        tipo: 'select',
        opcoes: ['CRM do cliente', 'E-mail do time', 'Planilha compartilhada', 'Webhook do cliente'],
      },
      {
        k: 'urgente',
        rotulo: 'Avisar na hora se o score for alto',
        tipo: 'select',
        opcoes: ['Sim', 'Não'],
      },
    ],
    resumo: (c) => `${c.destino}${c.urgente === 'Sim' ? ' · alerta imediato' : ''}`,
  },

  encerrar: {
    nome: 'Encerrar',
    grupo: 'Saída',
    descricao:
      'Fecha o ciclo do lead e grava o motivo. Nenhuma tentativa nova acontece depois disso.',
    campos: [
      {
        k: 'motivo',
        rotulo: 'Marcar como',
        tipo: 'select',
        opcoes: ['Não respondeu', 'Sem interesse', 'Pediu para não ser contatado', 'Fora do perfil'],
      },
    ],
    resumo: (c) => c.motivo ?? '',
  },
}

export const GRUPOS = ['Início', 'Controle', 'Canais', 'Integração', 'Inteligência', 'Saída'] as const

/** Valores iniciais de uma etapa nova: primeira opção de cada select, vazio no resto. */
export function cfgPadrao(tipo: TipoEtapa): Record<string, string> {
  const cfg: Record<string, string> = {}
  for (const campo of ETAPAS[tipo].campos) {
    cfg[campo.k] = campo.tipo === 'select' ? (campo.opcoes?.[0] ?? '') : ''
  }
  return cfg
}
