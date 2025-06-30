// MATSYA ERP - Service Worker pentru funcționare offline
// Versiunea cache-ului - incrementați pentru forțarea update-ului
const CACHE_VERSION = 'matsya-erp-v2.0.0';
const CACHE_NAME = `matsya-erp-${CACHE_VERSION}`;

// Resurse de cache-uit
const STATIC_RESOURCES = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // CDN resources
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://unpkg.com/lucide@latest/dist/umd/lucide.js'
];

// Resurse opționale (nu sunt critice)
const OPTIONAL_RESOURCES = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// Strategii de cache
const CACHE_STRATEGIES = {
  CACHE_FIRST: 'cache-first',
  NETWORK_FIRST: 'network-first',
  STALE_WHILE_REVALIDATE: 'stale-while-revalidate'
};

// Instalare Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static resources');
        
        // Cache resurse esențiale
        const essentialPromise = cache.addAll(STATIC_RESOURCES);
        
        // Cache resurse opționale (nu eșuează dacă nu sunt disponibile)
        const optionalPromises = OPTIONAL_RESOURCES.map(url => 
          cache.add(url).catch(err => console.warn('[SW] Optional resource failed:', url))
        );
        
        return Promise.all([essentialPromise, ...optionalPromises]);
      })
      .then(() => {
        console.log('[SW] All resources cached successfully');
        // Forțează activarea noului service worker
        self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Cache installation failed:', error);
      })
  );
});

// Activare Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    Promise.all([
      // Curăță cache-urile vechi
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter(cacheName => 
              cacheName.startsWith('matsya-erp-') && 
              cacheName !== CACHE_NAME
            )
            .map(cacheName => {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      }),
      // Preia controlul tuturor clientelor
      self.clients.claim()
    ])
  );
});

// Interceptare fetch requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Doar pentru GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Ignoră extensiile browser
  if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
    return;
  }
  
  event.respondWith(handleFetch(event.request));
});

// Gestionarea fetch-urilor
async function handleFetch(request) {
  const url = new URL(request.url);
  
  try {
    // Strategii diferite pentru diferite tipuri de resurse
    if (isStaticResource(url)) {
      return await cacheFirst(request);
    } else if (isAPIRequest(url)) {
      return await networkFirst(request);
    } else if (isCDNResource(url)) {
      return await staleWhileRevalidate(request);
    } else {
      return await networkFirst(request);
    }
  } catch (error) {
    console.error('[SW] Fetch failed:', error);
    return await getFallbackResponse(request);
  }
}

// Verifică dacă este resursă statică
function isStaticResource(url) {
  return STATIC_RESOURCES.some(resource => url.href.endsWith(resource));
}

// Verifică dacă este cerere API
function isAPIRequest(url) {
  return url.pathname.includes('/api/') || url.hostname !== location.hostname;
}

// Verifică dacă este resursă CDN
function isCDNResource(url) {
  return url.hostname.includes('cdn.') || 
         url.hostname.includes('unpkg.') ||
         url.hostname.includes('googleapis.') ||
         url.hostname.includes('gstatic.') ||
         url.hostname.includes('cdnjs.');
}

// Strategie Cache First
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  const networkResponse = await fetch(request);
  if (networkResponse.status === 200) {
    cache.put(request, networkResponse.clone());
  }
  
  return networkResponse;
}

// Strategie Network First
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    throw error;
  }
}

// Strategie Stale While Revalidate
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  // Update cache în background
  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => {
    // Ignoră erorile de rețea pentru această strategie
  });
  
  // Returnează cache-ul imediat dacă există, altfel așteaptă network
  return cachedResponse || fetchPromise;
}

// Răspuns de fallback
async function getFallbackResponse(request) {
  const url = new URL(request.url);
  
  // Pentru pagini HTML, returnează index.html
  if (request.destination === 'document') {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match('./index.html');
  }
  
  // Pentru imagini, returnează o imagine placeholder
  if (request.destination === 'image') {
    return new Response(
      '<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" fill="#f3f4f6"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#6b7280">Image indisponible</text></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
  
  // Pentru alte resurse, returnează o eroare 404 customizată
  return new Response('Ressource non disponible hors ligne', {
    status: 404,
    statusText: 'Not Found (Offline)',
    headers: { 'Content-Type': 'text/plain' }
  });
}

// Gestionarea mesajelor de la aplicația principală
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  const { type, payload } = event.data;
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'GET_CACHE_INFO':
      getCacheInfo().then(info => {
        event.ports[0].postMessage(info);
      });
      break;
      
    case 'CLEAR_CACHE':
      clearCache().then(() => {
        event.ports[0].postMessage({ success: true });
      });
      break;
      
    case 'FORCE_UPDATE':
      forceUpdate();
      break;
      
    default:
      console.warn('[SW] Unknown message type:', type);
  }
});

// Obține informații despre cache
async function getCacheInfo() {
  const cache = await caches.open(CACHE_NAME);
  const requests = await cache.keys();
  
  return {
    version: CACHE_VERSION,
    resources: requests.length,
    size: await getCacheSize(cache)
  };
}

// Calculează dimensiunea cache-ului
async function getCacheSize(cache) {
  const requests = await cache.keys();
  let totalSize = 0;
  
  for (const request of requests) {
    const response = await cache.match(request);
    const blob = await response.blob();
    totalSize += blob.size;
  }
  
  return totalSize;
}

// Curăță toate cache-urile
async function clearCache() {
  const cacheNames = await caches.keys();
  return Promise.all(
    cacheNames.map(cacheName => caches.delete(cacheName))
  );
}

// Forțează actualizarea
function forceUpdate() {
  self.registration.update();
}

// Notificări push (pentru viitor)
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  
  const options = {
    body: data.body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [100, 50, 100],
    data: data.data,
    actions: [
      {
        action: 'open',
        title: 'Ouvrir',
        icon: './icon-192.png'
      },
      {
        action: 'close',
        title: 'Fermer'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Gestionarea click-urilor pe notificări
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(
      clients.openWindow('./')
    );
  }
});

// Background sync (pentru sincronizarea offline)
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      syncOfflineData()
    );
  }
});

// Sincronizează datele offline
async function syncOfflineData() {
  try {
    // Aici se poate implementa sincronizarea cu serverul
    // când va fi disponibil
    console.log('[SW] Background sync completed');
  } catch (error) {
    console.error('[SW] Background sync failed:', error);
  }
}

console.log('[SW] Service Worker initialized successfully');