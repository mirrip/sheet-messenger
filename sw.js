const CACHE_NAME = "sheet-messenger-shell-v3";
const APP_SHELL = ["./", "./index.html", "./styles.css", "./config.js", "./app.js", "./manifest.webmanifest", "./icon.svg"];

importScripts("./config.js");

const firebaseConfig = globalThis.SHEET_MESSENGER_FIREBASE_CONFIG;
if (firebaseConfig?.apiKey && firebaseConfig?.projectId && firebaseConfig?.messagingSenderId && firebaseConfig?.appId) {
  importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js");
  firebase.initializeApp(firebaseConfig);
  firebase.messaging();
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

