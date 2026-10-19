# План — «Прогулки по Астане»

Лид — **Саян**: только он меняет этот файл, `package.json` и `pnpm-lock.yaml`. Остальные пишут в
раздел **Запросы** внизу. Каждый агент читает этот файл перед началом работы и после каждого
`git pull`. Правила составления плана — в `AGENTS.md`, раздел **Every plan is split into lanes**.

**Код пишут агенты, люди ставят задачи и проверяют.** У каждой дорожки ниже есть готовые промпты:
скопируйте в Claude Code или Codex как есть. Второй агент на том же компьютере работает только в
отдельном worktree (`AGENTS.md`, **More than one agent on one laptop**).

---

## Задача

Кейс НИЦ Smart City — `docs/case.md`. Оценка решается первым критерием: **релевантность и
полезность рекомендаций с учётом локации, времени и режима работы**, и у каждой — «почему».

## Сценарий

Пользователь пишет: «Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком», — и
получает 1–3 места рядом: расстояние и минуты пешком, «почему», время на посещение, «что делать
там», источник (OSM / Wikidata / сгенерировано) и честный статус часов работы. Места появляются на
карте, по кнопке строится мини-маршрут. В панели активности видно, какие инструменты вызвал агент.

## Решения, принятые до старта

Подробно — в `docs/decisions.md`.

- Стек шаблона: Next.js + TypeScript, агент с инструментами, `LLM_PROVIDER=mock` без ключа.
- Модель — OpenAI Responses API; эмбеддинги — `text-embedding-3-small` с `dimensions: 256`.
- Данные — OpenStreetMap (Overpass API) + Wikidata. Сбор — `pnpm collect`, на TypeScript.
- RAG без векторной базы: векторы в `data/poi.vectors.json`, поиск в памяти. Базы данных нет.
- Карта — MapLibre GL + тайлы OpenFreeMap, без ключа.
- Палитра «Астана», светлая тема по умолчанию. Весь интерфейс — на русском.
- Приватность: координаты пользователя округляются до 3 знаков (~100 м), не хранятся и не логируются.

---

## Контракт — Саян пишет первым, замораживается к 14:00

Контракт реализован в `src/server/places/model/places.schema.ts`: схемы экспортируются под
именами `geoPointSchema`, `placeSchema`, `openStatusSchema`, `candidateSchema`,
`findPlacesInputSchema`, `findPlacesResultSchema`, `resolveLocationInputSchema`,
`resolvedLocationSchema`, `planWalkInputSchema`, `walkPlanSchema`, `getPlaceInputSchema` и
`categorySchema`; типы — под именами из контракта ниже. `FindPlacesInput` и `PlanWalkInput`
описывают результат валидации: поля с default уже заполнены. Для аргументов до валидации
используйте `z.input<typeof findPlacesInputSchema>` / `z.input<typeof planWalkInputSchema>`.
Время при отсутствии `at` должен подставить usecase из `ctx.now`.

Добавлены MapLibre и команды `collect` / `embed`. Скрипты `scripts/collect.ts` и
`scripts/embed.ts` ещё должен создать Адиль; до этого эти две команды не выполнят сбор данных.

Схема: `src/server/places/model/places.schema.ts` (только zod, без `server-only` — интерфейс её
импортирует). Ниже — то, что в ней должно быть. Имена и поля менять только через лида.

