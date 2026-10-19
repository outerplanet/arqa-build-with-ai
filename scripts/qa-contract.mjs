/**
 * Cardinality and generated-action contract shared by both verification CLIs.
 * @param {{selectedCount: number, reply: string, allowEmpty?: boolean}} input
 */
export function recommendationShape({ allowEmpty = false, reply, selectedCount }) {
	const actions = reply.split('\n').filter((line) => line.startsWith('Что делать:'));
	return (
		selectedCount <= 3 &&
		(allowEmpty || selectedCount > 0) &&
		actions.length === selectedCount &&
		actions.every((line) => line.includes('(сгенерированная идея)'))
	);
}
