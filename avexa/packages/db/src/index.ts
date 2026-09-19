import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.ts'

export * as schema from './schema/index.ts'
export * from './schema/index.ts'

let _db: ReturnType<typeof criar> | undefined

function criar(url: string) {
  const sql = postgres(url, { max: 10, prepare: false })
  return drizzle(sql, { schema, casing: 'snake_case' })
}

/** Conexão compartilhada do processo. Lê DATABASE_URL uma vez. */
export function db() {
  if (!_db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL não definida')
    _db = criar(url)
  }
  return _db
}

export type Db = ReturnType<typeof db>
