/* Permet de relire le livre sans connexion une fois qu'il a été ouvert. */
const CACHE = "liseuse-v3";
const COQUILLE = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icon.svg",
  "polices/literata-latin-400-normal.woff2", "polices/literata-latin-400-italic.woff2",
  "polices/im-fell-english-400-normal.woff2", "polices/im-fell-english-400-italic.woff2", "images/couverture.jpg"];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Réseau d'abord (pour avoir toujours la dernière version), cache si hors ligne
self.addEventListener("fetch", (ev) => {
  if (ev.request.method !== "GET" || new URL(ev.request.url).origin !== location.origin) return;
  ev.respondWith(
    fetch(ev.request)
      .then((rep) => {
        if (rep.ok) {
          const copie = rep.clone();
          caches.open(CACHE).then((c) => c.put(ev.request, copie));
        }
        return rep;
      })
      .catch(() => caches.match(ev.request, { ignoreSearch: true }))
  );
});
