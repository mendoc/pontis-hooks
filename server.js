// Serveur webhook — aucune dépendance externe
// Route: POST /deploy/:slug
// Récupère le fichier compose depuis GitHub, l'écrit dans le répertoire du projet,
// puis exécute docker compose pull + up -d + image prune.
// Vérifie les signatures HMAC-SHA256 de GitHub.
//
// Format PATHS_CONFIG (JSON) :
//   "slug": "/chemin/absolu"

'use strict';

const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');
const path = require('path');
const fs   = require('fs');

const PORT         = 9000;
const SECRET       = process.env.GITHUB_WEBHOOK_SECRET;
const APPS_DIR     = process.env.APPS_DIR;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;
const PATHS_CONFIG = process.env.PATHS_CONFIG || null;

if (!SECRET) {
  console.error('FATAL : GITHUB_WEBHOOK_SECRET n\'est pas défini');
  process.exit(1);
}
if (!APPS_DIR) {
  console.error('FATAL : APPS_DIR n\'est pas défini');
  process.exit(1);
}
if (!GITHUB_TOKEN) {
  console.warn('[webhook] GITHUB_TOKEN non défini — seuls les dépôts publics fonctionneront');
}

// Garde : un seul déploiement à la fois par slug
const running = new Set();

// Retourne le répertoire du projet pour un slug donné.
function resolveProjectDir(slug) {
  if (!PATHS_CONFIG) return path.join(APPS_DIR, slug);

  try {
    const raw = fs.readFileSync(PATHS_CONFIG, 'utf8');
    const map = JSON.parse(raw);
    const entry = map[slug];
    if (!entry) return path.join(APPS_DIR, slug);
    console.log(`[${slug}] Répertoire personnalisé : ${entry}`);
    return entry;
  } catch (err) {
    console.warn(`[${slug}] Impossible de lire ${PATHS_CONFIG} : ${err.message} — répertoire par défaut utilisé`);
    return path.join(APPS_DIR, slug);
  }
}

function verifySignature(secret, body, sigHeader) {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

function runStep(cmd, args, slug) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (stdout) console.log(`[${slug}]`, stdout.trim());
      if (stderr) console.log(`[${slug}]`, stderr.trim());
      if (err) reject(err);
      else resolve();
    });
  });
}

function fetchRaw(url) {
  const options = { headers: { 'User-Agent': 'pontis-webhook/1.1' } };
  if (GITHUB_TOKEN) options.headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, options, (res) => {
      if (res.statusCode === 404) { res.resume(); resolve(null); return; }
      if (res.statusCode === 401 || res.statusCode === 403) {
        res.resume();
        reject(new Error(`Accès refusé (${res.statusCode}) — GITHUB_TOKEN est-il défini ?`));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Statut inattendu ${res.statusCode} pour ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Délai dépassé pour ${url}`)); });
  });
}

async function fetchComposeFile(fullName, branch) {
  const base = `https://raw.githubusercontent.com/${fullName}/${branch}`;

  for (const filename of ['docker-compose.yml', 'compose.yml']) {
    const content = await fetchRaw(`${base}/${filename}`);
    if (content !== null) return { content, filename };
  }
  throw new Error(`Aucun fichier compose trouvé à la racine de ${fullName}@${branch}`);
}

function writeComposeFile(dir, filename, content) {
  const file = path.join(dir, filename);
  return new Promise((resolve, reject) => {
    fs.mkdir(dir, { recursive: true }, (err) => {
      if (err) { reject(err); return; }
      fs.writeFile(file, content, 'utf8', (err) => {
        if (err) reject(err); else resolve();
      });
    });
  });
}

async function runDeploy(slug, fullName, branch, projectDir) {
  if (running.has(slug)) {
    console.log(`[${slug}] Déploiement déjà en cours, ignoré.`);
    return;
  }

  running.add(slug);
  console.log(`[${slug}] Démarrage du déploiement (${fullName}@${branch})...`);
  try {
    const { content, filename } = await fetchComposeFile(fullName, branch);
    console.log(`[${slug}] Fichier compose récupéré : ${filename}`);
    await writeComposeFile(projectDir, filename, content);
    console.log(`[${slug}] ${filename} écrit dans ${projectDir}/`);

    const composeFile = path.join(projectDir, filename);
    await runStep('docker', ['compose', '-f', composeFile, 'pull'], slug);
    await runStep('docker', ['compose', '-f', composeFile, 'up', '-d'], slug);
    await runStep('docker', ['image', 'prune', '-f'], slug);
    console.log(`[${slug}] Déploiement réussi.`);
  } catch (err) {
    console.error(`[${slug}] Échec du déploiement :`, err.message);
  } finally {
    running.delete(slug);
  }
}

const server = http.createServer((req, res) => {
  const match = req.method === 'POST' && req.url.match(/^\/deploy\/([a-z0-9_-]+)$/);
  if (!match) { res.writeHead(404).end('Not found'); return; }
  const slug = match[1];

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const sig  = req.headers['x-hub-signature-256'];

    if (!verifySignature(SECRET, body, sig)) {
      res.writeHead(400).end('Invalid signature');
      return;
    }

    if (req.headers['x-github-event'] === 'ping') {
      res.writeHead(200).end('pong');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      res.writeHead(400).end('Invalid JSON');
      return;
    }

    if (req.headers['x-github-event'] !== 'package' || payload.action !== 'published') {
      res.writeHead(200).end('Ignored (not a package.published event)');
      return;
    }

    res.writeHead(202).end('Accepted');
    const fullName   = payload.repository.full_name;
    const branch     = payload.repository.default_branch;
    const projectDir = resolveProjectDir(slug);
    runDeploy(slug, fullName, branch, projectDir);
  });
});

server.listen(PORT, () => {
  console.log(`[webhook] En écoute sur le port ${PORT}`);
  console.log(`[webhook] Répertoire des applications : ${APPS_DIR}`);
});
