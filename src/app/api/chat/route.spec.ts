import { runAgent } from '@server/agent/usecase/agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

vi.mock('@server/agent/usecase/agent', () => ({ runAgent: vi.fn() }));

const messages = [{ content: 'Хочу прогуляться', role: 'user' }];

function request(body: unknown): Request {
	return new Request('http://localhost/api/chat', {
		body: JSON.stringify(body),
		headers: { 'Content-Type': 'application/json' },
		method: 'POST',
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(runAgent).mockResolvedValue({ reply: 'Где вы находитесь?', toolCalls: [] });
});

describe('POST /api/chat location boundary', () => {
	it('passes only rounded browser coordinates to the agent', async () => {
		const response = await POST(request({ location: { accuracy: 5, lat: 51.123456, lon: 71.456789 }, messages }));

		expect(response.status).toBe(200);
		expect(runAgent).toHaveBeenCalledWith(expect.anything(), {
			location: { lat: 51.123, lon: 71.457 },
			messages,
		});
	});

	it('keeps requests without browser permission working', async () => {
		expect((await POST(request({ messages }))).status).toBe(200);
		expect(runAgent).toHaveBeenCalledWith(expect.anything(), { messages });
	});

	it.each([{ lat: 91, lon: 71 }, { lat: 51, lon: 181 }, { lat: '51', lon: 71 }, null])(
		'rejects invalid coordinates before calling the agent: %j',
		async (location) => {
			expect((await POST(request({ location, messages }))).status).toBe(400);
			expect(runAgent).not.toHaveBeenCalled();
		},
	);

	it('does not log coordinates echoed in a provider error', async () => {
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		vi.mocked(runAgent).mockRejectedValue(new Error('Provider rejected lat=51.123 lon=71.457'));

		try {
			const response = await POST(request({ messages }));

			expect(response.status).toBe(500);
			expect(JSON.stringify(await response.json())).not.toContain('51.123');
			expect(stderr).toHaveBeenCalledExactlyOnceWith('Chat request failed: Error\n');
		} finally {
			stderr.mockRestore();
		}
	});
});
