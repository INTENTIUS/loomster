// The prompts handed to a coding agent. Every page prompt carries neverLine
// word for word; scripts/lint-docs.mjs fails a task page whose prompt lacks
// it or does not name its own page. The setup prompt has this one source: the
// home page renders it.

export const SITE = 'https://intentius.io/loomster';

export const neverLine =
	'Never run `chant approve` or `just grant`, never deploy to or delete from a real AWS account unless the person asked for that in this session, never register an identity provider in Loom, and never push or edit the `chant/lifecycle` branch.';

export const setupPrompt = [
	'Set up loomster in this checkout and bring Loom up locally.',
	`Read ${SITE}/llms.txt first, then`,
	`${SITE}/getting-started/ and follow it.`,
	'Report the URL and the login it prints, and the result of `just validate`.',
	neverLine,
].join('\n');

// A page's `prompt:` front matter, as its text. `prompt: setup` stands for the
// setup prompt, so a page can carry it without a second copy.
export function promptText(prompt: string | undefined): string | undefined {
	const text = prompt?.trim();
	if (!text) return undefined;
	return text === 'setup' ? setupPrompt : text;
}
