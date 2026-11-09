# Mapflow MCP #103: проверка 2026-11-09

Объём: девять Failed/Partial failure из [чеклиста](https://geoalert.fibery.io/Helpdesk/Checklists/103). 23 Not implemented не менялись. Статусы Fibery не изменены: локальное исправление не равно успешному ретесту duty.

## Проверенные версии

- MCP `origin/main`: `452c27d`, получен через `git fetch origin main`.
- Последний успешный duty deployment: [job 149863](https://git.idono.work/geoalert-projects/map-flow/mapflow-platform-kubernetes/-/jobs/149863), 2026-11-09, конфигурация `05a526d779e07e79287dea15a3b8999c88b74084`. В ней MCP tag `452c27d`, backend tag `a5b00a4d`. Прямой kubectl недоступен: локальный tunnel 127.0.0.1:6443 не поднят. Это проверка успешного CI deployment и его values, не чтение текущего pod imageID.
- Backend `ResultService.scala` именно в `a5b00a4d` уже проверяет actor и принадлежность AOI. Старое заключение по локальному backend было устаревшим. Свежий `origin/master` (`d0bca492`) также содержит интеграционные тесты владельца, постороннего пользователя, отозванного доступа и чужого AOI.
- Keycloak: текущие main values указывают Keycloak 26, theme image `cf091169`; [изменение темы](https://git.idono.work/geoalert-projects/white-maps-platform/keycloak/-/commit/cf0911691db0f7e1123d9da689c4b6cd99e006e1) исправляет пути common styles. Это не визуальный ретест окна consent.

## Девять замечаний

| Тест | Результат проверки и действие |
|---|---|
| [4499 — Codex/ChatGPT](https://geoalert.fibery.io/Helpdesk/Tests/4499) | OAuth-инструменты из текущего Codex вызываются успешно. Чистое подключение в ChatGPT отдельно не проверено; старый статус Partial failure автоматически не закрывать. |
| [4500 — Cursor](https://geoalert.fibery.io/Helpdesk/Tests/4500) | Старый Trusted Hosts failure не воспроизвёлся для временного public DCR-клиента с loopback callback, scope `openid mapflow:mcp`, method `none`: 201, немедленное удаление 204. Тест явно разрешён пользователем. Полный login/consent/token exchange именно в Cursor не проверен. |
| [4501 — VS Code](https://geoalert.fibery.io/Helpdesk/Tests/4501) | Тот же успешный DCR probe подтверждает регистрацию public клиента, но не полный сценарий VS Code. Нужен клиентский ретест. |
| [4503 — кнопки consent](https://geoalert.fibery.io/Helpdesk/Tests/4503) | Найдено более новое исправление подключения стилей темы Keycloak. Отдельные изменения темы не вносились без воспроизведения; нужен визуальный ретест реального consent. |
| [4535 — стоимость мозаики](https://geoalert.fibery.io/Helpdesk/Tests/4535) | Исправлено локально: `mosaicId` теперь сохраняется при расчёте и запуске одним builder. Контрактный тест проверяет оба payload. У OAuth-аккаунта нет мозаик; локальный API-токен возвращает 401 на duty. Живая стоимость не подтверждена. |
| [4555 — GeoJSON](https://geoalert.fibery.io/Helpdesk/Tests/4555) | Добавлен `get-processing-result`, current/original, embedded MCP resource до 5 MiB. Свежая проверка доступа и готовности перед скачиванием, общий авторизованный transport, отмена oversized stream. Внутренние layer URL убраны из ответов get/start processing. Backend ACL уже реализован в duty-теге. Нового инструмента на duty пока нет. |
| [4557 — каталог](https://geoalert.fibery.io/Helpdesk/Tests/4557) | Skywatch исключён из enum и default запроса. Фильтруется только точная ошибка неприменимых фильтров для невыбранного известного семейства; ошибки выбранных провайдеров/timeout сохраняются. В описании явно указаны сортировка и обход `hasNext`. Лимит страницы 20 сохранён, максимум 100. |
| [4560 — метаданные](https://geoalert.fibery.io/Helpdesk/Tests/4560) | Схема сохраняет `footprint`, `previews[].geometry/url`; MCP-тест проверяет их доставку клиенту. Отдельный ArcGIS lookup по ID на duty всё ещё даёт NOT_FOUND для найденного снимка. По прежнему решению это upstream-ограничение, не новое исправление из замечания 4560. Данные footprint/previews из поиска теперь также сохраняются. |
| [4566 — текст ошибки](https://geoalert.fibery.io/Helpdesk/Tests/4566) | Исправлено локально: zoom упоминается только при переданном zoom. Добавлена рекомендация использовать параметры из поиска. На старом duty воспроизведён прежний текст. |

## Проверки и ограничения

- `bun validate`: TypeScript, Biome lint/format.
- Полный `bun test`: **124 passed, 0 failed**, HTTP, STDIO, OAuth, схемы и контракты. HTTP-тесты запускаются вне sandbox, поскольку sandbox запрещает bind локальных портов.
- Реальный duty: успешный поиск по AOI; `hasNext: true`; воспроизведены отсутствие footprint/previews, шумные ошибки невыбранных провайдеров и NOT_FOUND ArcGIS/неизвестного ID.
- DCR: временный клиент создан и удалён; токены не выводились и не сохранялись в репозитории.
- Новые исправления на duty не развёрнуты. Прямой smoke локального клиента не состоялся из-за HTTP 401 локального API-токена. Нельзя считать его пройденным.
- Для закрытия нужны: выкладка MCP, живая сверка стоимости доступной мозаики с веб-формой, скачивание собственного GeoJSON, проверка составного Roscosmos preview и полные входы Cursor/VS Code/ChatGPT с визуальной проверкой consent.
