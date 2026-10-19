import { z } from 'zod';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const index = z.number().int().nonnegative();

/** Geometry stays in OSM node order; edges are directed and carry their source way ID. */
export const walkingGraphSchema = z
	.object({
		bbox: z.tuple([
			z.number().min(-90).max(90),
			z.number().min(-180).max(180),
			z.number().min(-90).max(90),
			z.number().min(-180).max(180),
		]),
		collectedAt: z.iso.datetime(),
		edges: z.array(z.tuple([index, index, id])).min(1),
		nodes: z.array(z.tuple([id, z.number().min(-90).max(90), z.number().min(-180).max(180)])).min(2),
		source: z.literal('OpenStreetMap'),
		version: z.literal(1),
	})
	.superRefine((graph, ctx) => {
		if (graph.bbox[0] >= graph.bbox[2] || graph.bbox[1] >= graph.bbox[3])
			ctx.addIssue({ code: 'custom', message: 'Invalid bounding box' });
		if (new Set(graph.nodes.map((node) => node[0])).size !== graph.nodes.length)
			ctx.addIssue({ code: 'custom', message: 'Duplicate OSM nodes' });
		const seen = new Set<string>();
		for (const [from, to, way] of graph.edges) {
			if (from >= graph.nodes.length || to >= graph.nodes.length || from === to)
				ctx.addIssue({ code: 'custom', message: 'Invalid edge reference' });
			const key = `${from}/${to}/${way}`;
			if (seen.has(key)) ctx.addIssue({ code: 'custom', message: 'Duplicate directed edge' });
			seen.add(key);
		}
	});

export type WalkingGraphData = z.infer<typeof walkingGraphSchema>;
