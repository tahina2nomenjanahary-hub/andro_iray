// ══════════════════════════════════════════════════════════════════════════
// SERVICE WORKER — Andro iray toa zato
// ══════════════════════════════════════════════════════════════════════════
const CACHE_NAME = "andro-iray-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400;1,500&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400;1,600&family=DM+Sans:wght@200;300;400&display=swap"
];

// ── Install : mise en cache des ressources ────────────────────────────────
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// ── Activate : nettoyage anciens caches ───────────────────────────────────
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch : Cache first pour les assets, network first pour Supabase ──────
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Toujours réseau pour Supabase
  if (url.hostname.includes("supabase.co")) {
    e.respondWith(fetch(e.request).catch(() => new Response("offline", { status: 503 })));
    return;
  }

  // Cache first pour tout le reste
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type !== "opaque") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Hors ligne → retourner index.html pour la navigation
        if (e.request.mode === "navigate") {
          return caches.match("/index.html");
        }
      });
    })
  );
});

// ── Push notifications ────────────────────────────────────────────────────
self.addEventListener("push", e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || "Andro iray toa zato 🌸";
  const options = {
    body: data.body || "Vous avez un rappel",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [200, 100, 200],
    data: { url: data.url || "/" },
    actions: [
      { action: "open", title: "Ouvrir le planner" },
      { action: "dismiss", title: "Ignorer" }
    ],
    tag: data.tag || "andro-notif",
    renotify: true
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Clic sur notification ─────────────────────────────────────────────────
self.addEventListener("notificationclick", e => {
  e.notification.close();
  if (e.action === "dismiss") return;
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Background sync (rappels programmés) ─────────────────────────────────
self.addEventListener("sync", e => {
  if (e.tag === "check-reminders") {
    e.waitUntil(checkReminders());
  }
});

async function checkReminders() {
  // Les rappels sont stockés en IndexedDB par l'app principale
  // Le SW les vérifie et envoie les notifications nécessaires
  try {
    const db = await openDB();
    const reminders = await getReminders(db);
    const now = Date.now();

    for (const reminder of reminders) {
      if (reminder.time <= now && !reminder.sent) {
        await self.registration.showNotification(reminder.title, {
          body: reminder.body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          vibrate: [200, 100, 200],
          tag: reminder.id
        });
        await markSent(db, reminder.id);
      }
    }
  } catch (err) {
    console.log("SW reminder check:", err);
  }
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("andro-reminders", 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("reminders")) {
        db.createObjectStore("reminders", { keyPath: "id" });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

function getReminders(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("reminders", "readonly");
    const req = tx.objectStore("reminders").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function markSent(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("reminders", "readwrite");
    const store = tx.objectStore("reminders");
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result;
      if (item) { item.sent = true; store.put(item); }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}
