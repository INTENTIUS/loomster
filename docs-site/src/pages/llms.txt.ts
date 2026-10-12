// llms.txt: every docs page with its one-line description, grouped the way the
// sidebar groups them, for a coding agent to read before it opens a page.
import { getCollection } from 'astro:content';
import { SITE } from '../prompts';

const GROUPS: Array<[string, (id: string) => boolean]> = [
	['Start here', (id) => id === 'getting-started' || id === 'concepts/how-it-works'],
	['Tutorial', (id) => id.startsWith('tutorial')],
	['Your setup', (id) => id.startsWith('for/')],
	['Coming from', (id) => id.startsWith('guides/coming-from-')],
	['Proof', (id) => id === 'reference/validation' || id === 'reference/claims'],
	['How-to guides', (id) => id.startsWith('guides/')],
	['Reference', (id) => id.startsWith('reference/')],
	['Concepts', (id) => id.startsWith('concepts/')],
];

export async function GET() {
	const pages = (await getCollection('docs')).filter((p) => p.id !== 'index' && p.id !== '404');
	const placed = new Set<string>();
	const lines = [
		'# loomster',
		'',
		'> A deployment of awslabs/loom on chant: six components, three tiers, a local stack on Floci, gated lifecycle Ops and generated CI.',
		'',
	];
	for (const [label, match] of GROUPS) {
		const group = pages.filter((p) => !placed.has(p.id) && match(p.id)).sort((a, b) => a.id.localeCompare(b.id));
		if (!group.length) continue;
		lines.push(`## ${label}`, '');
		for (const p of group) {
			placed.add(p.id);
			lines.push(`- [${p.data.title}](${SITE}/${p.id}/): ${p.data.description ?? ''}`);
		}
		lines.push('');
	}
	return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
