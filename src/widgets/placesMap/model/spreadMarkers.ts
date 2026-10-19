export interface ScreenPoint {
	id: string;
	x: number;
	y: number;
}

export interface ScreenOffset {
	dx: number;
	dy: number;
}

/**
 * Markers whose screen positions are closer than `minDistance` are fanned out on a small circle
 * around their common centre, so every marker keeps a clickable area of its own. Markers that do
 * not touch anything keep a zero offset. Pure and deterministic: the same input gives the same
 * layout, so markers do not jitter while the map moves.
 */
export function spreadMarkers(points: readonly ScreenPoint[], minDistance: number): Map<string, ScreenOffset> {
	const parent = points.map((_, index) => index);
	const find = (index: number): number => {
		let root = index;
		while (parent[root] !== root) root = parent[root] ?? root;
		return root;
	};
	for (let a = 0; a < points.length; a += 1) {
		for (let b = a + 1; b < points.length; b += 1) {
			const pa = points[a];
			const pb = points[b];
			if (pa && pb && Math.hypot(pa.x - pb.x, pa.y - pb.y) < minDistance) parent[find(b)] = find(a);
		}
	}
	const groups = new Map<number, number[]>();
	for (const index of points.keys()) {
		const root = find(index);
		groups.set(root, [...(groups.get(root) ?? []), index]);
	}
	const offsets = new Map<string, ScreenOffset>();
	for (const point of points) offsets.set(point.id, { dx: 0, dy: 0 });
	for (const members of [...groups.values()].filter((item) => item.length > 1)) {
		const group = members.map((index) => points[index]).filter((point) => point !== undefined);
		const cx = group.reduce((sum, point) => sum + point.x, 0) / group.length;
		const cy = group.reduce((sum, point) => sum + point.y, 0) / group.length;
		// Neighbours on a regular polygon are 2·r·sin(π/n) apart; that distance must be minDistance.
		const radius = minDistance / (2 * Math.sin(Math.PI / group.length));
		const ordered = group
			.map((point, index) => ({
				angle: point.x === cx && point.y === cy ? Number.NaN : Math.atan2(point.y - cy, point.x - cx),
				index,
				point,
			}))
			.sort((left, right) => {
				const a = Number.isNaN(left.angle) ? Number.POSITIVE_INFINITY : left.angle;
				const b = Number.isNaN(right.angle) ? Number.POSITIVE_INFINITY : right.angle;
				return a === b ? left.index - right.index : a - b;
			});
		const first = ordered[0]?.angle;
		const start = first === undefined || Number.isNaN(first) ? -Math.PI / 2 : first;
		for (const [slot, { point }] of ordered.entries()) {
			const angle = start + (slot * 2 * Math.PI) / group.length;
			offsets.set(point.id, {
				dx: cx + radius * Math.cos(angle) - point.x,
				dy: cy + radius * Math.sin(angle) - point.y,
			});
		}
	}
	return offsets;
}
