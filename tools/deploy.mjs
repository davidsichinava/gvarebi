// Publish dist/ to the gh-pages branch as a single force-orphan commit.
//
//   npm run deploy                     # infers the repo from `origin`
//   BASE_PATH=/ npm run deploy         # a user site or a custom domain
//   npm run deploy -- --dry-run        # build and stage, push nothing
//
// Why not commit the site, or build it in CI? The payload is ~75 MB across 515
// files and the tile cache another 7 MB, all of it derived and all of it
// rebuildable in about three minutes. Putting that in the main branch would
// grow its history by that much on every refresh, permanently. Instead the
// branch is rewritten from nothing each time: `git init` in a throwaway repo,
// one commit, force-push. gh-pages therefore always holds exactly one commit
// and never accumulates. Git LFS is not the answer either — Pages serves LFS
// pointer files rather than their contents.
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const DRY = process.argv.includes('--dry-run')
const BRANCH = process.env.DEPLOY_BRANCH || 'gh-pages'

const git = (args, cwd = ROOT) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const run = (cmd, args, cwd = ROOT) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })

// ---------------------------------------------------------------- remote
let remote
try {
  remote = git(['remote', 'get-url', 'origin'])
} catch {
  console.error('No `origin` remote. Create the repository first, then:')
  console.error('  git remote add origin https://github.com/<you>/<repo>.git')
  process.exit(1)
}
// Both https://github.com/u/r.git and git@github.com:u/r.git
const repo = remote.replace(/\.git$/, '').split(/[/:]/).pop()

// A project site is served from /<repo>/; a user site or custom domain from /.
const base = process.env.BASE_PATH ?? `/${repo}/`
console.log(`repo   ${repo}\nremote ${remote}\nbase   ${base}\nbranch ${BRANCH}\n`)

// ---------------------------------------------------------------- build
console.log('building…')
run('npm', ['run', 'build'], ROOT)

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/index.html is missing — the build did not produce a site.')
  process.exit(1)
}
// Without this, Pages runs the output through Jekyll, which skips files and
// directories beginning with an underscore and slows every deploy down.
writeFileSync(join(DIST, '.nojekyll'), '')

const count = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).length
console.log(`\ndist: ${count(DIST)} files`)

// ---------------------------------------------------------------- publish
// A throwaway repo inside dist. Nothing here touches the working repository, so
// a failed deploy cannot leave the main branch in a strange state.
rmSync(join(DIST, '.git'), { recursive: true, force: true })
git(['init', '-q'], DIST)
git(['symbolic-ref', 'HEAD', `refs/heads/${BRANCH}`], DIST)
git(['add', '-A'], DIST)
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
git(['-c', 'user.name=deploy', '-c', 'user.email=deploy@localhost',
     'commit', '-q', '-m', `site build ${stamp}`], DIST)

if (DRY) {
  console.log(`\ndry run — staged on ${BRANCH}, nothing pushed.`)
  process.exit(0)
}
console.log(`\npushing to ${BRANCH}…`)
run('git', ['push', '-f', remote, `HEAD:refs/heads/${BRANCH}`], DIST)
rmSync(join(DIST, '.git'), { recursive: true, force: true })
console.log(`\ndone. In the repository settings, set Pages to deploy from the ${BRANCH} branch, root.`)
