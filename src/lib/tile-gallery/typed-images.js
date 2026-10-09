// Card pictures that need their declared type (see render.js): SVG screenshots
// and icons whose server sends them as application/octet-stream. Each is
// fetched once, when its card comes near the screen, wrapped as
// image/svg+xml and shown through an object URL, kept per blob so redrawn
// cards reuse it. An SVG inside <img> can't run scripts or load other files.
// Anything that fails is handed to `onFail` (the gallery's ▦ placeholder).

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const SVG = 'image/svg+xml';

const urls = new Map(); // blob cid -> Promise<object URL>

function load(src, key) {
	if (!urls.has(key)) {
		const p = (async () => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
			try {
				const res = await fetch(src, { signal: controller.signal, referrerPolicy: 'no-referrer' });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const bytes = await res.arrayBuffer();
				if (bytes.byteLength > MAX_BYTES) throw new Error('too large');
				return URL.createObjectURL(new Blob([bytes], { type: SVG }));
			} finally {
				clearTimeout(timer);
			}
		})();
		p.catch(() => urls.delete(key));
		urls.set(key, p);
	}
	return urls.get(key);
}

function show(img, onFail) {
	const src = img.getAttribute('data-typed-src');
	const key = img.getAttribute('data-typed-key') || src;
	img.removeAttribute('data-typed-src');
	load(src, key).then(
		(url) => {
			if (img.isConnected) img.src = url;
		},
		() => onFail(img),
	);
}

let observer = null;
let failHandler = () => {};

/** Starts loading the typed pictures inside `root` that aren't loaded yet. */
export function loadTypedImages(root, onFail) {
	failHandler = onFail;
	const imgs = root.querySelectorAll('img[data-typed-src]');
	if (!imgs.length) return;
	if (typeof IntersectionObserver === 'undefined') {
		imgs.forEach((img) => show(img, onFail));
		return;
	}
	if (!observer) {
		observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					observer.unobserve(e.target);
					if (e.target.hasAttribute('data-typed-src')) show(e.target, failHandler);
				}
			},
			{ rootMargin: '300px' },
		);
	}
	imgs.forEach((img) => observer.observe(img));
}
