// 最基础的 PWA 守门员，保证浏览器弹出安装提示
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  // 这里暂时不做复杂的离线缓存，直接放行网络请求
});
