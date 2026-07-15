// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://intentius.io',
	base: '/loomster',
	integrations: [
		starlight({
			title: 'loomster',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/INTENTIUS/loomster' }],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'What loomster is', slug: 'getting-started/overview' },
						{ label: 'Tutorial', slug: 'getting-started/tutorial' },
					],
				},
				{
					label: 'Guides',
					items: [{ label: 'Adoption', slug: 'guides/adoption' }],
				},
				{
					label: 'Reference',
					items: [{ label: 'Naming & Tagging', slug: 'reference/naming' }],
				},
			],
		}),
	],
});