```ts
export const CATEGORIES = [
  'cafe', 'restaurant', 'fast_food', 'bar', 'nightclub', 'museum', 'gallery', 'theatre',
  'cinema', 'park', 'garden', 'playground', 'viewpoint', 'attraction', 'monument', 'artwork',
  'mall', 'library', 'zoo', 'theme_park', 'sports', 'place_of_worship', 'other',
] as const;

GeoPoint      = { lat: number; lon: number }

Place = {
  id: string;                       // 'osm:node/123456' | 'osm:way/…' | 'osm:relation/…'
  name: string;                     // на русском, если есть name:ru
  nameEn: string | null;
  category: Category;
  tags: string[];                   // нормализованные: 'wifi', 'power_sockets', 'outdoor_seating',
                                    // 'kids', 'free', 'wheelchair', 'night', 'view', 'interactive'
  lat: number; lon: number;
  address: string | null;
  description: string | null;
  descriptionSource: 'osm' | 'wikidata' | 'generated' | null;
  openingHours: string | null;      // сырая строка OSM opening_hours
  website: string | null; phone: string | null;
  wheelchair: 'yes' | 'limited' | 'no' | null;
  popularity: number | null;        // 0–1, из числа sitelinks Wikidata и признаков OSM
  sourceUrl: string;                // https://www.openstreetmap.org/node/123456
}

OpenStatus = {
  status: 'open' | 'closed' | 'unknown';
  confidence: 'high' | 'low' | 'none';   // high — строка разобрана полностью; low — частично; none — данных нет
  until: string | null;                  // 'HH:MM', когда закроется (если open)
  opensAt: string | null;                // 'HH:MM', когда откроется (если closed и известно)
  note: string;                          // по-русски: «по данным OSM открыто до 22:00» / «часы работы неизвестны»
}

Candidate = {
  place: Place;
  distanceM: number;  walkMinutes: number;
  open: OpenStatus;
  visitMinutes: number;                  // типичное время на посещение по категории
  score: number;                         // 0–1
  why: { semantic: number; distance: number; open: number; popularity: number; tags: string[] };
}

FindPlacesInput  = { query: string; near?: GeoPoint; maxWalkMinutes?: 5–90 (default 15);
                     categories?: Category[]; at?: string /* ISO, default ctx.now */;
                     limit?: 1–10 (default 5); accessibleOnly?: boolean }
FindPlacesResult = { origin: { point: GeoPoint; source: 'browser' | 'text'; label: string | null };
                     candidates: Candidate[]; usedFilters: string[] /* по-русски, для ответа */;
                     note: string | null }

ResolveLocationInput = { text: string }
ResolvedLocation     = { found: boolean; point: GeoPoint | null; label: string | null;
                         matchedPlaceId: string | null; confidence: 'high' | 'low' }

PlanWalkInput = { start: GeoPoint; durationMinutes: 20–240; query?: string;
                  categories?: Category[]; maxStops?: 2–3 (default 3) }
WalkPlan      = { stops: { order: number; candidate: Candidate; arriveAtMinute: number }[];
                  legs: { from: GeoPoint; to: GeoPoint; distanceM: number; walkMinutes: number }[];
                  totalMinutes: number; note: string /* «расстояния по прямой ×1,3» */ }

GetPlaceInput = { id: string }  →  Place
```

Запрос чата (`src/server/agent/model/agent.schema.ts`) получает необязательное поле
`location?: GeoPoint` — его присылает браузер, если пользователь разрешил геолокацию. Сервер
округляет его ещё раз и никуда не пишет.

### Инструменты агента

| Инструмент | Аргументы | Возвращает | Пишет данные? | Владелец |
| --- | --- | --- | --- | --- |
| `resolve_location` | `ResolveLocationInput` | `ResolvedLocation` — «возле Экспо» → координаты по нашему же датасету и списку ориентиров | нет | Саян |
| `find_places` | `FindPlacesInput` | `FindPlacesResult` | нет | Саян |
| `get_place` | `GetPlaceInput` | `Place` или отказ «не нашёл» | нет | Саян |
| `plan_walk` | `PlanWalkInput` | `WalkPlan` | нет | Саян |
| `get_current_time` | есть в шаблоне | — | нет | — |

### Чистые функции и чтение данных

