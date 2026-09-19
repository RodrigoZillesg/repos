/** O que cada papel pode ver e fazer.
 *
 *  A promessa do artefato é literal: designer e copywriter entram no painel sem
 *  enxergar fluxos, clientes nem dados de lead. Isso está aqui em um lugar só e
 *  é aplicado no servidor, não escondendo botão no cliente — esconder botão não
 *  é controle de acesso. */

export type Papel = 'admin' | 'operacao' | 'designer' | 'copy' | 'cliente'

export interface Permissoes {
  verFluxos: boolean
  editarFluxos: boolean
  verLeads: boolean
  verClientes: boolean
  administrar: boolean
  /** Canais cujos templates o papel pode editar. */
  templates: ReadonlyArray<'email' | 'whatsapp' | 'sms'>
  /** Enxerga apenas o próprio cliente. */
  escopoCliente: boolean
}

export const PERMISSOES: Record<Papel, Permissoes> = {
  admin: {
    verFluxos: true,
    editarFluxos: true,
    verLeads: true,
    verClientes: true,
    administrar: true,
    templates: ['email', 'whatsapp', 'sms'],
    escopoCliente: false,
  },
  operacao: {
    verFluxos: true,
    editarFluxos: true,
    verLeads: true,
    verClientes: true,
    administrar: false,
    templates: ['email', 'whatsapp', 'sms'],
    escopoCliente: false,
  },
  designer: {
    verFluxos: false,
    editarFluxos: false,
    verLeads: false,
    verClientes: false,
    administrar: false,
    templates: ['email'],
    escopoCliente: false,
  },
  copy: {
    verFluxos: false,
    editarFluxos: false,
    verLeads: false,
    verClientes: false,
    administrar: false,
    templates: ['whatsapp', 'sms', 'email'],
    escopoCliente: false,
  },
  cliente: {
    verFluxos: false,
    editarFluxos: false,
    verLeads: true,
    verClientes: false,
    administrar: false,
    templates: [],
    escopoCliente: true,
  },
}

export const DESCRICAO_PAPEL: Record<Papel, { pt: string; en: string }> = {
  admin: {
    pt: 'Enxerga tudo: clientes, fluxos, templates e dados de lead.',
    en: 'Sees everything: clients, flows, templates and lead data.',
  },
  operacao: {
    pt: 'Monta e ajusta fluxos, edita templates, não administra contas.',
    en: 'Builds and tunes flows, edits templates, does not manage accounts.',
  },
  designer: {
    pt: 'Entra só na biblioteca de e-mail. Não vê fluxos, clientes nem dados de lead.',
    en: 'Email library only. No flows, no clients, no lead data.',
  },
  copy: {
    pt: 'Escreve os textos de WhatsApp, SMS e e-mail. Não vê fluxos nem dados de lead.',
    en: 'Writes WhatsApp, SMS and email copy. No flows, no lead data.',
  },
  cliente: {
    pt: 'Somente leitura dos próprios leads e resultados.',
    en: 'Read-only access to their own leads and outcomes.',
  },
}
