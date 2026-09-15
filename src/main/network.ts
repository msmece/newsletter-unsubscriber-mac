import { lookup } from 'node:dns'
import { request } from 'node:https'
import ipaddr from 'ipaddr.js'

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast'
  } catch {
    return false
  }
}

export function externalUrl(value: string): URL {
  const url = new URL(value)
  if (!['https:', 'mailto:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Only secure web links and email links can be opened.')
  if (url.protocol === 'https:') {
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (!hostname.includes('.') && !hostname.includes(':'))
      throw new Error('Local network links are not allowed.')
    if (
      /\.(localhost|local|internal)$/i.test(hostname) ||
      (ipaddr.isValid(hostname) && !isPublicAddress(hostname))
    )
      throw new Error('Local network links are not allowed.')
  }
  return url
}

// DNS is validated in the actual connection's lookup callback, avoiding a separate
// check followed by a second DNS lookup. Redirects are returned, never followed.
export function publicPost(value: string, body: string): Promise<Response> {
  const url = externalUrl(value)
  if (url.protocol !== 'https:' || (url.port && url.port !== '443'))
    throw new Error('Automatic requests require HTTPS on the standard port.')
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        },
        lookup: (hostname, options, callback) => {
          lookup(hostname, { all: true }, (error, addresses) => {
            if (error) {
              callback(error, '', 4)
              return
            }
            if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
              callback(new Error('The destination resolves to a non-public address.'), '', 4)
              return
            }
            if (options.all) callback(null, addresses)
            else callback(null, addresses[0].address, addresses[0].family)
          })
        }
      },
      (response) => {
        // Unsubscribe responses can contain personal HTML; neither store nor parse it.
        response.destroy()
        resolve(new Response(null, { status: response.statusCode ?? 502 }))
      }
    )
    const timer = setTimeout(() => req.destroy(new Error('The request timed out.')), 30000)
    req.on('close', () => clearTimeout(timer))
    req.on('error', reject)
    req.end(body)
  })
}
