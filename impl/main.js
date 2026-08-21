import { parseArgs } from 'node:util'
import SREDBManager from '../utils/SREDBManager.js'
import DateUtils from '../utils/date.js'
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
    ret.date = new Date(DateUtils['yyyy-MM-dd'](new Date()))
  return ret
}

export const { verbose, token, date } = parseOptions()

const querySubs = async (begin, end) => {
  const categorys = await retry(async () => {
    const response = await fetch('https://api.unity.cn/v1/items?categorySlug=tuanjie-ai-agent')
    if (!response.ok)
      throw Error(`Failed to connect to Unity API: ${response}`)
    return response.json()
  })
  if (!categorys?.results?.length) return []
  const allItems = categorys.results.map(item => item.id)
  const categoryIdMap = Object.fromEntries(categorys.results.map(item => [item.id, item]))
  const { rows } = await dbQuery(
    'gen-np-prd-shard-30',
    `select i.order_id, item ->> 'itemId' item_id, i.id, i.d365_invoice_payload -> 'organization' ->> 'organizationId' user_id, i.d365_invoice_payload -> 'organization' ->> 'name' user_name, i.d365_invoice_payload -> 'organization' ->> 'email' email, item ->> 'description' plan_name, cast(item ->> 'quantity' as bigint) quantity, cast(item ->> 'lineAmount' as numeric) + cast(item ->> 'taxAmount' as numeric) amount, i.currency, i.pi_type payment_method, cast(item ->> 'lineAmount' as numeric) = 0 is_gift, o.order_status_id status, o.purchase_time paid_at, item ->> 'paymentEndDate' expires_at, i.created_time, item, i.d365_invoice_payload payload from subscription.subscription_d365_invoice i cross join lateral json_array_elements(d365_invoice_payload -> 'invoiceItems') item join "order".user_order o on i.order_id = o.order_id where i.created_time >= '${begin.toISOString()}' and i.created_time < '${end.toISOString()}' and item ->> 'itemId' in ${"('" + allItems.join("','") + "')"}`
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
  const rows = await pg.query('select * from ai_dashboard.user_payment where (order_id, item_id) = any($1)', [orderItems])
  const ret = []
  for (const row of rows) {
    const {
      order_id,
      item_id,
      max_invoice_id,
      user_id,
      user_name,
      email,
      plan_name,
      plan_type,
      quantity,
      amount,
      currency,
      payment_method,
      is_gift,
      status,
      paid_at,
      expires_at,
      item,
      payload,
      updated_at,
    } = row
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
  const ret = rows[0]
  for (let i = 1; i < rows.length; ++i) {
    ret.orderId = ret.orderId || rows[i].orderId
    ret.itemId = ret.itemId || rows[i].itemId
    ret.maxInvoiceId = ret.maxInvoiceId || rows[i].maxInvoiceId
    ret.userId = ret.userId || rows[i].userId
    ret.userName = ret.userName || rows[i].userName
    ret.email = ret.email || rows[i].email
    ret.planName = ret.planName || rows[i].planName
    ret.planType = ret.planType || rows[i].planType
    ret.quantity = (ret.quantity || 0) + (rows[i].quantity || 0)
    ret.amount = (ret.amount || 0) + (rows[i].amount || 0)
    ret.currency = ret.currency || rows[i].currency
    ret.paymentMethod = ret.paymentMethod || rows[i].paymentMethod
    ret.isGift = ret.isGift || rows[i].isGift
    ret.status = ret.status || rows[i].status
    ret.paidAt = ret.paidAt || rows[i].paidAt
    ret.expiresAt = ret.expiresAt || rows[i].expiresAt
    ret.recordTime = ret.recordTime || rows[i].recordTime
    ret.item = ret.item || rows[i].item
    ret.payload = ret.payload || rows[i].payload
  }
  return ret
}

const db = SREDBManager(token, { verbose })

export default async () => {

}

