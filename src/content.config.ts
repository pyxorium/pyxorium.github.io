import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: z.optional(image()),
			// The post's own site.standard.document record, written by Sequoia when it publishes the post. Read for
			// the post's at-tags (src/lib/at-tags.js).
			atUri: z.string().optional(),
			// The wishes posts' two tiles (also at-tags alternates).
			bobAtUri: z.string().optional(),
			aliceAtUri: z.string().optional(),
		}),
});

export const collections = { blog };
