import { embeddingConfig, LOCAL_EMBEDDING_MODEL } from '@server/kernel/embeddingConfig';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import 'server-only';

/** Fixed executable arguments; private user text travels over stdin, never the command line. */
export async function localEmbedding(query: string): Promise<unknown> {
	const config = embeddingConfig();
	return new Promise((accept, reject) => {
		const child = spawn(config.python, [resolve('scripts/vector_search.py'), 'embed-query'], {
			env: {
				...process.env,
				EMBEDDING_CACHE: config.cache,
				EMBEDDING_MODEL: config.model || LOCAL_EMBEDDING_MODEL,
				HF_HUB_OFFLINE: '1',
				PYTHONIOENCODING: 'utf-8',
				PYTHONUTF8: '1',
				TOKENIZERS_PARALLELISM: 'false',
				TRANSFORMERS_OFFLINE: '1',
			},
			stdio: ['pipe', 'pipe', 'ignore'],
			timeout: 30000,
		});
		let output = '';
		child.on('error', reject);
		child.stdin.on('error', reject);
		child.stdout.on('data', (chunk: Buffer) => {
			output += chunk.toString('utf8');
			if (output.length > 100000) child.kill();
		});
		child.on('close', (code) => {
			if (code !== 0) {
				reject(new Error('Local embedding unavailable'));
				return;
			}
			try {
				accept(JSON.parse(output) as unknown);
			} catch {
				reject(new Error('Invalid local embedding'));
			}
		});
		child.stdin.end(JSON.stringify({ query }));
	});
}
