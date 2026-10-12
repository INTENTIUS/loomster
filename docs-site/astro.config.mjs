// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Published under the org domain at /loomster. `base` has to match or every
// internal link 404s on Pages.
export default defineConfig({
	site: 'https://intentius.io',
	base: '/loomster',
	// Pages that moved keep their old address.
	redirects: {
		'/getting-started/overview': '/loomster/concepts/how-it-works/',
		'/getting-started/tutorial': '/loomster/tutorial/',
		'/guides/local': '/loomster/getting-started/',
		'/guides/tunnel': '/loomster/guides/open-a-tunnel-to-the-database/',
		'/adoption/overview': '/loomster/reference/adoption-seams/',
		'/adoption/network-and-iam': '/loomster/guides/bring-your-own-network-and-iam/',
		'/adoption/dns': '/loomster/guides/set-up-a-custom-domain/',
		'/adoption/identity': '/loomster/guides/share-a-cognito-pool/',
		'/adoption/multiple-deployments': '/loomster/guides/run-a-second-deployment/',
		'/operations/overview': '/loomster/reference/ops/',
		'/operations/production-live-e2e': '/loomster/guides/deploy-to-production/',
		'/operations/upgrade': '/loomster/guides/upgrade-loom/',
		'/operations/backup-restore': '/loomster/guides/back-up-and-restore/',
		'/operations/ci': '/loomster/reference/ci/',
		'/reference/seeding': '/loomster/reference/screens/',
	},
	integrations: [
		starlight({
			title: 'loomster',
			description: 'A deployment of awslabs/loom you run from a repo: six components, three tiers, a local stack on Floci, gated lifecycle Ops and generated CI.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/INTENTIUS/loomster' }],
			editLink: { baseUrl: 'https://github.com/INTENTIUS/loomster/edit/main/docs-site/' },
			// The title gets an llms.txt pointer and the page's agent prompt.
			components: { PageTitle: './src/components/PageTitle.astro' },
			// Start, learn, find your setup, then tasks by job, then lookup and
			// background. Every group starts collapsed; the current page's group opens.
			sidebar: [
				{
					label: 'Start here',
					collapsed: true,
					items: [
						{ label: 'Run Loom locally', slug: 'getting-started' },
						{ label: 'Architecture', slug: 'concepts/how-it-works' },
					],
				},
				{
					label: 'Tutorial',
					collapsed: true,
					items: [
						{ label: 'Browse Loom on your laptop', slug: 'tutorial' },
						{ label: 'Deploy the light tier to AWS', slug: 'tutorial/light-on-aws' },
						{ label: 'Go to production', slug: 'tutorial/production' },
						{ label: 'Run your first Ops', slug: 'tutorial/operate' },
					],
				},
				{
					label: 'Your setup',
					collapsed: true,
					items: [
						{ label: 'Try it', slug: 'for/try-it' },
						{ label: 'Evaluate for your org', slug: 'for/evaluate' },
						{ label: 'Security review', slug: 'for/security' },
						{ label: 'Platform team', slug: 'for/platform-team' },
						{ label: 'On call', slug: 'for/on-call' },
						{ label: 'With a coding agent', slug: 'for/agents' },
					],
				},
				{
					label: 'Coming from',
					collapsed: true,
					items: [
						{ label: "Loom's SAM deploy", slug: 'guides/coming-from-upstream-loom' },
						{ label: 'CDK, SAM or CloudFormation', slug: 'guides/coming-from-cdk-or-sam' },
						{ label: 'Terraform, Terragrunt or Pulumi', slug: 'guides/coming-from-terraform-or-pulumi' },
						{ label: 'The AgentCore starter toolkit', slug: 'guides/coming-from-agentcore-starter-toolkit' },
					],
				},
				{
					label: 'Proof',
					collapsed: true,
					items: [
						{ label: 'Validation', slug: 'reference/validation' },
						{ label: 'Claims', slug: 'reference/claims' },
					],
				},
				{
					label: 'How-to guides',
					collapsed: true,
					items: [
						{
							label: 'Deploy',
							collapsed: true,
							items: [
								{ label: 'Deploy to production on AWS', slug: 'guides/deploy-to-production' },
								{ label: 'Set up a custom domain', slug: 'guides/set-up-a-custom-domain' },
								{ label: 'Seed and validate a deploy', slug: 'guides/seed-and-validate' },
								{ label: 'Run a second deployment', slug: 'guides/run-a-second-deployment' },
								{ label: 'Deploy without chant', slug: 'guides/deploy-without-chant' },
								{ label: 'Work with the local stack', slug: 'guides/run-locally-in-depth' },
							],
						},
						{
							label: 'Adopt your infrastructure',
							collapsed: true,
							items: [
								{ label: 'Bring your own network and IAM', slug: 'guides/bring-your-own-network-and-iam' },
								{ label: 'Create an execution role per agent', slug: 'guides/create-an-execution-role-per-agent' },
								{ label: 'Share a Cognito pool', slug: 'guides/share-a-cognito-pool' },
								{ label: 'Bring your own KMS, ECR and database', slug: 'guides/bring-your-own-kms-ecr-and-database' },
								{ label: 'Bring your own everything', slug: 'guides/bring-your-own-everything' },
							],
						},
						{
							label: 'Operate',
							collapsed: true,
							items: [
								{ label: 'Back up and restore', slug: 'guides/back-up-and-restore' },
								{ label: 'Rotate credentials', slug: 'guides/rotate-credentials' },
								{ label: 'Upgrade Loom', slug: 'guides/upgrade-loom' },
								{ label: 'Watch and reconcile drift', slug: 'guides/watch-and-reconcile-drift' },
								{ label: 'Tear down a deployment', slug: 'guides/tear-down' },
								{ label: 'Recover from an IdP lockout', slug: 'guides/recover-from-an-idp-lockout' },
								{ label: 'Open a tunnel to the database', slug: 'guides/open-a-tunnel-to-the-database' },
							],
						},
						{
							label: 'CI',
							collapsed: true,
							items: [
								{ label: 'Add CI to your forge', slug: 'guides/add-ci-to-your-forge' },
								{ label: 'Turn on scheduled Ops', slug: 'guides/turn-on-scheduled-ops' },
								{ label: 'Estimate cost', slug: 'guides/estimate-cost' },
							],
						},
						{
							label: 'With a coding agent',
							collapsed: true,
							items: [{ label: 'Drive loomster with an agent', slug: 'guides/drive-with-an-agent' }],
						},
					],
				},
				{
					label: 'Reference',
					collapsed: true,
					items: [
						{ label: 'Build parameters', slug: 'reference/parameters' },
						{ label: 'Adoption seams', slug: 'reference/adoption-seams' },
						{ label: 'Tiers and targets', slug: 'reference/tiers' },
						{ label: 'Components', slug: 'reference/components' },
						{ label: 'Ops', slug: 'reference/ops' },
						{ label: 'Loom make targets', slug: 'reference/make-targets' },
						{ label: 'CI providers', slug: 'reference/ci' },
						{ label: 'Screens', slug: 'reference/screens' },
						{ label: 'Security', slug: 'reference/security' },
						{ label: 'Cost', slug: 'reference/cost' },
						{ label: 'Naming and tagging', slug: 'reference/naming' },
						{ label: 'Local caveats', slug: 'reference/local-caveats' },
					],
				},
				{
					label: 'Concepts',
					collapsed: true,
					items: [
						{ label: 'Tiers and instances', slug: 'concepts/tiers-and-instances' },
						{ label: 'Provision, reference or omit', slug: 'concepts/adoption-seams' },
						{ label: 'Choosing chant', slug: 'concepts/why-chant' },
						{ label: 'Gated Ops', slug: 'concepts/gated-ops' },
						{ label: 'Stateful resources', slug: 'concepts/what-holds-state' },
						{ label: 'Glossary', slug: 'concepts/glossary' },
					],
				},
				{
					label: "What's new",
					collapsed: true,
					items: [{ label: 'Changes on Loom v1.9.0', slug: 'reference/whats-new' }],
				},
			],
		}),
	],
});
