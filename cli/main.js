#!/usr/bin/env node
import main from '../impl/main.js'

try {
  await main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
