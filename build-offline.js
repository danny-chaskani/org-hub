#!/usr/bin/env node
/* build-offline: builds dist/org-hub-offline.html (a single self-contained file) from index.html.
   Usage:  node build-offline.js [--version 1.2.3]
   index.html is never modified. See dist/README.md. */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'index.html');
const OUT = path.join(DIST, 'org-hub-offline.html');

const argv = process.argv.slice(2);
const vi = argv.indexOf('--version');
const VERSION = vi >= 0 ? argv[vi + 1] : (process.env.HUB_VERSION || '1.0.0');
const BUILD_DATE = new Date().toISOString().slice(0, 10);
let commit = '';
try { commit = cp.execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* not a git checkout */ }

function read(p) { return fs.readFileSync(p, 'utf8'); }
function fail(msg) { console.error('build-offline: ' + msg); process.exit(1); }

let html = read(SRC).replace(/\r\n/g, '\n');

/* replace exactly one occurrence (a function replacer, so "$" in the payload is never interpreted) */
function swap(re, payload, what) {
  const m = html.match(re);
  if (!m) fail('not found in index.html: ' + what);
  html = html.replace(re, () => payload);
}
const safeScript = (js) => js.replace(/<\/(script)/gi, '<\\/$1').replace(/\/\/# sourceMappingURL=.*$/gm, '');

/* 1. fonts: the four weights in use, as base64 */
const weights = [400, 500, 600, 700];
const faces = weights.map((w) => {
  const b64 = fs.readFileSync(path.join(DIST, 'fonts', 'IBMPlexSansHebrew-' + w + '.ttf')).toString('base64');
  return "@font-face{font-family:'IBM Plex Sans Hebrew';font-style:normal;font-weight:" + w + ';font-display:swap;src:url(data:font/ttf;base64,' + b64 + ") format('truetype');}";
}).join('\n');
swap(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*<link href="https:\/\/fonts\.googleapis\.com\/css2[^>]*>/, '<link rel="icon" href="data:,">' + String.fromCharCode(10) + '<style id="offline-fonts">\n' + faces + '\n</style>', 'Google Fonts links');

/* 2. libraries, same versions as index.html: xlsx 0.18.5, Chart.js 4.4.0 */
const libPayloads = [
  '<script>/* SheetJS xlsx 0.18.5 (Apache-2.0) */\n' + safeScript(read(path.join(DIST, 'vendor', 'xlsx.full.min.js'))) + '\n</script>',
  '<script>/* Chart.js 4.4.0 (MIT) */\n' + safeScript(read(path.join(DIST, 'vendor', 'chart.umd.min.js'))) + '\n</script>'
];
swap(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/0\.18\.5\/xlsx\.full\.min\.js"><\/script>/, libPayloads[0], 'xlsx script');
swap(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/4\.4\.0\/chart\.umd\.min\.js"><\/script>/, libPayloads[1], 'Chart.js script');

/* 3. Cloudflare analytics beacon */
swap(/<script type="module" src="https:\/\/static\.cloudflareinsights\.com[^>]*><\/script>\s*/, '', 'Cloudflare beacon');

/* 4. version + build date, shown bottom corner and exposed as window.HUB_BUILD */
const build = { version: VERSION, date: BUILD_DATE, commit: commit, variant: 'offline' };
const badge = '<style>#hubBuildInfo{position:fixed;bottom:4px;left:8px;z-index:5;font-size:11px;opacity:.55;pointer-events:none;direction:rtl;font-family:inherit}@media print{#hubBuildInfo{display:none}}</style>\n'
  + '<div id="hubBuildInfo" aria-hidden="true">גרסה ' + VERSION + ' · נבנה ' + BUILD_DATE + (commit ? ' · ' + commit : '') + '</div>\n'
  + '<script>window.HUB_BUILD=' + JSON.stringify(build) + ';</script>\n';
if (!/<\/body>/.test(html)) fail('no </body>');
const bodyEnd = html.lastIndexOf('</body>');
html = html.slice(0, bodyEnd) + badge + html.slice(bodyEnd);

/* 5. verification: nothing may load from the network at run time; no test code */
const problems = [];
const stripped = html
  .replace(/<script id="__never"><\/script>/g, '')
  .replace(/data:font\/ttf;base64,[A-Za-z0-9+/=]+/g, 'data:font');
/* app part only = everything outside the two embedded libraries */
let appPart = stripped;
libPayloads.forEach((p) => { appPart = appPart.split(p).join(''); });
const urls = (appPart.match(/https?:\/\/[^\s"'<>)\\]+/g) || []).filter((u) => !/^https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml)/.test(u));
if (urls.length) problems.push('URLs left in app code: ' + urls.join(', '));
if (/cdn-cgi|cloudflareinsights|fonts\.googleapis|fonts\.gstatic|cdnjs\./.test(appPart)) problems.push('CDN reference left in app code');
if (/<script[^>]+\bsrc\s*=/i.test(html)) problems.push('external <script src> left');
if (/<link[^>]+href\s*=\s*["']https?:/i.test(html)) problems.push('external <link> left');
if (/@import\s+url\(\s*["']?https?:/i.test(html)) problems.push('CSS @import over network');
if (/__regress|__perfSeed|__perfUsers|__loginAs|\.taste-skill|__r6Teardown/.test(html)) problems.push('test hooks present');
if (problems.length) fail('verification failed:\n - ' + problems.join('\n - '));

/* LF only, like index.html */
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('built ' + path.relative(ROOT, OUT) + '  ' + kb + ' KB  version ' + VERSION + '  date ' + BUILD_DATE + (commit ? '  commit ' + commit : ''));
console.log('runtime URLs in app code (excluding svg namespaces): none');
