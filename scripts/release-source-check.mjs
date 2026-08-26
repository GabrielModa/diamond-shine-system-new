import { execFileSync } from 'node:child_process'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

try {
  const branch = git(['branch', '--show-current'])
  if (branch !== 'main') throw new Error(`Release candidate must be checked from main, found ${branch || '(detached)'}.`)

  const dirty = git(['status', '--porcelain'])
  if (dirty) throw new Error('Working tree is not clean.')

  const head = git(['rev-parse', 'HEAD'])
  let upstream
  try { upstream = git(['rev-parse', '@{u}']) } catch { throw new Error('main has no configured upstream.') }
  if (head !== upstream) throw new Error('Local main is not at the same commit as its upstream.')

  const expectedTag = process.env.RELEASE_TAG?.trim()
  const tags = git(['tag', '--points-at', 'HEAD']).split(/\r?\n/).filter(Boolean)
  if (expectedTag && !tags.includes(expectedTag)) throw new Error(`Expected release tag ${expectedTag} does not point at HEAD.`)

  console.log(`✓ clean synced main at ${head.slice(0, 12)}`)
  console.log(tags.length ? `✓ tags at HEAD: ${tags.join(', ')}` : '• no tag at HEAD yet (set RELEASE_TAG to require one)')
} catch (error) {
  console.error(`Release source check failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