| Функция | Сигнатура | Файл | Владелец |
| --- | --- | --- | --- |
| `distanceM` | `(a: GeoPoint, b: GeoPoint) => number` — гаверсинус | `src/server/places/model/geo.ts` | Абылай |
| `walkMinutes` | `(distanceM: number) => number` — ×1,3 на изгибы улиц, 75 м/мин | `geo.ts` | Абылай |
| `roundPoint` | `(p: GeoPoint, decimals?: number) => GeoPoint` — по умолчанию 3 знака | `geo.ts` | Абылай |
| `openStatus` | `(raw: string \| null, at: Date) => OpenStatus` — время Астаны UTC+5, фиксированный сдвиг | `src/server/places/model/hours.ts` | Абылай |
| `lexicalScores` | `(query: string, places: readonly Place[]) => Map<string, number>` — запасной поиск без ключа | `src/server/places/model/lexical.ts` | Абылай |
| `rankPlaces` | `(input: RankInput) => Candidate[]` | `src/server/places/model/rank.ts` | Абылай |
| `planWalk` | `(input: { start: GeoPoint; durationMinutes: number; candidates: readonly Candidate[]; maxStops: number }) => WalkPlan` | `src/server/places/model/route.ts` | Абылай |
| `readPlaces` | `() => readonly Place[]` — синхронно, с кэшем, проверка zod-схемой | `src/server/places/repo/places.ts` | Адиль |
| `readVectors` | `() => { model: string; dims: number; byId: Map<string, Float32Array> } \| null` | `src/server/places/repo/vectors.ts` | Адиль |
| `getPlaceById` | `(id: string) => Place \| null` | `repo/places.ts` | Адиль |

`RankInput = { places; origin: GeoPoint; at: Date; maxWalkMinutes; categories?; accessibleOnly?;
semantic: Map<string, number>; limit }`. Usecase Саяна считает `semantic` (косинус с эмбеддингом
запроса, а без ключа — `lexicalScores`) и передаёт в `rankPlaces`.

---

## Дорожки

Пути не пересекаются. Нужен файл чужой дорожки — строка в **Запросах**, не правка.

### Саян — лид: контракт, инструменты агента, промпт, mock, README

- **Пути:** `src/server/places/model/places.schema.ts`, `src/server/places/usecase/**`,
  `src/server/agent/**`, `src/app/api/**`, `package.json`, `pnpm-lock.yaml`, `README.md`,
  `docs/plan.md`, `docs/decisions.md`.
- **Задачи по порядку:**
  - [ ] **13:30–14:00** Схема `places.schema.ts` по контракту выше; в `package.json` — зависимость
        `maplibre-gl` и скрипты `"collect": "tsx --conditions=react-server scripts/collect.ts"`,
        `"embed": "tsx --conditions=react-server scripts/embed.ts"`. Коммит и пуш **до 14:00** —
        от этого зависят все.
  - [ ] Поле `location` в запросе чата; маршрут `/api/chat` передаёт его агенту.
  - [ ] Usecase-функции `findPlaces`, `resolveLocation`, `planWalk`, `getPlace` в
        `src/server/places/usecase/` поверх репозитория Адиля и функций Абылая. Эмбеддинг запроса —
        через OpenAI SDK с `dimensions: 256`; без ключа или без векторов — `lexicalScores`.
        Список ориентиров для `resolve_location` (Экспо / Нур Алем, Байтерек, Хан Шатыр,
        Mega Silk Way, вокзалы «Нурлы Жол» и «Астана-1», аэропорт, Ак Орда, Дворец мира и
        согласия, ЕНУ, AITU) — в `usecase/landmarks.ts`.
  - [ ] Четыре инструмента в `TOOLS`; проверить, что `executeTool` дожидается асинхронных
        обработчиков (эмбеддинг — сетевой вызов).
  - [ ] Промпт: формат ответа из кейса (1–3 места; «почему», время, «что делать», источник,
        статус часов); никогда не утверждать «открыто» без `open.status === 'open'`; пометка
        «сгенерированная идея» для всего, чего нет в результатах инструментов; если локации нет
        ни в запросе, ни в браузере — спросить.
  - [ ] Mock: сценарные ветки для шести сценариев из `docs/scenarios.md`, через настоящие
        инструменты.
  - [ ] Живая модель на шести сценариях — правка описаний инструментов и промпта, пока ответы не
        станут конкретными.
  - [ ] README: заполнить каркас по факту. Проверка свежим клоном в 22:30.
- **Зависит от:** `readPlaces` (Адиль), функции Абылая.
- **Заглушки, пока ждёт:** до 14:30 в обоих местах будут наивные версии с настоящими сигнатурами;
  до них — `data/poi.sample.json` Адиля.
- **Готово, когда:** шесть сценариев отвечают по формату кейса и в `mock`, и с живой моделью;
  `pnpm check` зелёный.

