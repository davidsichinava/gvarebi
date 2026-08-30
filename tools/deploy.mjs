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
import { existsSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const DRY = process.argv.includes('--dry-run')
const BRANCH = process.env.DEPLOY_BRANCH || 'gh-pages'

const git = (args, cwd = ROOT) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const run = (cmd, args, cwd = ROOT, env = process.env) =>
  execFileSync(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' })

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

// A project site is served from /<repo>/, but a USER or ORG site — a repo named
// <account>.github.io — is served from the root, and so is any custom domain.
// Getting this wrong does not fail: the build succeeds, the deploy succeeds, and
// the page returns 200 while 404ing on its own JavaScript. Hence the assertion
// further down as well.
const isUserSite = /\.github\.io$/i.test(repo)
const base = process.env.BASE_PATH ?? (isUserSite ? '/' : `/${repo}/`)
console.log(`repo   ${repo}\nremote ${remote}\nbase   ${base}\nbranch ${BRANCH}\n`)

// ---------------------------------------------------------------- build
// vite reads the base path from the environment, so it has to reach the child
// process — computing it here and not passing it on was the whole bug: the
// build silently defaulted to '/', every asset came out root-absolute, and the
// deployed page 404'd on its own JavaScript while still returning HTTP 200.
console.log('building…')
run('npm', ['run', 'build'], ROOT, { ...process.env, BASE_PATH: base })

const indexPath = join(DIST, 'index.html')
if (!existsSync(indexPath)) {
  console.error('dist/index.html is missing — the build did not produce a site.')
  process.exit(1)
}
// Assert the base actually took. A wrong base still builds, still deploys, and
// still serves a 200 — it just serves a blank page, which is the hardest kind
// of failure to spot from the outside.
const html = readFileSync(indexPath, 'utf8')
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
const wrong = refs.filter((r) => r.startsWith('/') && !r.startsWith(base))
if (wrong.length) {
  console.error(`
index.html references ${wrong.join(', ')}, which does not start with the base ${base}.`)
  console.error('The site would return 200 and render nothing. Aborting.')
  process.exit(1)
}
console.log(`base applied: ${refs.filter((r) => r.startsWith(base)).length} asset reference(s) under ${base}`)
// Without this, Pages runs the output through Jekyll, which skips files and
// directories beginning with an underscore and slows every deploy down.
writeFileSync(join(DIST, '.nojekyll'), '')

// A custom domain lives in a CNAME file at the root of the published branch.
// Setting the domain in the repository settings makes GitHub commit that file
// to gh-pages — and this script force-pushes an ORPHAN commit, which would
// delete it again, detaching the domain on the very next deploy with no error.
//
// So the domain belongs in public/CNAME, which vite copies into dist like any
// other static file. Then it is part of every build and cannot be lost.
const cnamePath = join(DIST, 'CNAME')
if (existsSync(cnamePath)) {
  const domain = readFileSync(cnamePath, 'utf8').trim()
  console.log(`custom domain: ${domain}  (from public/CNAME)`)
  if (base !== '/') {
    console.error(`
A custom domain serves from the root, but the base is ${base}.`)
    console.error('Set BASE_PATH=/ for this deploy, or remove public/CNAME. Aborting.')
    process.exit(1)
  }
} else {
  console.log('custom domain: none (no public/CNAME) — publishing to the github.io address')
}

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
