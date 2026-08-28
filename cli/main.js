#!/usr/bin/env node
import main from '../impl/main.js'
import * as pg from '../utils/postgres.js'

try {
  await main()
} catch (err) {
  console.error(err)
  process.exitCode = 1
} finally {
  await pg.close()
}