### Абылай — алгоритмы: расстояния, часы работы, ранжирование, мини-маршрут

- **Пути:** `src/server/places/model/geo.ts`, `hours.ts`, `lexical.ts`, `rank.ts`, `route.ts` и
  их `*.spec.ts`.
- **Задачи по порядку:**
  - [ ] **До 14:30** — все пять файлов с настоящими сигнатурами и простой реализацией (ранжирование
        только по расстоянию, маршрут — первые два кандидата), закоммичены и запушены. Это
        разблокирует Саяна.
  - [ ] `geo.ts` + тесты: гаверсинус (проверить на Байтерек ↔ Хан Шатыр ≈ 1,9 км), минуты пешком,
        округление.
  - [ ] `hours.ts` + тесты: разбор частых форм OSM `opening_hours` — `24/7`; `Mo-Fr 09:00-18:00`;
        несколько правил через `;`; несколько интервалов через `,`; дни списком `Mo,We,Fr`;
        `off`; интервал через полночь `18:00-02:00`; `PH` игнорировать с понижением уверенности.
        Всё, что не разобрано полностью, — `confidence: 'low'` или `status: 'unknown'`, **никогда
        не угадывать**. Время Астаны — фиксированный UTC+5.
  - [ ] `lexical.ts` + тесты: нормализация (нижний регистр, ё→е, грубое отсечение окончаний),
        совпадение по названию, тегам, описанию; словарь синонимов «слово → категории/теги»
        (кофе→cafe; ребёнок, дети→playground, zoo, museum + kids; ночь, ночной→bar, nightclub +
        night; вид, смотровая→viewpoint; розетка→power_sockets; тихо→library, park, cafe).
  - [ ] `rank.ts` + тесты: фильтр по радиусу (`maxWalkMinutes`), категориям, доступности;
        `score = 0,40·semantic + 0,25·distance + 0,15·open + 0,10·popularity + 0,10·tags`
        (веса — константы с комментарием, почему такие); `closed` опускается вниз, `unknown` не
        выкидывается; `visitMinutes` по категории (музей 60, парк 40, кафе 30, смотровая 20…).
  - [ ] `route.ts` + тесты: перебор упорядоченных наборов из 2–3 мест среди топ-12 кандидатов;
        максимум суммы `score` при условии «ходьба + посещение ≤ durationMinutes»; ноги по прямой
        ×1,3.
  - [ ] Подстройка весов на реальных данных вместе с Саяном (после 17:00).
- **Зависит от:** только схемы (14:00). Данные для тестов — маленькие массивы прямо в спеке.
- **Готово, когда:** на каждую функцию есть тесты, включая края (пустой список, всё закрыто,
  непонятная строка часов), `pnpm check` зелёный.

### Адиль — данные: сбор, качество, эмбеддинги; затем сценарии и презентация

- **Пути:** `scripts/collect.ts`, `scripts/embed.ts`, `data/**`, `src/server/places/repo/**` и
  их спеки, `docs/scenarios.md`, `docs/presentation*`.
