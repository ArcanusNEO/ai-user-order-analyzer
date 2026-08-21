#!/usr/bin/env node
import main, { verbose, date } from '../impl/main.js'

try {
  const answer = await main(date)
  console.log(JSON.stringify(answer.lite))
  if (verbose) console.error(JSON.stringify(answer.full))
} catch (err) {
  console.error(err)
  process.exit(1)
}
