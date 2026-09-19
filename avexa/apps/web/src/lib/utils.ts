import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...entradas: ClassValue[]) {
  return twMerge(clsx(entradas))
}

/** Cor da etapa por tipo — a mesma do construtor e do monitor, para que um canal
 *  tenha sempre a mesma cor em toda tela. */
export const CORES: Record<string, string> = {
  ligacao: 'var(--color-canal-ligacao)',
  whatsapp: 'var(--color-canal-whatsapp)',
  sms: 'var(--color-canal-sms)',
  email: 'var(--color-canal-email)',
  entrada: 'var(--color-tinta)',
  guarda: 'var(--color-logica)',
  espera: 'var(--color-logica)',
  condicao: 'var(--color-logica)',
  loop: 'var(--color-logica)',
  subfluxo: 'var(--color-logica)',
  marcar: 'var(--color-logica)',
  webhookout: 'var(--color-hook)',
  score: 'var(--color-ia)',
  agendar: 'var(--color-ia)',
  entregar: 'var(--color-ok)',
  encerrar: 'var(--color-logica)',
}