- **Задачи по порядку:**
  - [ ] **До 14:00** — `data/poi.sample.json`: 15 реальных мест Астаны вручную по схеме (Байтерек,
        Хан Шатыр, Нур Алем, Mega Silk Way, Центральный парк, Ботанический сад, Национальный музей,
        Астана Опера, Дворец мира и согласия, 3–4 кафе, детская площадка, бар), координаты с
        openstreetmap.org. И `repo/places.ts`, который читает `data/poi.json`, а если его нет —
        `data/poi.sample.json`. Коммит и пуш — это разблокирует Саяна.
  - [ ] `scripts/collect.ts` (`pnpm collect`): запрос к Overpass API по границе Астаны (bbox
        примерно 51.03–51.25 с. ш., 71.25–71.65 в. д.) — `amenity`, `tourism`, `leisure`,
        `historic`, `shop=mall`; только объекты с именем; центр для `way`/`relation`
        (`out center`). Нормализация в `Place`: категория, теги, `name:ru`, адрес, часы, сайт,
        `wheelchair`, `sourceUrl`. Дедупликация (одно имя в радиусе 50 м). Повтор с паузой при
        429/504 и запасное зеркало. Вежливый `User-Agent` с контактом.
  - [ ] Обогащение из Wikidata для объектов с тегом `wikidata`: описание на русском и число
        sitelinks → `popularity`. Не больше 50 id в одном запросе.
  - [ ] Итог сбора — `data/collect_summary.json`: время, число мест по категориям, доля с часами
        работы, с описанием, с Wikidata; атрибуция OSM (ODbL) и Wikidata (CC0). Проверить глазами
        20 случайных мест.
  - [ ] `scripts/embed.ts` (`pnpm embed`): текст «название · категория · теги · описание» →
        `text-embedding-3-small`, `dimensions: 256`, пачками по 100, округление до 4 знаков →
        `data/poi.vectors.json`. Файл коммитится, чтобы остальным не нужен был ключ. И
        `repo/vectors.ts`.
  - [ ] (по желанию, если останется время) короткие описания для музеев, парков и
        достопримечательностей без описания — генерация моделью с `descriptionSource:
        'generated'`.
  - [ ] **С 18:00** — `docs/scenarios.md`: прогнать шесть сценариев, вписать фактические ответы
        системы; раздел про ограничения и приватность. Экспорт в PDF.
  - [ ] **С 19:00** — презентация (5–7 минут): проблема → решение → как работает RAG → демо →
        этика и приватность → ограничения и риски → план развития. PDF в `docs/presentation.pdf`.
- **Зависит от:** только схемы.
- **Готово, когда:** `pnpm collect` с нуля пересобирает `data/poi.json`, итоговые цифры
  записаны; векторы закоммичены; сценарии и презентация в PDF.

### Экран — Ораз, если участвует; если нет — второй агент Саяна в worktree

- **Пути:** `src/views/**`, `src/widgets/**`, `src/app/page.tsx`, `src/app/layout.tsx`,
  `src/app/globals.css`.
- **Задачи по порядку:**
  - [ ] Экран в две колонки: чат с панелью активности слева, карта справа (MapLibre GL, стиль
        OpenFreeMap `positron` для светлой темы; для тёмной — тёмный стиль OpenFreeMap, если есть,
        иначе тот же). Атрибуция «© участники OpenStreetMap, OpenFreeMap» видна всегда. На
        телефоне — карта сверху, чат снизу.
  - [ ] Кнопка «Использовать мою геолокацию» с пояснением «координаты округляются до ~100 м и
        нигде не сохраняются»; округление на клиенте до 3 знаков, отправка в `location`.
  - [ ] Чипсы с шестью сценариями из кейса в пустом чате.
  - [ ] Маркеры мест из результатов `find_places` и `plan_walk` в `toolCalls` — карта показывает
        то, что вернул сервер, а не догадки. Клик по маркеру — карточка: название, расстояние и
        минуты, статус часов текстом (не только цветом), источник («OSM», «Wikidata»,
        «сгенерировано»), ссылка на объект в OSM.
  - [ ] Линия мини-маршрута с номерами остановок и подписью «по прямой».
  - [ ] Пустое, загрузочное и ошибочное состояния; проверка в светлой и тёмной теме.
- **Зависит от:** схемы (14:00), формы результатов инструментов (16:00).
- **Заглушки, пока ждёт:** карта с маркерами из `data/poi.sample.json`, импортированного как пример.
- **Готово, когда:** сценарий с Экспо выглядит на экране как в кейсе, на ноутбуке и в мобильной
  ширине.

---

## Точки интеграции

| Что с чем встречается | В каком файле | К какому времени |
| --- | --- | --- |
| Схема → все дорожки | `src/server/places/model/places.schema.ts` | 14:00 |
| Пример данных и `readPlaces` → usecase Саяна | `data/poi.sample.json`, `repo/places.ts` | 14:00 |
| Наивные функции Абылая → usecase Саяна | `src/server/places/model/*.ts` | 14:30 |
| Результаты инструментов → маркеры и карточки | `toolCalls[].result` (`FindPlacesResult`, `WalkPlan`) | 16:00 |
| Полный датасет → поиск | `data/poi.json` | 16:00 |
| Векторы → семантический поиск | `data/poi.vectors.json` | 18:00 |

