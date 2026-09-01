#!/usr/bin/env node
import main from '../impl/main.js'
import retry from '../utils/retry.js'
import * as pg from '../utils/postgres.js'
import * as feishu from '../utils/feishu.js'

try {
  await retry(main, { delay: 60000, maxRetries: 5 })
} catch (err) {
  console.error(err)
  await feishu.send(process.env.FEISHU_WEBHOOK_URL, err.stack)
} finally {
  await pg.close()
}
