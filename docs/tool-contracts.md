# MCP: API-контракты и целевой набор инструментов

Дата проверки: 2026-10-14. Статус: набор v1 реализован локально; проверен контрактными и MCP-тестами. Проверка на живом пользовательском API не выполнялась.

## Источники и границы проверки

- MCP: `main`, `9b5998a`, после fetch и fast-forward из `origin/main`.
- WM backend: свежий `origin/master`, `aee37dd64feab13bdf2a7ebaf0beb91aadfda75c` (2026-10-13), репозиторий `white-maps-backend`. Проверялись исходники этого коммита, извлечённые отдельно; рабочая ветка backend не изменена.
- Data Catalog: [OpenAPI staging](https://whitemaps-staging.mapflow.ai/rest/rasters/openapi.json), HTTP 200, получена 2026-10-14. Проверяемая выдержка сохранена в `evidence/data-catalog-mosaics.openapi.json`. Это контракт staging, не подтверждение версии production.
- Маршрутизация: `mapflow-platform-kubernetes/charts/mapflow/templates/ingress-api.yaml`: `/rest` → WM, `/rest/rasters` → Data Catalog.
- Агент: `mapflow-adk-agent/app/tools.py`, `app/mapflow_client.py`; клиент: `mapflow-client/src/types/mosaic.ts`, `src/shared/api/client/index.ts` — вспомогательная проверка использования API.

Локальный `data-catalog` находится на старом коммите `b33a43a`; обновление remote завершилось ошибкой доступа/отсутствия проекта. Поэтому старые исходники не считаются доказательством текущего контракта. Запросы к пользовательским данным, запуск обработок и скачивание чужих результатов не выполнялись. Проверка исходников и схем не заменяет интеграционные проверки с тестовым аккаунтом.

Пути Scala ниже относительно `src/main/scala/io/geoalert/mapflow/` в указанном коммите WM. Проверка воспроизводится через `git show aee37dd6:<полный путь>`.

## Подтверждённые API

### Проекты

Источник: `rest/ProjectResource.scala`, `rest/json/ProjectJson.scala`, `graphql/args/project/ProjectFilters.scala`, `repo/ProjectRepo.scala`, `service/ProjectService.scala`.

| Операция | REST | Вход | Ответ |
|---|---|---|---|
| Страница проектов | `POST /rest/projects/page` | JSON: `offset?`, `limit?`, `filter?`, `sortBy?`, `sortOrder?` | `{results: Project[], total, count}` |
| Проект по ID | `GET /rest/projects/{projectId}` | UUID | `Project` |
| Проект по умолчанию | `GET /rest/projects/default` | — | `Project` |
| Все проекты | `GET /rest/projects` | — | `Project[]`; в MCP использовать страницу |
| Страница обработок проекта | `POST /rest/projects/{projectId}/processings/v2/page` | `ProcessingFilters` | `{results: ProcessingV2[], total, count}` |

`filter` ищет по имени проекта или email участника, а не только по имени. `sortBy`: `NAME | CREATED | UPDATED`; `sortOrder`: `ASC | DESC`. MCP всегда передаёт лимит и сортировку, не полагаясь на неограниченные backend defaults.

Project содержит `id`, `name`, `description`, `isDefault`, `created`, `updated`, `area`, `processingCounts`, `workflowDefs`, `starred` и дополнительные поля. Площадь — м². В компактный ответ MCP не включать полный объект владельца и состав участников без необходимости.

Создание, изменение, архивирование, sharing и публикация проектов существуют, но не входят в первый набор MCP. Для запуска достаточно существующего или default-проекта.

### Мозаики / My Imagery

Это публичные пользовательские endpoints Data Catalog, не внутренние `/api/mosaic/*` с сервисными полномочиями.

| Операция | REST | Вход | Ответ |
|---|---|---|---|
| Страница мозаик | `GET /rest/rasters/mosaic/page` | query: `limit=20` (1–100), `offset=0` (≥0), `sort=created_at`, `order=desc`, `tags?` (повторяемый query), `name_contains?` (1–255 символов) | `{items, limit, offset, total, has_next}` |
| Мозаика по ID | `GET /rest/rasters/mosaic/{mosaicId}` | UUID | `MosaicReturnSchema`; схема также допускает объект `{message}` |
| Статус мозаики | `GET /rest/rasters/mosaic/{mosaicId}/status` | UUID | счётчики и `images[]` |

Сортировка мозаик: `created_at | name | size_in_bytes`, направление `asc | desc`. Клиент описывает `name_contains` как поиск по имени мозаики или имени вложенного файла; сама OpenAPI подтверждает параметр и ограничения, но не точную семантику поиска. Эту семантику ещё проверить интеграционно.

Мозаика: `id`, `name`, `tags` (nullable), `created_at`, `rasterLayer`, `footprint` (строка), `sizeInBytes`, `status_summary`. Исторический backend отдаёт footprint как WKT; клиент использует преобразователь. MCP должен вернуть проверенный GeoJSON `geometry` или `null` с предупреждением при непонятном/пустом footprint, а не передавать строку туда, где требуется GeoJSON. OpenAPI не фиксирует кодирование строки.

Статус: `total_images`, `ready_images`, `pending_images`, `in_progress_images`, `failed_images`, `loading_images` (default 0), `tiles_ready_images`, `images[]`. В изображениях есть `image_id`, `filename`, `preprocessing_status`, `preprocessing_error?`, `data_available`, `tiles_ready?`, `uploaded_at`, `state?`.

Целевая консервативная проверка перед запуском: есть готовые изображения; нет pending/in-progress/loading. Частичные ошибки возвращать явно. Готовность тайлов показывать отдельно от готовности данных. Это политика MCP, а не boolean из OpenAPI; перед реализацией проверить сочетания счётчиков на реальных тестовых мозаиках. Существующая проверка агента не учитывает `loading_images`, копировать её без изменений нельзя.

### Результаты

Источники: `rest/ProcessingFileRoutes.scala`, `service/ResultService.scala`, `rest/ResultStatisticsResource.scala`, `rest/json/ResultStatisticsJson.scala`.

| Операция | REST | Контракт |
|---|---|---|
| Текущий векторный результат | `GET /rest/processings/{processingId}/result` | необязательный query `aoiId: UUID`; поток GeoJSON |
| Исходный векторный результат | `GET /rest/processings/{processingId}/result/original` | тот же query; исходный слой/ревизия по логике backend |
| Статистика | `GET /rest/processings/{processingId}/statistics` | JSON, проверка доступа к проекту |

Скачивание возвращает chunked `application/octet-stream`, `Content-Disposition: attachment; filename=features.geojson`. Здесь нет параметра `format`, готовой подписанной ссылки, экспорта SHP/GPKG или скачивания выходного растра. Метаданные растрового слоя из `get-processing` не означают наличие API экспорта GeoTIFF. Скачивание конкретной ревизии слоя существует отдельно, но в первый набор не входит.

В проверенном master маршруты `result` и `result/original` выполняют аутентификацию, но отбрасывают actor. `ResultService` читает processing без user scope; при `aoiId` выбирает AOI без проверки принадлежности указанному processing. Это обнаружение по исходникам, не подтверждённая эксплуатацией уязвимость production. До включения скачивания нужны исправление/проверка доступа в backend и тесты чужого processing/AOI. Нельзя выдавать URL этих endpoints как публичную ссылку.

Статистика: `processingId`, `status` (`READY | COMPUTING | FAILED`), `computedAt?`, `wdName`, `isDefault`, `totalCount`, `totalArea?`, `aoiArea`, `groups[]` с классами. Площадь — м², длина — метры. Нулевые числа при COMPUTING/FAILED не означают пустой результат. Группы могут перекрываться; площадь не является автоматически площадью объединения. Числа относятся к текущему слою и меняются после редактирования.

## Целевой набор v1: 17 инструментов

Имена инструментов — существующий `kebab-case`, параметры — `camelCase`. `?` означает необязательный параметр. UUID проверяются как UUID, catalog image ID — непрозрачная строка. Никакого неявного «текущего проекта/AOI/снимка» в MCP.

Общие параметры страниц: `limit?: integer = 20` (1–100), `offset?: integer = 0` (≥0). Общий ответ страниц MCP: `{items, total, count, limit, offset, hasNext}`; это нормализация REST-ответов, а не их исходная форма. Полные геометрии не включаются в списки.

| № | Tool | Входные параметры | Основной результат |
|---|---|---|---|
| 1 | `list-models` | нет | модели, ID, имя, описание, блоки и доступные ограничения |
| 2 | `list-imagery-sources` | нет | доступные провайдеры, zoom/цены, preview metadata |
| 3 | `get-limits` | нет | свежие лимиты и баланс, без кеширования баланса |
| 4 | `list-projects` | `query?: string`, `limit?`, `offset?`, `sortBy?: NAME|CREATED|UPDATED = UPDATED`, `sortOrder?: ASC|DESC = DESC` | страница компактных проектов; `query` → REST `filter` |
| 5 | `get-project` | `projectId: UUID | "default"` | проект; default разрешается в реальный UUID |
| 6 | `list-mosaics` | `nameContains?: string` (1–255), `tags?: string[]`, `limit?`, `offset?`, `sortBy?: created_at|name|size_in_bytes = created_at`, `sortOrder?: asc|desc = desc` | страница мозаик с размером и сводным статусом |
| 7 | `get-mosaic` | `mosaicId: UUID` | метаданные, geometry, bbox/площадь при валидной геометрии, preview, сводный статус |
| 8 | `get-mosaic-status` | `mosaicId: UUID`, `includeImages?: boolean = false` | все счётчики, вычисленная готовность, предупреждения; подробности изображений по запросу |
| 9 | `list-processings` | `projectId: UUID`, `query?: string`, `statuses?: ProcessingStatus[]`, `dateFrom?: ISO instant`, `dateTo?: ISO instant`, `limit?`, `offset?`, `sortBy?: NAME|CREATED|COMPLETED|STATUS|PROGRESS|COST|AREA|PROVIDER = CREATED`, `sortOrder?: ASC|DESC = DESC` | страница обработок; `query` → `terms`; даты → `dateFrom/dateTo` |
| 10 | `get-processing` | `processingId: UUID` | состояние, прогресс, источник, стоимость, метаданные слоёв, сообщения |
| 11 | `get-processing-statistics` | `processingId: UUID` | status, computedAt, totals, groups/classes; явные `areaM2/areaKm2`, `lengthM/lengthKm` |
| 12 | `search-imagery-catalog` | `geometry: AOI`, фильтры ниже | страница снимков и предупреждения провайдеров; никакого сохранения выбора |
| 13 | `get-image-metadata` | `imageId: string` | метаданные каталожного снимка; не ID изображения My Imagery |
| 14 | `get-geoboundary` | `query: string`, `bufferMeters?: number ≥ 0` | GeoJSON, имя, bbox, площадь, фактически применённый буфер |
| 15 | `buffer-aoi` | `geometry: GeoJSON geometry`, `distanceMeters: number > 0` | новая polygonal geometry, bbox, площадь; вход не изменяется |
| 16 | `calculate-cost` | `wdName: string`, ровно одно из `geometry: AOI` / `areaSqKm: number > 0`, `source?: Source`, `blocks?: Block[]`, `inferenceParams?: Record<string,string>` | `cost`, `dataCost`, `processingCost`, `unit: "credits"`, признак предварительной оценки |
| 17 | `start-processing` | `name: string` (1–128), `wdName: string`, `geometry: AOI`, `source: Source`, `projectId?: UUID`, `blocks?: Block[]`, `inferenceParams?: Record<string,string>`, `meta?: Record<string,string>` | ID, projectId, status, cost, метаданные слоёв |

`ProcessingStatus`: `UNPROCESSED | PENDING | IN_PROGRESS | OK | FAILED | CANCELLED | REFUNDED | AWAITING`. Backend также умеет фильтровать по архиву, пользователям, командам и review — это не включаем в MCP v1. Project-scoped endpoint не должен получать произвольные `projectIds` из MCP.

`AOI`: валидный непустой GeoJSON Polygon/MultiPolygon, WGS84, координаты `[longitude, latitude]`; проверка квот остаётся в WM backend. `areaLimit` — накопительная квота аккаунта (BillingService.checkRemainingArea), а не предел площади одной AOI; не сравнивать её напрямую с площадью запуска. Для точек/линий геопоиска требуется буфер. Если буфер не задан и найден не полигон, вернуть требование указать его вместо неявных 25/100 метров из агента. Не упрощать расчётную геометрию молча.

### Источник и стоимость

`Source` — ровно один вариант:

```text
{ type: "provider", name: string, zoom?: integer }
{ type: "catalog", dataProvider: string, imageIds: nonempty string[], zoom?: integer }
{ type: "myImagery", mosaicId: UUID }
```

Преобразование: provider → `params.sourceParams.dataProvider.{providerName,zoom}`; catalog → `imagerySearch.{dataProvider,imageIds,zoom}`; myImagery → `myImagery.{mosaicId}`. Внешние строки провайдеров проверять по поддерживаемым backend значениям; не молча удалять неизвестные фильтры. `Block = {name: string, enabled: boolean}`.

Backend допускает также отдельное My Imagery image (`imageIds`, максимум один), `userDefined` и `aoiDetails`; их пока не открываем. Первому набору достаточно целой мозаики и AOI. При расчёте My Imagery текущий агент передаёт `{myImagery:{}}`, а при запуске — mosaicId. Сохранить этот подтверждённый адаптер до интеграционной проверки стоимости с mosaicId; пользовательский `Source` остаётся одинаковым.

Стоимость получать через `POST /rest/processing/cost/details/v2`: `{dataCost, processingCost}`, `cost` — их сумма. `wdName` разрешать в `wdId` через доступные модели. Источники: `rest/CostCalculatorResource.scala`, `rest/json/CalculateCostInput.scala`, `model/SourceParams.scala`, `model/ProcessingParams.scala`, `rest/json/ProcessingJson.scala`.

Оценка только по `areaSqKm` или без source — предварительная, не основание для подтверждения конкретного запуска. Для каталога и My Imagery требовать geometry. Перед запуском клиент показывает стоимость той же конфигурации и получает подтверждение пользователя; простой параметр `confirmed: true` от LLM не является доказательством согласия. На timeout запуска нельзя автоматически повторять POST: backend-idempotency этим аудитом не подтверждена.

Существующий вход `dataProvider: {name, zoom}` сохранить временным alias для provider source. Одновременные `source` и `dataProvider` отклонять. `meta` и `inferenceParams` в текущем MCP допускают произвольные значения, но WM ожидает строки: целевая схема должна быть уже, без неявной сериализации объектов.

### Фильтры каталога

Дополнительно к `geometry`: `acquisitionDateFrom?`, `acquisitionDateTo?` (ISO instant или YYYY-MM-DD; дату разворачивать в UTC начало/конец суток), `maxCloudCover?` (0–100), `minResolution?`, `maxResolution?` (метры/пиксель > 0), `minOffNadirAngle?`, `maxOffNadirAngle?` (градусы, политика MCP 0–90), `minAoiIntersectionPercent?` (0–100), `dataProviders?: string[]`, `hideUnavailable?: boolean = true`, `limit?`, `offset?`, `sortBy?: ACQUISITION_DATE|CLOUD_COVER|OFF_NADIR_ANGLE|PIXEL_RESOLUTION|SAT_ID|ZOOM|PROVIDER_NAME = CLOUD_COVER`, `sortOrder?: ASC|DESC = ASC`.

REST: `POST /rest/catalog/meta`, geometry → `aoi`. Источник: `rest/json/ImageCatalogRequestJson.scala`. Нижние границы должны быть ≤ верхних. Backend также поддерживает `productTypes` и `returnErrors`; не добавлять пользовательские knobs без отдельного сценария. Политику получения и нормализации частичных ошибок провайдеров определить при реализации. Не копировать загрузку до 1000 снимков из агента ради отображения первых 20.

## Получение файлов: следующий этап, контракт зарезервирован

`get-processing-result(processingId: UUID, variant?: "current" | "original" = "current")`.

Назначение — получить GeoJSON-файл через авторизованный канал, а не вернуть весь FeatureCollection в текст модели. В v1 этот инструмент **не регистрируется**. Условия включения:

1. Проверены доступ actor к processing и принадлежность AOI для всех download endpoints на целевом окружении. В MCP сначала не открываем `aoiId`, пока нет сценария выбора AOI.
2. Выбран и реализован транспорт файла: ограниченный по размеру ресурс MCP или защищённый download/artifact endpoint с ограниченным временем жизни. Путь на диске удалённого сервера не считается доставкой пользователю.
3. Зафиксированы ограничения размера, время жизни, отмена/ошибки стрима и тесты двух пользователей. Секреты не включаются в URL/ответ.

Будущий ответ: `{processingId, variant, format:"geojson", fileName, resourceUri, expiresAt?}`. Это проект контракта MCP, не готовый backend JSON. Растровый экспорт, произвольные форматы, исторические ревизии и spatial query результатов сюда не входят.

## Что не включать

- `save_*`, память пользователя, открытый processing карты, состояние чата — остаются в агенте/клиенте.
- `query-mapflow-docs` — отдельное необязательное расширение: требует внешнего провайдера поиска документации; не блокирует runtime MCP.
- `compare-processing-options` — пока композиция поиска + нескольких расчётов, не отдельный tool.
- `validate-processing` — проверки общие для estimate/start; отдельный tool только при появлении самостоятельного сценария.
- Создание/удаление/публикация проектов, загрузка/удаление мозаик, отмена и редактирование обработок — вне v1.

## Проверки при реализации

- Контрактные fixtures проектов: фильтр, пустая страница, сортировка, доступный default, отказ доступа. Отдельно проверить `total` при offset за концом выдачи.
- Мозаики: страница, nullable tags, WKT/пустой footprint, ошибочный объект при HTTP 200, partial failure, loading, независимая готовность тайлов.
- Общий source builder для estimate/start; одинаковые blocks/inferenceParams; невалидные сочетания источников отклоняются.
- Статистика READY с нулём отличается от COMPUTING/FAILED; единицы преобразуются без потери исходных значений.
- Проверить `tools/list`, входные/выходные схемы и ошибки `isError` через MCP, а не только прямые REST mocks.
- После изменений кода обязательны `bun validate` и подходящие `bun test`. При реализации проверки выполняются; платные интеграционные запуски не входят в локальные тесты.
