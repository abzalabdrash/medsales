# MedPrice.kz — фронтенд

«Aviasales для медицины в Казахстане». Поиск медуслуги -> сравнение цен по клиникам города (дешёвые сверху) -> рейтинг, свежесть цены, адрес, маршрут, карта.

Next.js 16 (App Router) · TypeScript · Tailwind v4 · React 19. Данные читаются напрямую из SQLite через встроенный в Node 24 модуль `node:sqlite` (нативные модули не нужны).

---

## 1. Запуск локально

Нужен **Node.js 24+** (для `node:sqlite`). Проверить: `node -v`.

```bash
cd web
npm install
npm run dev
```

Открыть http://localhost:3000

База по умолчанию читается из `../data/medprice.db` (то есть файл лежит рядом с папкой `web/`, в `data/medprice.db`). Если база в другом месте — задать путь через переменную окружения:

```bash
MEDPRICE_DB=/полный/путь/medprice.db npm run dev
```

Структура:

```
project/
  data/medprice.db   <- база от парсера
  web/               <- этот фронтенд
```

---

## 2. Прод-сборка

```bash
cd web
npm install
npm run build
npm run start      # поднимает Node-сервер на порту 3000
```

`PORT=8080 npm run start` — сменить порт.

---

## 3. Деплой (НЕ Vercel)

`node:sqlite` читает файл с диска, а serverless-платформы (Vercel/Netlify Functions) не дают постоянной файловой системы. Нужен **долгоживущий Node-процесс**: Railway, Render или обычный VPS.

Общий рецепт для любой из платформ:

1. Build command: `npm install && npm run build`
2. Start command: `npm run start`
3. Node version: 24+ (Railway/Render — переменная `NODE_VERSION=24` или поле в настройках).
4. Положить рядом файл базы и указать абсолютный путь: `MEDPRICE_DB=/app/data/medprice.db`.

### Railway
- New Project -> Deploy from repo, root = `web/`.
- Variables: `MEDPRICE_DB` -> путь к примонтированному файлу базы (Volume), `NODE_VERSION=24`.
- Базу заливаем в Volume (Railway -> Volumes) или кладём в репозиторий рядом и указываем относительный путь.

### Render
- New -> Web Service, Environment = Node, root = `web/`.
- Build: `npm install && npm run build`; Start: `npm run start`.
- Environment: `MEDPRICE_DB`, `NODE_VERSION=24`.
- Базу — через Disk (persistent) либо в репозиторий.

### VPS (самый предсказуемый вариант для демо)
```bash
git clone <repo> && cd web
npm install && npm run build
MEDPRICE_DB=/srv/medprice/data/medprice.db pm2 start "npm run start" --name medprice
```
Спереди — nginx как reverse proxy на 3000 (опционально).

---

## 4. Карта файлов

```
web/
  app/
    layout.tsx                  Golos Text + Header, метаданные
    page.tsx                    Главная: hero + поиск + плитки + 4 категории + полоса доверия
    loading.tsx                 Скелет главной
    error.tsx                   Ошибка верхнего уровня (Повторить)
    not-found.tsx               404 по-человечески
    globals.css                 Дизайн-система (palette/tokens) — НЕ трогалась
    usluga/[id]/page.tsx        Услуга: статистика + офферы + фильтры + карта + история цены
    usluga/[id]/loading.tsx
    klinika/[brandId]/page.tsx  Клиника: филиалы (адрес/часы/маршрут/звонок) + услуги + карта
    klinika/[brandId]/loading.tsx
    katalog/page.tsx            4 категории
    katalog/[category]/page.tsx Список услуг категории c "от X тг"
    katalog/[category]/loading.tsx
    api/suggest/route.ts        Автодополнение поиска (searchServices)
    api/popular/route.ts        Популярные услуги для подсказок на фокусе
  components/
    Header.tsx, Logo.tsx, CityPicker.tsx, SearchBox.tsx
    OffersView.tsx, OfferRow.tsx          (список офферов + фильтры + карта)
    MapView.tsx, LazyMap.tsx              (Leaflet + OSM, ssr:false)
    CategoryCard.tsx, ServiceTile.tsx, StatPills.tsx, Breadcrumbs.tsx
    Rating.tsx, FreshnessBadge.tsx, PriceHistory.tsx, Photo.tsx
    EmptyState.tsx, ErrorState.tsx, Skeletons.tsx
  lib/
    db.ts        слой данных (node:sqlite, read-only)
    cities.ts    13 городов, resolveCity
    format.ts    tenge / categoryLabel / freshness / rating10 / branchesLabel
    url.ts       withCity (город всегда в ?city=)
    maps.ts      2GIS deeplink маршрута, tel:, hasGeo
  next.config.ts   serverExternalPackages: node:sqlite
  postcss.config.mjs, tsconfig.json, package.json
```

