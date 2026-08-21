#!/usr/bin/env node
import main, { verbose, date } from '../impl/main.js'
import DateUtils from '../utils/date.js'
import retry from '../utils/retry.js'
import * as pg from '../utils/postgres.js'
import * as feishu from '../utils/feishu.js'

try {
  const answer = await retry(async () => main(date), { delay: 60000 })
  console.log(JSON.stringify(answer.lite))
  if (verbose) console.log(JSON.stringify(answer.full))
  await pg.query(
    'insert into ai_dashboard.funnel (dt, content, detail) values ($1, $2, $3) on conflict (dt) do update set content = excluded.content, detail = excluded.detail',
    [DateUtils['yyyy-MM-dd'](date), answer.lite, answer.full]
  )
} catch (err) {
  console.error(err)
  await feishu.send(process.env.FEISHU_WEBHOOK_URL, err.stack)
} finally {
  pg.close()
}
