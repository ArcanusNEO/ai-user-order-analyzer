import retry from './retry.js'

export default (token, { verbose = false, } = {}) => {
  const CONNECTION = {
    'gen-p-prd-shard-30': '5dba6c03-abda-429c-8d23-7979f2e48ff9',
    'volc-cdp-prd-starrocks-tuanjie_analytics': 'd68a603e-16fa-414f-8099-ad4db102e618',
    'codesearch-prd-psql-readonly': 'bef50473-8dfa-46f7-b248-5fb36766e098',
    'litellm-prd-psql-readonly': 'a1f5949e-8a61-41b9-99ef-b59b03a7c5ac',
  }
  return {
    query: async (conn, sql) => {
      if (verbose)
        console.error(JSON.stringify({
          connectionId: CONNECTION[conn],
          sql,
        }))
      const result = await retry(async () => {
        const response = await fetch('https://sre-db-manager.internal.unity.cn/api/mcp', {
          method: 'POST',
          headers: {
            Authorization: token,
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
              name: 'execute_query',
              "arguments": {
                connectionId: CONNECTION[conn],
                sql,
              }
            },
            id: 1,
          })
        })
        if (!response.ok)
          throw Error(`Failed to connect to SREDBManager API: ${response.statusText}`)
        const ret = await response.json()
        const text = ret?.result?.content?.[0].text
        const isError = ret?.result?.isError
        if (!text || isError === true) throw Error(text || JSON.stringify(ret))
        return JSON.parse(text)
      })
      if (!result || result.truncated) throw Error('Query result truncated')
      return result
    }
  }
}
