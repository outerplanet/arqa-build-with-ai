import 'server-only';
import { z } from 'zod';

export const LOCAL_EMBEDDING_MODEL = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';

/** Independent of the chat provider: local inference needs neither a key nor network. */
export function embeddingConfig() {
	return z
		.object({
			cache: z.string().min(1),
			model: z.string().min(1).optional(),
			provider: z.enum(['local', 'openai', 'lexical']),
			python: z.string().min(1),
		})
		.parse({
			cache: process.env.EMBEDDING_CACHE || '.cache/embeddings',
			model: process.env.EMBEDDING_MODEL || undefined,
			provider: process.env.EMBEDDING_PROVIDER || 'local',
			python: process.env.EMBEDDING_PYTHON || 'python3',
		});
}
