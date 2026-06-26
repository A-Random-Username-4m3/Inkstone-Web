const CACHE_NAME = 'inkstone-static-a0.2.13.2';
const CORE_ASSETS = [
	'./',
	'./index.html',
	'./styles.css',
	'./js/app.js',
	'./js/dom-utils.js',
	'./js/time-format.js',
	'./js/state-store.js',
	'./js/constants.js',
	'./js/fsrs.js',
	'./js/practice-canvas.js',
	'./js/sample-data.js',
	'./js/stroke-matcher.js',
	'./js/lists-ui.js',
	'./js/study-flow.js',
	'./js/session-queue.js',
	'./js/vocabulary.js',
	'./js/settings-ui.js',
	'./js/lookup-ui.js',
	'./js/word-examples.js',
	'./js/backup.js',
	'./js/review-log-store.js',
	'./js/script-mode.js',
	'./manifest.webmanifest',
	'./data/hanzi.json',
	'./data/lists.json',
	'./data/lists/nhsk1.tsv',
	'./data/lists/100cr.tsv',
	'./data/lists/nhsk2.tsv',
	'./data/lists/nhsk3.tsv',
	'./data/lists/nhsk4.tsv',
	'./data/lists/nhsk5.tsv',
	'./data/lists/nhsk6.tsv',
	'./data/lists/demo.tsv'
];

const OPTIONAL_ASSETS = [
	'./icons/brand-mark.png',
	'./icons/icon-72.png',
	'./icons/icon-96.png',
	'./icons/icon-128.png',
	'./icons/icon-144.png',
	'./icons/icon-152.png',
	'./icons/icon-192.png',
	'./icons/icon-384.png',
	'./icons/icon-512.png',
	'./wav/blacklist.wav',
	'./wav/correctstroke.wav',
	'./wav/fairresult.wav',
	'./wav/goodjob.wav',
	'./wav/repeatnext.wav',
	'./wav/restore.wav',
	'./wav/tabchange.wav',
	'./wav/wrongstroke.wav'
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then(async (cache) => {
				await cache.addAll(
					CORE_ASSETS.map((url) => new Request(
						url, {cache: 'reload'}
					))
				);
				await Promise.allSettled(
					OPTIONAL_ASSETS.map((url) =>
						cache.add(new Request(url, {cache: 'reload'}))
					)
				);
			})
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys()
			.then(
				(keys) => Promise.all(
					keys.filter(
						(key) => key !== CACHE_NAME
					).map((key) => caches.delete(key))
				)
			)
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
	const cached = await caches.match(
		request,
		{ ignoreSearch: true }
	);

	if (cached) return cached;

	try {
		const response = await fetch(request);

		if (response && response.ok) {
			try {
				const cache = await caches.open(CACHE_NAME);
				await cache.put(request, response.clone());
			} catch (error) {
				console.warn(
					'Inkstone service worker cache update failed:',
					error
				);
			}
		}

		return response;
	} catch (error) {
		if (request.mode === 'navigate') {
			return caches.match('./index.html');
		}

		return new Response(
			'Offline and not cached.',
			{
				status: 503,
				statusText: 'Offline',
				headers: {
					'Content-Type':
						'text/plain; charset=utf-8'
				}
			}
		);
	}
}