## Контрольные точки

Каждая дорожка коммитит и пушит к каждому времени что-то работающее.

| К | Саян | Абылай | Адиль | Экран |
| --- | --- | --- | --- | --- |
| 14:00 | Схема, зависимости, скрипты | Сигнатуры всех функций | Пример данных + `readPlaces` | Каркас страницы с картой |
| 16:00 | Инструменты и mock на примере данных | `geo`, `hours`, `lexical` с тестами | Полный `poi.json` + итог сбора | Чат + карта + чипсы, маркеры из результатов |
| 18:00 | Живая модель на шести сценариях | `rank`, `route` с тестами | Векторы; черновик сценариев | Карточки, геолокация, линия маршрута |
| 20:00 | Промпт отполирован, README | Веса подстроены на реальных данных | Черновик презентации | Мобильная ширина, тёмная тема |
| 21:30 | **Код заморожен.** Дальше — только исправления | — | Сценарии с реальными ответами | — |
| 22:30 | Свежий клон проверен, видео записано | Помогает с видео | PDF презентации и сценариев | — |
| 23:30 | **Форма отправлена**, репозиторий публичный | | | |

---

## Готовые промпты для агентов

Вставлять как есть. В начале каждой сессии агент сам читает `AGENTS.md`.

### Саян, агент 1 — контракт и инструменты

```text
Прочитай AGENTS.md, docs/case.md, docs/kickoff.md и docs/plan.md. Ты работаешь в дорожке
«Саян — лид» и только в её путях.

Шаг 1, срочно: напиши src/server/places/model/places.schema.ts строго по разделу «Контракт» в
docs/plan.md (zod, без server-only, типы через z.infer). Добавь в package.json зависимость
maplibre-gl и скрипты collect и embed из плана. pnpm check — зелёный. Закоммить только эти пути
с сообщением «feat(places): contract schema» и скажи мне — я запушу.

Шаг 2: добавь необязательное поле location в запрос чата и передай его агенту через /api/chat.
Шаг 3: usecase-функции findPlaces, resolveLocation, planWalk, getPlace и landmarks.ts в
src/server/places/usecase/, поверх repo/places.ts (Адиль) и model/*.ts (Абылай). Эмбеддинг
запроса — OpenAI SDK, text-embedding-3-small, dimensions 256; без ключа или векторов — lexicalScores.
Шаг 4: четыре инструмента в TOOLS, проверь, что executeTool ждёт асинхронные обработчики.
Шаг 5: промпт по правилам из плана и mock-ветки для шести сценариев из docs/scenarios.md.

После каждого шага — pnpm check и отдельный коммит своих путей по имени (не git add -A).
Не пушь. Чужой файл нужен — допиши строку в «Запросы» в docs/plan.md и скажи мне.
```

### Саян, агент 2 (в worktree) — экран, если Ораз не участвует

```text
Прочитай AGENTS.md, docs/case.md, docs/design-system.md, docs/ui-patterns.md и docs/plan.md.
Ты работаешь в дорожке «Экран» и только в её путях: src/views/**, src/widgets/**,
src/app/page.tsx, src/app/layout.tsx, src/app/globals.css.

Сделай экран по задачам дорожки сверху вниз: чат с панелью активности + карта MapLibre GL с
тайлами OpenFreeMap, геолокация с согласием и округлением до 3 знаков, чипсы шести сценариев,
маркеры и карточки мест ТОЛЬКО из результатов инструментов в toolCalls, линия мини-маршрута.
Весь текст — по-русски. Только семантические токены цвета из globals.css, никаких сырых цветов.
Пока инструментов нет — маркеры из data/poi.sample.json.

После каждого заметного шага — pnpm check и коммит своих путей по имени. Не пушь.
Проверь вид в светлой и тёмной теме и в ширине 390 px.
```

### Абылай, агент 1 — сигнатуры, geo, hours

