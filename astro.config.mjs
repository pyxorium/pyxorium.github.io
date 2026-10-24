// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

// Hidden lab pages: noindex, unlinked, and left out of the sitemap. (Hidden isn't secret: anyone with
// the address can open them.) The Seven-Up table and Daisy each went public with their blog posts
// (/blog/seven-up/, /blog/daisy/). The Rooms lab (Oct 24 2026) is hidden while it's a proof of concept.
const HIDDEN_PAGES = ['/webtiles/rooms-lab/'];

// https://astro.build/config
export default defineConfig({
	site: 'https://thunderbird.cafe',
	integrations: [mdx(), sitemap({ filter: (page) => !HIDDEN_PAGES.some((p) => new URL(page).pathname.startsWith(p)) })],
	// Local dev at http://127.0.0.1:4321 (signing in on this computer needs 127.0.0.1, not localhost).
	server: { host: '127.0.0.1' },
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Atkinson',
			cssVariable: '--font-atkinson',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					{
						src: ['./src/assets/fonts/atkinson-regular.woff'],
						weight: 400,
						style: 'normal',
						display: 'swap',
					},
					{
						src: ['./src/assets/fonts/atkinson-bold.woff'],
						weight: 700,
						style: 'normal',
						display: 'swap',
					},
				],
			},
		},
	],
});
