export default {
  prevDay: (date) => {
    const prev = new Date(date)
    prev.setUTCDate(prev.getUTCDate() - 1)
    return prev
  },
  nextDay: (date) => {
    const next = new Date(date)
    next.setUTCDate(next.getUTCDate() + 1)
    return next
  },
  'yyyy-MM-dd': (date) => {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}
