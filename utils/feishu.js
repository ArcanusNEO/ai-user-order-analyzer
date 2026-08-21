import retry from './retry.js'

export const send = async (webhookUrl, message) => {
  try {
    const result = await retry(async () => {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          msg_type: 'text',
          content: {
            text: message
          },
        })
      })
      if (!response.ok)
        throw Error(`Failed to connect to Feishu API: ${response.statusText}`)
      return response.json()
    })
    if (!(result?.code === 0))
      throw Error(`Failed to send Feishu message: ${result?.msg || JSON.stringify(result)}`)
    return result
  } catch (err) {
    console.error(err)
    return null
  }
}
