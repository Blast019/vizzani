// Vizzani · service worker
// Deixa o app instalável e abre a tela mesmo com internet ruim.
// Arquivos do app: tenta a rede primeiro (sempre a versão mais nova) e usa a cópia guardada se estiver sem conexão.
// Dados (Supabase) nunca passam pelo cache.
const VERSAO = 'vizzani-v6';
const ARQUIVOS = ['./', './index.html', './style.css', './script.js', './config.js', './logo.jpg',
  './icon-192.png', './icon-512.png', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(nomes => Promise.all(nomes.filter(n => n !== VERSAO).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // no-cache: sempre confere com o servidor (o GitHub Pages manda guardar por 10 min e a versão nova demorava a chegar)
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(resp => {
        if (resp.ok) { const copia = resp.clone(); caches.open(VERSAO).then(c => c.put(req, copia)); }
        return resp;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
