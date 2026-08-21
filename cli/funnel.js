#!/usr/bin/env node
import funnel, { verbose, date } from '../impl/funnel.js'

try {
  const answer = await funnel(date)
  console.log(JSON.stringify(answer.lite))
  if (verbose) console.error(JSON.stringify(answer.full))
} catch (err) {
  console.error(err)
  process.exit(1)
}
