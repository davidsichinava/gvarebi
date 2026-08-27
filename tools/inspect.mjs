// Minimal CDP driver: opens a page, collects console output and uncaught
// exceptions, probes the DOM and the map, and writes a screenshot.
// No Playwright dependency — it drives a Chromium binary directly.
//
//   node tools/inspect.mjs <url> [out.png] [waitMs]
//   SWIFTSHADER=1 node tools/inspect.mjs ...   # software WebGL
//   OFFLINE=1 node tools/inspect.mjs ...       # every host but localhost is
//                                              # unresolvable — proves the page
//                                              # needs nothing from the network
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

// First Chromium that exists wins; CHROME overrides. The list covers the CI
// image, the three desktop platforms and Edge, which is the same engine.
const CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]
const CHROME = process.env.CHROME || CANDIDATES.find((p) => existsSync(p))
if (!CHROME) {
  console.error('No Chromium found. Set CHROME to a binary, or install Chrome.')
  console.error('Looked in: ' + CANDIDATES.join(', '))
  process.exit(1)
}
const [url, out, waitMs = '8000'] = process.argv.slice(2)
const PORT = 9400 + Math.floor(Math.random() * 400)

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
  ...(process.env.SWIFTSHADER
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--disable-gpu']),
  // Not Chrome's offline emulation, which only sets navigator.onLine: this
  // makes DNS genuinely fail for everything except the local server, so any
  // surviving dependency on a CDN shows up as a load error rather than silence.
  ...(process.env.OFFLINE ? ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] : []),
  `--window-size=${process.env.W || 1440},${process.env.H || 900}`, `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: 'ignore' })

let target
for (let i = 0; i < 80 && !target; i++) {
  await sleep(250)
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
    target = list.find((t) => t.type === 'page')
  } catch {}
}
if (!target) { chrome.kill(); throw new Error('chrome did not come up') }

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let id = 0
const pending = new Map()
const logs = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  else if (m.method === 'Runtime.consoleAPICalled')
    logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
  else if (m.method === 'Runtime.exceptionThrown')
    logs.push(`[EXCEPTION] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`)
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
    logs.push(`[network] ${m.params.entry.text}`)
}
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })

const PROBE = `(function () {
  var r = { rows: document.querySelectorAll('tbody tr').length,
            suppressedRows: document.querySelectorAll('tr.off').length,
            canvas: !!document.querySelector('canvas'),
            head: (document.body.innerText || '').slice(0, 46).replace(/\\n/g, ' | ') }
  var m = window.__map
  if (!m) { r.map = 'not exposed'; return JSON.stringify(r) }
  if (typeof m.getPaintProperty !== 'function') { r.map = 'not a Map'; return JSON.stringify(r) }
  try {
    var fc = m.getPaintProperty('areas-fill', 'fill-color')
    r.map = {
      layers: m.getStyle().layers.map(function (l) { return l.id }).join(','),
      srcFeatures: m.querySourceFeatures('areas').length,
      fill: Array.isArray(fc) ? fc[0] + ' over ' + ((fc.length - 3) / 2) + ' areas' : String(fc),
      kdeLayer: !!m.getLayer('kde'),
      rendered: m.queryRenderedFeatures({ layers: ['areas-fill'] }).length
    }
    var c = m.getCanvas(), t = document.createElement('canvas')
    t.width = 120; t.height = 80
    var tx = t.getContext('2d')
    tx.drawImage(c, 0, 0, 120, 80)
    var d = tx.getImageData(0, 0, 120, 80).data, seen = {}
    for (var i = 0; i < d.length; i += 4) seen[d[i] + ',' + d[i + 1] + ',' + d[i + 2]] = 1
    r.map.distinctColours = Object.keys(seen).length
  } catch (e) { r.map = 'probe failed: ' + e.message }
  return JSON.stringify(r)
})()`

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: Number(process.env.W || 1440), height: Number(process.env.H || 900), deviceScaleFactor: 1, mobile: !!process.env.W })
await send('Page.navigate', { url })
await sleep(Number(waitMs))

const probe = await send('Runtime.evaluate', { expression: PROBE, returnByValue: true })
console.log('PROBE', probe.result?.value ?? probe.exceptionDetails?.exception?.description)

if (out) {
  await sleep(600)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true })
  writeFileSync(out, Buffer.from(data, 'base64'))
}

// fonts.g and cartocdn used to be filtered out here. Nothing should reach
// either host now — the fonts are in src/fonts and the tiles in public/tiles —
// so a message naming one is a regression worth seeing, not noise.
const noise = /favicon|non-JavaScript MIME/i
for (const l of logs) if (!noise.test(l)) console.log(l)
console.log(`(${logs.filter((l) => noise.test(l)).length} network/font messages suppressed)`)

ws.close(); chrome.kill()
process.exit(0)
