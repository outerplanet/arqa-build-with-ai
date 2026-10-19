/** «2026-10-19T12:30:48.822Z» → «19.10.2026» in Astana time; null when the stamp is not a date. */
export function formatSnapshotDate(collectedAt: string): string | null {
	const date = new Date(collectedAt);
	if (Number.isNaN(date.getTime())) return null;
	return new Intl.DateTimeFormat('ru-RU', {
		day: '2-digit',
		month: '2-digit',
		timeZone: 'Asia/Almaty',
		year: 'numeric',
	}).format(date);
}
