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
					label: 'Adoption',
					items: [
						{ label: 'Overview & the matrix', slug: 'adoption/overview' },
						{ label: 'Network & IAM', slug: 'adoption/network-and-iam' },
						{ label: 'DNS & certificates', slug: 'adoption/dns' },
						{ label: 'Identity & topology', slug: 'adoption/identity' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Run Loom on your laptop', slug: 'guides/local' },
						{ label: 'CI providers', slug: 'guides/ci' },
						{ label: 'Backup & restore', slug: 'guides/backup-restore' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Tiers & targets', slug: 'reference/tiers' },
						{ label: 'Screens', slug: 'reference/screens' },
						{ label: 'Seeded defaults', slug: 'reference/seeding' },
						{ label: 'Naming & Tagging', slug: 'reference/naming' },
						{ label: 'Local caveats', slug: 'reference/local-caveats' },
					],
				},
			],
		}),
	],
});
