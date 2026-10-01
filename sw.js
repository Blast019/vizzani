// Vizzani · service worker
// Deixa o app instalável e abre a tela mesmo com internet ruim.
// Arquivos do app: tenta a rede primeiro (sempre a versão mais nova) e usa a cópia guardada se estiver sem conexão.
// Dados (Supabase) nunca passam pelo cache.
const VERSAO = 'vizzani-v12';
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

// Avisos no celular (Web Push): o servidor manda {titulo, corpo, url, tag}
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { corpo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Vizzani Estética', {
    body: d.corpo || '', icon: './icon-192.png', badge: './icon-192.png',
    tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || './' },
  }));
});

// Tocou no aviso: abre o app (ou traz para frente se já estiver aberto)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    const aberto = lista.find(c => c.url.startsWith(self.registration.scope));
    if (aberto) { aberto.focus(); return aberto.navigate ? aberto.navigate(alvo).catch(() => {}) : null; }
    return self.clients.openWindow(alvo);
  }));
});
