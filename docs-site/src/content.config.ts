import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { promptText } from './prompts';

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: z.object({
				// The recorded claims (test/claims/<area>/<part>.sh) the page shows.
				// scripts/lint-docs.mjs checks each name is a claim in test/claims/.
				claims: z.array(z.string()).default([]),
				// "Optional: hand this page to your coding agent": shown under the
				// title (PageTitle.astro) and carried in llms.txt. `prompt: setup`
				// is the setup prompt from src/prompts.ts.
				prompt: z.string().optional().transform(promptText),
			}),
		}),
	}),
};
