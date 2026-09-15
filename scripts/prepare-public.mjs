import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Creates a reviewable source repository without inheriting private Git history.
// No remote is configured and nothing is pushed or published.
const destination = resolve('publication/source')
if (existsSync(destination))
  throw new Error(
    'publication/source already exists. Review or move it before preparing another copy.'
  )
execFileSync(process.execPath, ['scripts/scan-public.mjs'], { stdio: 'inherit' })
const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter(Boolean)
for (const file of new Set(files)) {
  if (!existsSync(file)) continue
  if (/^(?:\.git|\.local|publication|node_modules|out|dist)(?:\/|$)/.test(file)) continue
  if (/^\.env(?:\.|$)/.test(file) && file !== '.env.example')
    throw new Error('Refusing to export local environment configuration.')
  const target = resolve(destination, file)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(file, target)
}
execFileSync('git', ['init', '-b', 'main', destination], { stdio: 'inherit' })
const git = (args) =>
  execFileSync('git', ['-C', destination, '-c', 'core.hooksPath=/dev/null', ...args], {
    stdio: 'inherit'
  })
git(['add', '.'])
git([
  '-c',
  'user.name=msmece',
  '-c',
  'user.email=msmece@users.noreply.github.com',
  '-c',
  'commit.gpgsign=false',
  'commit',
  '-m',
  'Prepare documented, privacy-reviewed source release'
])
console.log(
  'Prepared publication/source with fresh history and no remote. Review before publication.'
)
