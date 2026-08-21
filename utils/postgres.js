import { Pool } from 'pg'

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DBNAME,
  user: process.env.PG_USERNAME,
  password: process.env.PG_PASSWORD,
  max: 15,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
})

pool.on('error', (err) => {
  console.error('Unexpected pool error,', err)
})

pool.query('select CURRENT_TIMESTAMP as now', (err, res) => {
  if (err) console.error('Postgres connected error,', err)
  else console.log(`Postgres connected at ${res.rows[0].now}`)
})

export const query = async (text, params) => {
  const start = Date.now()
  try {
    const res = await pool.query(text, params)
    console.log(`Postgres query [${text}, ${params}] finished in ${Date.now() - start} ms`)
    return res
  } catch (err) {
    console.error(`Postgres query [${text}, ${params}] failed in ${Date.now() - start} ms, error=${err}`)
    throw err
  }
}

export const client = () => pool.connect()
export const close = () => pool.end()
