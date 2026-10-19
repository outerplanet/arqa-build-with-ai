import { type ChatResponse } from '@server/agent/model/agent.schema';
import { type Candidate, type FindPlacesResult, type WalkPlan } from '@server/places/model/places.schema';
import { type WalkingRoute } from '@server/places/model/walkingRoute.schema';

/**
 * What the chat shows for one assistant reply: a one-line summary, the server's caveats, and one
 * card per recommended place.
 *
 * Every card is anchored on a validated tool result (`Candidate`); a recommendation whose place the
 * tools did not return is dropped rather than drawn. The wording — «Почему», the hours sentence,
 * «Что делать» — is the server's: taken from `recommendations` when the server sends them, and
 * otherwise read back out of the reply text it wrote (`formatReply.ts`). The interface never
 * composes a reason or an opening status of its own.
 */
export type Recommendation = NonNullable<ChatResponse['recommendations']>[number];

export type HoursStatus = 'closed' | 'open' | 'unknown';

export interface PlaceCardModel {
	/** «Что делать» — always a generated idea; null when the server gave none. */
	action: string | null;
	candidate: Candidate;
	distanceM: number;
	hours: string;
	hoursStatus: HoursStatus;
	/** True when the distance is a measured leg along OSM footways, not a straight-line estimate. */
	onFootways: boolean;
	order: number;
	visitMinutes: number;
	walkMinutes: number;
	why: string | null;
}

export interface ReplySummary {
	filters: string[];
	headline: string;
	/** Caveats the server wrote outside the place blocks: flight time, night hours, empty search. */
	notes: string[];
	source: string | null;
}

interface ReplyBlock {
	action: string | null;
	hours: string | null;
	name: string;
	why: string | null;
}

/** «N. Name — 562 м, …» or «N. Name — прибытие через …». */
const PLACE_HEAD = /^\d+\.\s+(.+?)\s+—\s/u;
const GENERATED_SUFFIX = /\s*\(сгенерированная идея\)\.?$/u;

function line(block: string, label: string): string | null {
	const found = block.split('\n').find((row) => row.startsWith(`${label}: `));
	return found === undefined
		? null
		: found
				.slice(label.length + 2)
				.replace(/\.$/u, '')
				.trim() || null;
}

function parseReply(reply: string): { blocks: ReplyBlock[]; filters: string[] | null; notes: string[] } {
	const blocks: ReplyBlock[] = [];
	const notes: string[] = [];
	let filters: string[] | null = null;
	const paragraphs = reply
		.split(/\n{2,}/u)
		.map((part) => part.trim())
		.filter(Boolean);
	for (const paragraph of paragraphs) {
		const head = PLACE_HEAD.exec(paragraph);
		if (head) {
			blocks.push({
				action: line(paragraph, 'Что делать')?.replace(GENERATED_SUFFIX, '') ?? null,
				hours: line(paragraph, 'Часы'),
				name: head[1]!,
				why: line(paragraph, 'Почему'),
			});
		} else if (paragraph.startsWith('Фильтры: ')) {
			const value = line(paragraph, 'Фильтры');
			filters = value === null || value === 'дополнительные не заданы' ? [] : value.split('; ');
		} else if (
			!paragraph.startsWith('Локация: ') &&
			!paragraph.startsWith('Пеший маршрут: ') &&
			!paragraph.startsWith('Предложена одна остановка')
		) {
			notes.push(paragraph);
		}
	}
	return { blocks, filters, notes };
}

function hoursFor(candidate: Candidate): string {
	const { open } = candidate;
	if (open.status === 'open') return `открыто${open.until ? ` до ${open.until}` : ' сейчас'} по данным OpenStreetMap`;
	if (open.status === 'closed')
		return `сейчас закрыто по данным OpenStreetMap${open.opensAt ? `, откроется в ${open.opensAt}` : ''}`;
	return 'часы работы неизвестны — уточните перед выходом';
}

export interface PlaceCardsInput {
	candidates: readonly Candidate[];
	recommendations?: readonly Recommendation[];
	reply: string;
	walkingRoute?: WalkingRoute | null;
}

export function buildPlaceCards({
	candidates,
	recommendations = [],
	reply,
	walkingRoute = null,
}: PlaceCardsInput): PlaceCardModel[] {
	const byId = new Map(candidates.map((candidate) => [candidate.place.id, candidate]));
	const legOf = (id: string) => {
		if (walkingRoute?.status !== 'available') return null;
		const index = walkingRoute.stopIds.indexOf(id);
		return index === -1 ? null : (walkingRoute.legs[index] ?? null);
	};

	if (recommendations.length > 0) {
		return [...recommendations]
			.sort((left, right) => left.order - right.order)
			.flatMap((recommendation) => {
				const candidate = byId.get(recommendation.placeId);
				if (candidate === undefined) return [];
				const leg = legOf(candidate.place.id);
				return [
					{
						action: recommendation.action.replace(GENERATED_SUFFIX, '') || null,
						candidate,
						distanceM: leg?.distanceM ?? recommendation.distanceM,
						hours: recommendation.hours,
						hoursStatus: candidate.open.status,
						onFootways: leg !== null,
						order: recommendation.order,
						visitMinutes: recommendation.visitMinutes,
						walkMinutes: leg?.walkMinutes ?? recommendation.walkMinutes,
						why: recommendation.why || null,
					},
				];
			});
	}

	const { blocks } = parseReply(reply);
	return candidates.map((candidate, index) => {
		const block = blocks.find((item) => item.name === candidate.place.name) ?? null;
		const leg = legOf(candidate.place.id);
		return {
			action: block?.action ?? null,
			candidate,
			distanceM: leg?.distanceM ?? candidate.distanceM,
			hours: block?.hours ?? hoursFor(candidate),
			hoursStatus: candidate.open.status,
			onFootways: leg !== null,
			order: index + 1,
			visitMinutes: candidate.visitMinutes,
			walkMinutes: leg?.walkMinutes ?? candidate.walkMinutes,
			why: block?.why ?? null,
		};
	});
}

function places(count: number): string {
	const tens = count % 100;
	const ones = count % 10;
	if (tens >= 11 && tens <= 14) return 'мест';
	if (ones === 1) return 'место';
	if (ones >= 2 && ones <= 4) return 'места';
	return 'мест';
}

function stops(count: number): string {
	return count === 1 ? 'остановка' : count >= 2 && count <= 4 ? 'остановки' : 'остановок';
}

export interface SummaryInput {
	count: number;
	plan: WalkPlan | null;
	reply: string;
	search: FindPlacesResult | null;
	walkingRoute?: WalkingRoute | null;
}

export function summariseReply({ count, plan, reply, search, walkingRoute = null }: SummaryInput): ReplySummary {
	const parsed = parseReply(reply);
	const label = search?.origin.label ?? null;
	const where = label !== null ? ` рядом с ${label}` : search?.origin.source === 'browser' ? ' рядом с вами' : '';
	const minutes = Math.ceil(
		walkingRoute?.status === 'available' ? walkingRoute.totalMinutes : (plan?.totalMinutes ?? 0),
	);
	const headline =
		plan !== null && count > 0
			? `Маршрут: ${String(count)} ${stops(count)} · ≈ ${String(minutes)} мин`
			: count > 0
				? `Нашёл ${String(count)} ${places(count)}${where}`
				: 'Подходящих мест не нашлось';
	const source = search ? (search.origin.source === 'browser' ? 'геолокация браузера' : 'из ваших слов') : null;
	return { filters: parsed.filters ?? [], headline, notes: parsed.notes, source };
}
