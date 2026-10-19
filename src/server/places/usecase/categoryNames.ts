import { type Category } from '@server/places/model/places.schema';
import 'server-only';

export const categoryNames: Record<Category, string> = {
	artwork: 'арт-объект',
	attraction: 'достопримечательность',
	bar: 'бар',
	cafe: 'кафе',
	cinema: 'кинотеатр',
	fast_food: 'место быстрого питания',
	gallery: 'галерея',
	garden: 'сад',
	library: 'библиотека',
	mall: 'торговый центр',
	monument: 'памятник',
	museum: 'музей',
	nightclub: 'ночной клуб',
	other: 'место из набора данных',
	park: 'парк',
	place_of_worship: 'религиозный объект',
	playground: 'детская площадка',
	restaurant: 'ресторан',
	sports: 'спортивный объект',
	theatre: 'театр',
	theme_park: 'парк развлечений',
	viewpoint: 'смотровая площадка',
	zoo: 'зоопарк',
};
