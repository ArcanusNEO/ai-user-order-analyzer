import { parseArgs } from 'node:util'
import SREDBManager from '../utils/SREDBManager.js'
import retry from '../utils/retry.js'
import * as pg from '../utils/postgres.js'
import Decimal from 'decimal.js'

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

const queryNew = async (type, begin, end) => {
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
    `select i.order_id, item ->> 'itemId' item_id, i.id, i.d365_invoice_payload -> 'organization' ->> 'organizationId' user_id, i.d365_invoice_payload -> 'organization' ->> 'name' user_name, i.d365_invoice_payload -> 'organization' ->> 'email' email, item ->> 'description' plan_name, cast(item ->> 'quantity' as bigint) quantity, cast(item ->> 'lineAmount' as numeric) + cast(item ->> 'taxAmount' as numeric) amount, i.currency, i.pi_type payment_method, cast(item ->> 'lineAmount' as numeric) = 0 is_gift, o.order_status_id status, o.purchase_time paid_at, item ->> 'paymentEndDate' expires_at, i.created_time, item, i.d365_invoice_payload payload from ${['subscription.subscription_d365_invoice', 'invoice.invoice'][type]} i cross join lateral json_array_elements(i.d365_invoice_payload -> 'invoiceItems') item join "order".user_order o on i.order_id = o.order_id where i.created_time >= '${begin.toISOString()}' and i.created_time < '${end.toISOString()}' and item ->> 'itemId' in ${"('" + allItems.join("','") + "')"}`
  )
  if (!rows.length) return []
  const ret = []
  for (const row of rows) {
    const {
      order_id,
      item_id,
      id,
      user_id,
      user_name,
      email,
      plan_name,
      quantity,
      amount,
      currency,
      payment_method,
      is_gift,
      status,
      paid_at,
      expires_at,
      created_time,
      item,
      payload,
    } = row
    const category = categoryIdMap[item_id]
    if (!category) continue
    ret.push({
      orderId: order_id,
      itemId: item_id,
      maxInvoiceId: id,
      userId: user_id,
      userName: user_name,
      email,
      planName: plan_name,
      planType: category.type,
      quantity,
      amount,
      currency,
      paymentMethod: payment_method,
      isGift: is_gift,
      status,
      paidAt: new Date(paid_at),
      expiresAt: new Date(expires_at),
      recordTime: new Date(created_time),
      item,
      payload,
    })
  }
  return ret
}

const queryUserPayments = async (orderItems) => {
  const { rows } = await pg.query(`select * from ai_dashboard.user_payment where (order_id, item_id) in ${"((" + orderItems.map(row => row.join(',')).join("),(") + "))"}`)
  if (!rows?.length) return []
  const ret = []
  for (const row of rows) {
    const { order_id, item_id, max_invoice_id, user_id, user_name, email, plan_name, plan_type, quantity, amount, currency, payment_method, is_gift, status, paid_at, expires_at, item, payload, updated_at } = row
    ret.push({
      orderId: order_id,
      itemId: item_id,
      maxInvoiceId: max_invoice_id,
      userId: user_id,
      userName: user_name,
      email,
      planName: plan_name,
      planType: plan_type,
      quantity,
      amount,
      currency,
      paymentMethod: payment_method,
      isGift: is_gift,
      status,
      paidAt: paid_at,
      expiresAt: expires_at,
      recordTime: updated_at,
      item,
      payload,
    })
  }
  return ret
}

const mergeRows = (rows) => {
  if (!rows?.length) return null
  rows.sort((a, b) => (a.maxInvoiceId < b.maxInvoiceId) - (a.maxInvoiceId > b.maxInvoiceId))
  const ret = { quantity: new Decimal('0'), amount: new Decimal('0') }
  for (const row of rows) {
    ret.orderId = ret.orderId || row.orderId
    ret.itemId = ret.itemId || row.itemId
    ret.maxInvoiceId = ret.maxInvoiceId || row.maxInvoiceId
    ret.userId = ret.userId || row.userId
    ret.userName = ret.userName || row.userName
    ret.email = ret.email || row.email
    ret.planName = ret.planName || row.planName
    ret.planType = ret.planType || row.planType
    ret.quantity = ret.quantity.plus(new Decimal(row.quantity || '0'))
    ret.amount = ret.amount.plus(new Decimal(row.amount || '0'))
    ret.currency = ret.currency || row.currency
    ret.paymentMethod = ret.paymentMethod || row.paymentMethod
    ret.isGift = ret.isGift || row.isGift
    ret.status = ret.status || row.status
    ret.paidAt = ret.paidAt || row.paidAt
    ret.expiresAt = ret.expiresAt || row.expiresAt
    ret.recordTime = ret.recordTime || row.recordTime
    ret.item = ret.item || row.item
    ret.payload = ret.payload || row.payload
  }
  return ret
}

const merge2Db = async (rows) => {
  if (!rows?.length) return
  const orderItems = [...new Set(rows.map(row => [row.orderId, row.itemId]))]
  const rowsGroup = Object.groupBy(rows, row => `${row.orderId}:${row.itemId}`)
  const records = await queryUserPayments(orderItems)
  const recordsMap = Object.fromEntries(records.map(r => [`${r.orderId}:${r.itemId}`, r]))
  const res = []
  for (const key in rowsGroup) {
    const grp = rowsGroup[key]
    const rec = recordsMap[key]
    const merged = rec ? mergeRows([...grp, rec]) : mergeRows(grp)
    if (rec?.maxInvoiceId >= merged?.maxInvoiceId) continue
    if (merged) res.push(merged)
  }
  for (const row of res) {
    const { orderId, itemId, maxInvoiceId, userId, userName, email, planName, planType, quantity, amount, currency, paymentMethod, isGift, status, paidAt, expiresAt, recordTime, item, payload } = row
    await pg.query(
      `insert into ai_dashboard.user_payment (order_id, item_id, max_invoice_id, user_id, user_name, email, plan_name, plan_type, quantity, amount, currency, payment_method, is_gift, status, paid_at, expires_at, item, payload, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) on conflict (order_id, item_id) do update set max_invoice_id = excluded.max_invoice_id, user_id = excluded.user_id, user_name = excluded.user_name, email = excluded.email, plan_name = excluded.plan_name, plan_type = excluded.plan_type, quantity = excluded.quantity, amount = excluded.amount, currency = excluded.currency, payment_method = excluded.payment_method, is_gift = excluded.is_gift, status = excluded.status, paid_at = excluded.paid_at, expires_at = excluded.expires_at, item = excluded.item, payload = excluded.payload, created_at = excluded.created_at, updated_at = CURRENT_TIMESTAMP`,
      [orderId, itemId, maxInvoiceId, userId, userName, email, planName, planType, quantity, amount, currency, paymentMethod, isGift, status, paidAt, expiresAt, item, payload, recordTime]
    )
  }
}

export default async () => {
  const begin = new Date(date)
  begin.setHours(begin.getHours() - 1)
  begin.setMinutes(begin.getMinutes() - 10)
  const end = new Date(date)
  const rows = [...await queryNew(0, begin, end), ...await queryNew(1, begin, end)]
  await merge2Db(rows)
}

