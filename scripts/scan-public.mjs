import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

// Conservative local check. It supplements dedicated secret scanners and manual review;
// it never prints a matched value, only a filename and rule.
const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter(Boolean)
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    'provider token',
    /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9]{30,})/
  ],
  ['personal machine path', /(?:\/Users\/|C:\\Users\\)[A-Za-z][^\s'"`]+/],
  [
    'non-placeholder registration identifier',
    /\b(?!00000000-0000-0000-0000-000000000000\b)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
  ]
]
let failures = 0
for (const file of new Set(files)) {
  if (!existsSync(file)) continue
  if (/^(?:node_modules|out|dist|publication|\.local)\//.test(file)) continue
  if (/\.(png|ico|icns)$/.test(file)) continue
  const body = readFileSync(file, 'utf8')
  if (/^\.env(?:\.|$)/.test(file) && file !== '.env.example') {
    console.error(`${file}: local configuration must not be tracked`)
    failures++
  }
  for (const [label, pattern] of rules)
    if (pattern.test(body)) {
      console.error(`${file}: ${label}`)
      failures++
    }
  const emails = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  if (
    emails.some(
      (email) =>
        !(
          ['package-lock.json', 'scripts/scan-public.mjs'].includes(file) && email === 'i@izs.me'
        ) && !/@(?:example\.(?:com|org|net)|(?:users\.)?noreply\.github\.com)$/i.test(email)
    )
  ) {
    console.error(`${file}: review non-example email address`)
    failures++
  }
}
console.log(
  `Public-source scan: ${failures} finding(s). Binary assets and Git history require separate review.`
)
process.exitCode = failures ? 1 : 0