Город везде живёт в URL (`?city=almaty`), меняется в шапке за один тап, ссылки шарятся.

---

## 5. Зависимости

Устанавливаются через `npm install`:
- `next@16.2.9`, `react@19`, `react-dom@19`
- `lucide-react` — иконки (один strokeWidth)
- `leaflet` + `@types/leaflet` — карта (OSM-тайлы, без API-ключа)
- `tailwindcss@4` + `@tailwindcss/postcss`, `typescript`, типы Node/React

`better-sqlite3` НЕ используется — база читается встроенным `node:sqlite`.

---

## 6. Состояния (loading / empty / error)

На каждом маршруте есть `loading.tsx` (скелеты под размер контента, не спиннер). Пустые состояния — человеческий текст + действие (нет услуги в городе -> список других городов; пустой поиск -> подсказки). `error.tsx` ловит сбои с кнопкой «Повторить». Падение карты/гео не роняет страницу: карта грузится лениго (`ssr:false`), при отсутствии гео показывается аккуратная заглушка.

---

## 7. AI-фото — что сгенерировать (промпты + размеры)

Фото пока заменены аккуратными плейсхолдерами (`components/Photo.tsx`: нейтральный фон + иконка). Когда будут готовы WebP-файлы — положить в `web/public/img/` и заменить `Photo` на `next/image`.

Общие правила для ВСЕХ изображений (жёстко):
- Только абстракция / lifestyle / мягкая иллюстрация. БЕЗ лиц, врачей, медпроцедур, оборудования, шприцев крупным планом.
- Ноль текста и логотипов на картинке.
- Тёплая светлая палитра под сайт: белый, тёпло-серый (off-white), один сдержанный красный акцент. Без красной заливки всего кадра, без неона, без фиолетового «AI-свечения».
- Единый стиль во всех 5 картинках (как один набор). Формат на выходе — WebP.

**1. Hero (главная), 1600x900 px (16:9), запас по краям под текст слева**
> Soft minimalist abstract illustration, warm off-white background, gentle rounded organic shapes and thin line accents, one restrained coral-red highlight, calm and trustworthy, lots of empty space, flat modern style, no text, no logos, no faces, no medical equipment

**2. Категория «Анализы» (laboratory), 480x360 px (4:3)**
> Minimal flat illustration of an abstract lab test tube and a single drop, soft rounded shapes, warm off-white background, one coral-red accent, lots of negative space, friendly and simple, no text, no faces, no realistic equipment

**3. Категория «Диагностика» (diagnostics), 480x360 px (4:3)**
> Minimal flat illustration suggesting a scan / pulse wave as a clean thin line, abstract rounded shapes, warm off-white background, single coral-red accent, calm and simple, no text, no faces, no realistic machines

**4. Категория «Приём врача» (doctor_visit), 480x360 px (4:3)**
> Minimal flat illustration of an abstract speech/consultation idea — two simple rounded shapes facing each other, warm off-white background, one coral-red accent, friendly and calm, plenty of empty space, no text, no faces, no uniforms

**5. Категория «Процедуры» (procedure), 480x360 px (4:3)**
> Minimal flat illustration of abstract care / wellness — soft overlapping rounded shapes and a gentle plus sign as accent, warm off-white background, single coral-red highlight, calm simple style, no text, no faces, no equipment

(Опционально) **Пустые состояния, 360x280 px** — тот же стиль, мотив «ничего не найдено»: лупа из тонкой линии над мягкими фигурами, без текста.

Подсказка по подбору красного: акцент в дизайне примерно соответствует тёплому красному (близко к Kaspi-red). В промпте можно заменить «coral-red» на «warm crimson red» если первый результат бледный.

---

## 8. Что осталось / на что обратить внимание

- **Реальная база.** Положить `data/medprice.db` рядом с `web/` (или указать `MEDPRICE_DB`). Без файла страницы покажут пустые состояния, но не упадут.
- **AI-фото.** Сгенерировать 5 картинок по промптам выше, сложить в `public/img/`, заменить плейсхолдеры `Photo` на `next/image` (по желанию — фронт работает и с плейсхолдерами).
- **2GIS маршрут** использует slug города как сегмент городского пространства 2ГИС — совпадает для основных городов (almaty, astana, shymkent...). Если для какого-то города 2ГИС использует другой сегмент, поправить в `lib/maps.ts`.
- **История цены** рисует только реально накопленные снапшоты. На 1-2 днях данных покажет честную подпись «история начнёт накапливаться».
- **Типизация/линт.** Полный typecheck требует установленных зависимостей (`npm install`), в оффлайн-сборке он не выполнялся. После `npm install` можно прогнать `npx tsc --noEmit`.
