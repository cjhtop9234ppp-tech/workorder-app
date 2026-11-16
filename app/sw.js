// 작업지시서 서비스 워커: 카톡 등에서 "공유 → 작업지시서"로 보낸 사진을 받아 둔다.
// 공유로 받은 사진은 캐시에 넣고 목록 화면(overview.html?shared=N)으로 보낸다. 목록 화면이 그 사진을 꺼내 쓴다.
const SHARE_CACHE = "share-tmp-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith(receiveShare(event.request));
  }
});

async function receiveShare(request) {
  const form = await request.formData();
  const files = form.getAll("photos").filter((f) => f && f.size > 0);
  const cache = await caches.open(SHARE_CACHE);
  // 이전에 받아 두고 쓰지 않은 사진은 지운다
  for (const req of await cache.keys()) await cache.delete(req);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const headers = { "Content-Type": f.type || "image/jpeg", "X-Name": encodeURIComponent(f.name || `photo${i + 1}.jpg`) };
    await cache.put(new URL(`share-tmp/${i}`, self.location.href), new Response(f, { headers }));
  }
  return Response.redirect(`./overview.html?shared=${files.length}`, 303);
}
