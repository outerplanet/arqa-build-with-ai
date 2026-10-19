import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localEmbedding } from './localEmbedding';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

function subprocess(response: string, code = 0) {
	const child = new EventEmitter();
	const stdout = new EventEmitter();
	const stdin = Object.assign(new EventEmitter(), {
		end: vi.fn(() => {
			queueMicrotask(() => {
				stdout.emit('data', Buffer.from(response, 'utf8'));
				child.emit('close', code);
			});
		}),
	});
	const process = Object.assign(child, { kill: vi.fn(), stdin, stdout });
	vi.mocked(spawn).mockReturnValue(process as unknown as ReturnType<typeof spawn>);
	return process;
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});

describe('local embedding subprocess boundary', () => {
	it('forces UTF-8 pipes across OS locales and sends private Cyrillic text only on stdin', async () => {
		vi.stubEnv('EMBEDDING_PYTHON', 'C:\\Team Files\\python.exe');
		const child = subprocess('{"embedding":[1],"model":"fixture"}');
		const query = 'Хочу тихое кафе у Нұр Әлем';
		await expect(localEmbedding(query)).resolves.toEqual({ embedding: [1], model: 'fixture' });
		const [executable, args, options] = vi.mocked(spawn).mock.calls[0]!;
		expect(executable).toBe('C:\\Team Files\\python.exe');
		expect(args).toEqual([expect.stringContaining('vector_search.py'), 'embed-query']);
		// Check individual fields so a failing assertion never prints inherited secrets.
		expect(options.env?.PYTHONUTF8).toBe('1');
		expect(options.env?.PYTHONIOENCODING).toBe('utf-8');
		expect(options.env?.HF_HUB_OFFLINE).toBe('1');
		expect(options.env?.TRANSFORMERS_OFFLINE).toBe('1');
		expect(options.stdio).toEqual(['pipe', 'pipe', 'ignore']);
		expect(options.timeout).toBe(30000);
		expect(child.stdin.end).toHaveBeenCalledWith(JSON.stringify({ query }));
	});

	it.each([
		['not-json', 0],
		['{}', 1],
	] as const)('rejects malformed output or failed processes', async (response, code) => {
		subprocess(response, code);
		await expect(localEmbedding('публичный тест')).rejects.toThrow();
	});
});
