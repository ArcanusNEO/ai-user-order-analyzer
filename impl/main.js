import { parseArgs } from 'node:util'
import SREDBManager from '../utils/SREDBManager.js'
import retry from '../utils/retry.js'
import * as pg from '../utils/postgres.js'

const parseOptions = () => {
  const args = parseArgs({
    options: {
      verbose: { type: 'boolean', short: 'v', default: false },
      token: { type: 'string', short: 't' },
    },
    strict: false,
    allowNegative: true,
    allowPositionals: true,
  })
  const ret = args.values
  if (!ret.token) ret.token = process.env.SRE_DB_MGR_TOKEN
  if (!ret.token) throw Error('missing token')
  if (args.positionals.length === 1)
    ret.date = new Date(args.positionals[0])
  if (!ret.date || isNaN(ret.date.getTime()))
    ret.date = new Date()
  return ret
}

export const { verbose, token, date } = parseOptions()

const db = SREDBManager(token, { verbose })

const queryInvoice = async (type, begin, end) => {
  const categorys = await retry(async () => {
    const response = await fetch(`https://api.unity.cn/v1/items?categorySlug=${['tuanjie-ai-agent', 'tuanjie-ai-agent-topup'][type]}`)
    if (!response.ok)
      throw Error(`Failed to connect to Unity API: ${response}`)
    return response.json()
  })
  if (!categorys?.results?.length) return []
  const allItems = categorys.results.map(item => item.id)
  const categoryIdMap = Object.fromEntries(categorys.results.map(item => [item.id, item]))
  const { rows } = await db.query(
    'gen-np-prd-shard-30',
    `
select
item ->> 'genesisSubscriptionId' subscription_id,
item ->> 'invoiceItemId' invoice_item_id,
i.order_id,
item ->> 'itemId' item_id,
${['i.invoice_type', 'i.type'][type]} invoice_type,
i.d365_invoice_payload -> 'organization' ->> 'organizationId' user_id,
i.d365_invoice_payload -> 'organization' ->> 'name' user_name,
i.d365_invoice_payload -> 'organization' ->> 'email' email,
item ->> 'description' plan_name,
(item ->> 'quantity')::bigint quantity,
(item ->> 'lineAmount')::numeric + (item ->> 'taxAmount')::numeric amount,
i.currency,
i.pi_type payment_method,
(item ->> 'lineAmount')::numeric = 0 is_gift,
case when (item ->> 'quantity')::bigint >= 0 then 'success' else 'refunded' end status,
i.created_time paid_at,
item ->> 'paymentEndDate' expires_at,
i.created_time,
i.updated_time,
item,
i.d365_invoice_payload payload,
current_timestamp synced_at
from ${['subscription.subscription_d365_invoice', 'invoice.invoice'][type]} i
cross join lateral json_array_elements(i.d365_invoice_payload -> 'invoiceItems') item
where i.updated_time >= '${begin.toISOString()}'
  and i.updated_time < '${end.toISOString()}'
  and item ->> 'itemId' in ${"('" + allItems.join("','") + "')"}`
  )
  if (!rows.length) return []
  const ret = []

  for (const row of rows) {
    if (row.invoice_item_id == null || row.item_id == null) continue
    const category = categoryIdMap[row.item_id]
    if (!category) continue
    row.plan_type = category.type
    row.paid_at &&= new Date(row.paid_at)
    row.expires_at &&= new Date(row.expires_at)
    row.created_time = new Date(row.created_time)
    row.updated_time = new Date(row.updated_time)
    row.synced_at = new Date(row.synced_at)
    ret.push(row)
  }
  return ret
}

const upsertInvoice = async (rows) => {
  if (!rows?.length) return
  return Promise.all(rows.map(row => {
    const { subscription_id, invoice_item_id, order_id, item_id, invoice_type, user_id, user_name, email, plan_name, plan_type, quantity, amount, currency, payment_method, is_gift, status, paid_at, expires_at, created_time, updated_time, item, payload, synced_at } = row
    return pg.query(
      `insert into ai_dashboard.user_payment (subscription_id, invoice_item_id, order_id, item_id, invoice_type, user_id, user_name, email, plan_name, plan_type, quantity, amount, currency, payment_method, is_gift, status, paid_at, expires_at, created_at, updated_at, item, payload, synced_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) on conflict (invoice_item_id) do update set subscription_id = excluded.subscription_id, invoice_item_id = excluded.invoice_item_id, order_id = excluded.order_id, item_id = excluded.item_id, invoice_type = excluded.invoice_type, user_id = excluded.user_id, user_name = excluded.user_name, email = excluded.email, plan_name = excluded.plan_name, plan_type = excluded.plan_type, quantity = excluded.quantity, amount = excluded.amount, currency = excluded.currency, payment_method = excluded.payment_method, is_gift = excluded.is_gift, status = excluded.status, paid_at = excluded.paid_at, expires_at = excluded.expires_at, created_at = excluded.created_at, updated_at = excluded.updated_at, item = excluded.item, payload = excluded.payload, synced_at = excluded.synced_at`,
      [subscription_id, invoice_item_id, order_id, item_id, invoice_type, user_id, user_name, email, plan_name, plan_type, quantity, amount, currency, payment_method, is_gift, status, paid_at, expires_at, created_time, updated_time, item, payload, synced_at]
    )
  }))
}

export default async () => {
  const begin = new Date(date)
  // begin.setDate(begin.getDate() - 60)
  begin.setMinutes(begin.getMinutes() - 23)
  const end = new Date(date)
  const rows = [...await queryInvoice(0, begin, end), ...await queryInvoice(1, begin, end)]
  return upsertInvoice(rows)
}
