#!/usr/bin/env node
/*
  Records the project videos shown in the Projects section.

    npm run videos                 every video in src/data/videos.json
    npm run videos -- geoposball   only the named ones

  Each video is the page src/pages/video/[slug].astro, played frame by frame in a headless
  Chromium browser and encoded with ffmpeg. Output: public/videos/<slug>.mp4 and its poster
  public/videos/<slug>.jpg, which are committed with the site.

  Needs ffmpeg on the PATH and Chrome, Chromium, Edge or Brave. Set CHROME_PATH when the browser
  is somewhere unusual, and CHROME_ARGS for extra flags (for example "--no-sandbox" in a container).
*/
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, '.video-build');
const outDir = path.join(root, 'public', 'videos');

const FPS = 30;
const WIDTH = 1280;
const HEIGHT = 720;
const SCALE = 1.5; // 1280x720 layout recorded at 1920x1080
const POSTER_AT = 3.5; // seconds: the title scene, fully in
const HOLD = 1.5; // seconds the last frame stays on screen

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  console.error(`render-videos: ${message}`);
  process.exit(1);
}

// ---------- 1. Build the site with the video pages switched on ----------

const all = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'src/data/videos.json'), 'utf8')));
const wanted = process.argv.slice(2);
const unknown = wanted.filter((slug) => !all.includes(slug));
if (unknown.length) fail(`no video named ${unknown.join(', ')}. Known: ${all.join(', ')}`);
const slugs = wanted.length ? wanted : all;

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) fail('ffmpeg is not on the PATH');

console.log('Building the video pages...');
const build = spawnSync(process.execPath, [path.join(root, 'node_modules/astro/bin/astro.mjs'), 'build', '--outDir', buildDir, '--silent'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, RENDER_VIDEOS: '1' },
});
if (build.status !== 0) fail('the build failed');

// ---------- 2. Serve the build (with byte ranges, which video seeking needs) ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

const server = http.createServer((req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = path.join(buildDir, rel);
  if (!file.startsWith(buildDir)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }

  const size = fs.statSync(file).size;
  const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    fs.createReadStream(file).pipe(res);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---------- 3. Start the browser ----------

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/brave',
    '/usr/bin/brave-browser',
    '/opt/brave-bin/brave',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

const browserPath = findBrowser();
if (!browserPath) fail('no Chromium-based browser found; set CHROME_PATH');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-videos-'));
const browser = spawn(
  browserPath,
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${WIDTH},${HEIGHT}`,
    ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(/\s+/).filter(Boolean) : []),
    'about:blank',
  ],
  { stdio: 'ignore' },
);

function cleanUp() {
  try {
    browser.kill();
  } catch {
    // already gone
  }
  for (const file of fs.existsSync(outDir) ? fs.readdirSync(outDir) : []) {
    if (file.endsWith('.partial.mp4')) fs.rmSync(path.join(outDir, file), { force: true });
  }
  server.close();
  for (const dir of [profile, buildDir]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // a locked profile is left for the OS to clear
    }
  }
}

process.on('SIGINT', () => {
  cleanUp();
  process.exit(130);
});

let debugPort = null;
for (let i = 0; i < 150 && !debugPort; i++) {
  await sleep(100);
  try {
    debugPort = parseInt(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'), 10) || null;
  } catch {
    // not written yet
  }
}
if (!debugPort) {
  cleanUp();
  fail('the browser did not start (in a container, try CHROME_ARGS="--no-sandbox")');
}

// ---------- 4. Talk to the page over the DevTools protocol ----------

let target = null;
for (let i = 0; i < 50 && !target; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    target = targets.find((entry) => entry.type === 'page');
  } catch {
    // the endpoint is not up yet
  }
  if (!target) await sleep(100);
}
if (!target) {
  cleanUp();
  fail('could not open a browser tab');
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const listeners = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  } else if (message.method && listeners.has(message.method)) {
    listeners.get(message.method)(message.params);
    listeners.delete(message.method);
  }
});

// A browser that stops answering (a crash, a laptop that went to sleep) ends the run with a
// message instead of leaving it waiting for ever.
const REPLY_TIMEOUT = 60000;

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`the browser did not answer ${method} within ${REPLY_TIMEOUT / 1000} s; run the command again`));
    }, REPLY_TIMEOUT);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });

const once = (method) => new Promise((resolve) => listeners.set(method, resolve));

async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });

// ---------- 5. Record ----------

async function record(slug) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `${origin}/video/${slug}/?capture` });
  await loaded;
  await evaluate('window.__ready');
  const total = await evaluate('window.__total');
  if (!total) throw new Error(`the page for "${slug}" reports no running time`);

  const output = path.join(outDir, `${slug}.mp4`);
  const partial = path.join(outDir, `.${slug}.partial.mp4`);
  const encoder = spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '21',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-movflags', '+faststart', '-an',
      partial,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const encoded = new Promise((resolve, reject) => {
    encoder.on('error', reject);
    encoder.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
  });
  const write = (frame) =>
    new Promise((resolve) => {
      if (encoder.stdin.write(frame)) resolve();
      else encoder.stdin.once('drain', resolve);
    });

  const frames = Math.round((total / 1000) * FPS);
  const posterFrame = Math.round(POSTER_AT * FPS);
  let frame = null;
  for (let i = 0; i < frames; i++) {
    await evaluate(`window.__seek(${((i * 1000) / FPS).toFixed(3)}, true)`);
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 95 });
    frame = Buffer.from(shot.data, 'base64');
    await write(frame);

    if (i === posterFrame) {
      const poster = spawnSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-i', '-', '-vf', `scale=${WIDTH}:-2`, '-q:v', '4', path.join(outDir, `${slug}.jpg`)],
        { input: frame },
      );
      if (poster.status !== 0) throw new Error('could not write the poster');
    }
    if (i % FPS === 0) process.stdout.write(`\r  ${slug}: ${Math.round((i / frames) * 100)}%   `);
  }
  for (let i = 0; i < Math.round(HOLD * FPS); i++) await write(frame);

  encoder.stdin.end();
  await encoded;
  fs.renameSync(partial, output);
  const megabytes = (fs.statSync(output).size / 1e6).toFixed(2);
  process.stdout.write(`\r  ${slug}: ${(total / 1000 + HOLD).toFixed(1)} s, ${megabytes} MB\n`);
}

fs.mkdirSync(outDir, { recursive: true });
let exitCode = 0;
try {
  console.log(`Recording ${slugs.length} video${slugs.length === 1 ? '' : 's'} at ${WIDTH * SCALE}x${HEIGHT * SCALE}, ${FPS} fps`);
  for (const slug of slugs) await record(slug);
} catch (error) {
  console.error(`\nrender-videos: ${error.message}`);
  exitCode = 1;
} finally {
  socket.close();
  cleanUp();
}
process.exit(exitCode);