```text
Прочитай AGENTS.md, docs/case.md и docs/plan.md. Ты работаешь в дорожке «Абылай — алгоритмы»
и только в её путях: src/server/places/model/{geo,hours,lexical,rank,route}.ts и их *.spec.ts.
Схема — src/server/places/model/places.schema.ts (её пишет Саян; если её ещё нет — подожди
git pull, не создавай сам).

Шаг 1, срочно: создай все пять файлов с сигнатурами из таблицы «Чистые функции» в плане и
простыми реализациями (ранжирование только по расстоянию, маршрут — первые два кандидата).
pnpm check, коммит «feat(places): algorithm signatures», скажи мне — я запушу.
Шаг 2: geo.ts с тестами. Шаг 3: hours.ts с тестами — все формы opening_hours из плана, время
Астаны фиксированное UTC+5; всё, что не разобрано полностью, — низкая уверенность или unknown,
никогда не угадывать.

Чистые синхронные функции, без ввода-вывода, ctx не нужен — время приходит аргументом.
После каждого шага — pnpm check и коммит своих путей по имени. Не пушь.
```

### Абылай, агент 2 (в worktree) — lexical, rank, route

```text
Прочитай AGENTS.md, docs/case.md и docs/plan.md. Ты работаешь в дорожке «Абылай — алгоритмы»,
только в файлах src/server/places/model/{lexical,rank,route}.ts и их спеках (geo.ts и hours.ts
пишет другой агент — используй их, не меняй).

Сделай по плану: lexical.ts со словарём синонимов, rank.ts с фильтрами и формулой score из плана
(веса — именованные константы с комментарием), route.ts — перебор 2–3 мест среди топ-12 при
ограничении по времени. На каждую функцию — тесты с краями: пустой список, всё закрыто,
кандидатов меньше, чем maxStops, время не позволяет ни одного места.
После каждого шага — pnpm check и коммит своих путей по имени. Не пушь.
```

### Адиль, агент 1 — пример данных и сбор

```text
Прочитай AGENTS.md, docs/case.md, docs/kickoff.md и docs/plan.md. Ты работаешь в дорожке
«Адиль — данные», только в путях scripts/collect.ts, scripts/embed.ts, data/**,
src/server/places/repo/** и их спеках.

Шаг 1, срочно: data/poi.sample.json — 15 реальных мест Астаны по схеме Place из
src/server/places/model/places.schema.ts (список в плане, координаты с openstreetmap.org, id и
sourceUrl — настоящие объекты OSM). И src/server/places/repo/places.ts: readPlaces() и
getPlaceById() — синхронно, с кэшем, проверка zod-схемой; читает data/poi.json, а если его нет —
data/poi.sample.json. pnpm check, коммит, скажи мне — я запушу.

Шаг 2: scripts/collect.ts (pnpm collect) по плану: Overpass по bbox Астаны, нормализация в Place,
дедупликация, Wikidata для описаний и popularity, повторы при 429/504 и запасное зеркало,
data/collect_summary.json с цифрами и атрибуцией OSM (ODbL) и Wikidata (CC0). Запусти, покажи мне
итоговые цифры и 20 случайных мест.

Никакого парсинга Google, 2GIS или Яндекса — только OSM и Wikidata.
После каждого шага — pnpm check и коммит своих путей по имени. Не пушь.
```

### Адиль, агент 2 — эмбеддинги, потом сценарии

```text
Прочитай AGENTS.md, docs/case.md и docs/plan.md. Ты в дорожке «Адиль — данные».
Шаг 1: scripts/embed.ts (pnpm embed) и src/server/places/repo/vectors.ts по плану:
text-embedding-3-small, dimensions 256, пачками по 100, округление до 4 знаков, файл
data/poi.vectors.json коммитится. Ключ — из .env (LLM_API_KEY), в код и в логи не попадает.
Шаг 2 (с 18:00): docs/scenarios.md — прогони шесть сценариев в запущенном приложении
(pnpm dev), впиши фактические ответы, проверь каждый по требованиям кейса: 1–3 места, «почему»,
время, «что делать», источник, честный статус часов. Где не так — строка в «Запросы» для Саяна.
После каждого шага — pnpm check и коммит своих путей по имени. Не пушь.
```

---

## Запросы

Изменение, которое нужно в чужом пути. Новые — внизу. Формат: `время — кто → кому: что, в каком файле`.

- *(пока пусто)*
