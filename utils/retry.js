export default async (taskFn, { delay = 1100, maxRetries = 3, } = {}) => {
  for (let i = 1; i <= maxRetries; ++i) {
    try {
      return await taskFn()
    } catch (err) {
      if (i < maxRetries)
        await new Promise(resolve => setTimeout(resolve, delay))
      else throw err
    }
  }
  throw Error()
}
