// Centralized RU + KK localization. Covers the entire UI surface.
// Parsed data (service names, addresses) stays in its original language.

export type Locale = "ru" | "kk";
export const LOCALES: Locale[] = ["ru", "kk"];
export const DEFAULT_LOCALE: Locale = "ru";
export const LANG_COOKIE = "lang";

export function resolveLocale(v: string | undefined | null): Locale {
  return v === "kk" ? "kk" : "ru";
}

export const CATEGORY_KEYS = [
  "laboratory",
  "diagnostics",
  "doctor_visit",
  "procedure",
] as const;

export function isCategory(c: string): boolean {
  return (CATEGORY_KEYS as readonly string[]).includes(c);
}

const CATEGORY_LABEL: Record<Locale, Record<string, string>> = {
  ru: {
    laboratory: "Анализы",
    diagnostics: "Диагностика",
    doctor_visit: "Приём врача",
    procedure: "Процедуры",
  },
  kk: {
    laboratory: "Талдаулар",
    diagnostics: "Диагностика",
    doctor_visit: "Дәрігер қабылдауы",
    procedure: "Процедуралар",
  },
};

export function categoryLabel(
  locale: Locale,
  c: string | null | undefined,
): string {
  return (
    (c && CATEGORY_LABEL[locale][c]) || (locale === "kk" ? "Қызмет" : "Услуга")
  );
}

const CITY_NAME: Record<Locale, Record<string, string>> = {
  ru: {
    almaty: "Алматы",
    astana: "Астана",
    shymkent: "Шымкент",
    karaganda: "Караганда",
    aktobe: "Актобе",
    pavlodar: "Павлодар",
    atyrau: "Атырау",
    kostanay: "Костанай",
    aktau: "Актау",
    kyzylorda: "Кызылорда",
    taraz: "Тараз",
    petropavlovsk: "Петропавловск",
    taldykorgan: "Талдыкорган",
  },
  kk: {
    almaty: "Алматы",
    astana: "Астана",
    shymkent: "Шымкент",
    karaganda: "Қарағанды",
    aktobe: "Ақтөбе",
    pavlodar: "Павлодар",
    atyrau: "Атырау",
    kostanay: "Қостанай",
    aktau: "Ақтау",
    kyzylorda: "Қызылорда",
    taraz: "Тараз",
    petropavlovsk: "Петропавл",
    taldykorgan: "Талдықорған",
  },
};

export function cityNameL(locale: Locale, slug: string | undefined): string {
  const map = CITY_NAME[locale];
  return (slug && map[slug]) || map.almaty;
}

// --- pluralization ---
function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

// Kazakh keeps the noun singular after a number, so no plural forms are needed.
export function branchesLabel(locale: Locale, n: number): string {
  if (locale === "kk") return `${n} филиал`;
  return `${n} ${ruPlural(n, "филиал", "филиала", "филиалов")}`;
}
export function reviewsLabel(locale: Locale, n: number): string {
  if (locale === "kk") return `${n} пікір`;
  return `${n} ${ruPlural(n, "отзыв", "отзыва", "отзывов")}`;
}
export function servicesLabel(locale: Locale, n: number): string {
  if (locale === "kk") return `${n} қызмет`;
  return `${n} ${ruPlural(n, "услуга", "услуги", "услуг")}`;
}
export function clinicsLabel(locale: Locale, n: number): string {
  if (locale === "kk") return `${n} клиника`;
  return `${n} ${ruPlural(n, "клиника", "клиники", "клиник")}`;
}

// "от 5 000 ₸" — placement differs by language.
export function fromPrice(locale: Locale, priceStr: string): string {
  return locale === "kk" ? `${priceStr} бастап` : `от ${priceStr}`;
}

// --- freshness ---
function daysSince(parsedAt: string | null | undefined): number | null {
  if (!parsedAt) return null;
  const t = Date.parse(parsedAt.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function freshness(
  locale: Locale,
  parsedAt: string | null | undefined,
): { label: string; fresh: boolean; stale: boolean; staleSuffix: string } {
  const kk = locale === "kk";
  const staleSuffix = kk
    ? " · баға өзекті болмауы мүмкін"
    : " · цена может быть неактуальна";
  const d = daysSince(parsedAt);
  if (d == null)
    return {
      label: kk ? "күні белгісіз" : "дата неизвестна",
      fresh: false,
      stale: true,
      staleSuffix,
    };
  if (d <= 0)
    return {
      label: kk ? "бүгін жаңартылды" : "обновлено сегодня",
      fresh: true,
      stale: false,
      staleSuffix,
    };
  if (d === 1)
    return {
      label: kk ? "кеше жаңартылды" : "обновлено вчера",
      fresh: true,
      stale: false,
      staleSuffix,
    };
  const label = kk
    ? `${d} күн бұрын жаңартылды`
    : `обновлено ${d} ${ruPlural(d, "день", "дня", "дней")} назад`;
  return { label, fresh: d <= 7, stale: d > 30, staleSuffix };
}

// --- parameterized strings ---
export function heroTitle(locale: Locale, city: string): string {
  return locale === "kk"
    ? `${city} қаласындағы медқызмет бағаларын салыстырыңыз`
    : `Сравните цены на медуслуги в ${city}`;
}
export function noPriceInCity(locale: Locale, city: string): string {
  return locale === "kk"
    ? `${city} қаласында бұл қызметке әзірге баға жоқ`
    : `В городе ${city} пока нет цен на эту услугу`;
}
export function noServicesInCategory(locale: Locale, city: string): string {
  return locale === "kk"
    ? `${city} қаласында бұл санатта әзірге қызмет жоқ`
    : `В городе ${city} пока нет услуг в этой категории`;
}
export function cityChangeLabel(locale: Locale, name: string): string {
  return locale === "kk"
    ? `Қала: ${name}. Өзгерту`
    : `Город: ${name}. Изменить`;
}
export function sourceLabel(locale: Locale, host: string): string {
  return locale === "kk" ? `Сайт: ${host}` : `Сайт: ${host}`;
}
export function readReviewsLabel(locale: Locale, reviews: string): string {
  return locale === "kk"
    ? `2ГИС-тен ${reviews} оқу`
    : `Читать ${reviews} на 2ГИС`;
}
// Title for the clinics catalog, e.g. "Клиники в Алматы".
export function clinicsTitle(locale: Locale, city: string): string {
  return locale === "kk" ? `${city} клиникалары` : `Клиники в ${city}`;
}
// Honest notice when a clinic has no branch in the selected city.
export function clinicInOtherCity(locale: Locale, realCity: string): string {
  return locale === "kk"
    ? `Бұл клиника ${realCity} қаласында орналасқан`
    : `Эта клиника находится в городе ${realCity}`;
}

// --- flat UI dictionary ---
export type Dict = {
  metaTitle: string;
  metaDescription: string;
  searchPlaceholder: string;
  searchPlaceholderShort: string;
  searchAria: string;
  clear: string;
  popular: string;
  nothingFound: string;
  searching: string;
  home: string;
  catalog: string;
  catalogTitle: string;
  clinicsNav: string;
  categories: string;
  chooseCity: string;
  heroSubtitle: string;
  assistantCoreEyebrow: string;
  assistantCoreTitle: string;
  assistantCoreBody: string;
  assistantCoreCta: string;
  statPrices: string;
  statClinics: string;
  statPharmacies: string;
  statCities: string;
  statFrom: string;
  statTo: string;
  statAvg: string;
  statClinicsCount: string;
  lookOtherCities: string;
  notFoundAnyCity: string;
  tryAnotherCity: string;
  branches: string;
  servicesAndPrices: string;
  noBranchesInCity: string;
  noMapPoints: string;
  noMapPointsClinics: string;
  onMap: string;
  route: string;
  call: string;
  write: string;
  openIn2gis: string;
  sourceShort: string;
  reviewsOn2gis: string;
  inCatalog: string;
  pricesFrom: string;
  onMapSection: string;
  filters: string;
  sortLabel: string;
  sortPriceAsc: string;
  sortPriceDesc: string;
  sortUpdated: string;
  sortRating: string;
  sortNear: string;
  priceWord: string;
  bandAny: string;
  bandLt: string;
  bandMid: string;
  bandGt: string;
  ratingOnly: string;
  resetFilters: string;
  geoLoading: string;
  geoDenied: string;
  nothingByFilters: string;
  showMap: string;
  hideMap: string;
  errorTitle: string;
  errorHint: string;
  retry: string;
  nfTitle: string;
  nfHint: string;
  toHome: string;
  historyTitle: string;
  historyEmpty: string;
  historyMinTitle: string;
  nowPrice: string;
  chartAria: string;
  logoAria: string;
  crumbsAria: string;
  // picks (three choices)
  picksTitle: string;
  pickCheapest: string;
  pickClosest: string;
  pickOptimal: string;
  pickShowClosest: string;
  pickWhyPrice: string;
  pickWhyBalance: string;
  pickWhyNear: string;
  pickGo: string;
  // online booking
  onlyOnlineBooking: string;
  onlineBookingYes: string;
  onlineBookingNo: string;
  book: string;
  // compare
  compareAdd: string;
  compareAdded: string;
  compareOpen: string;
  compareTitle: string;
  compareHint: string;
  compareClear: string;
  rowRating: string;
  rowSentiment: string;
  rowDistance: string;
  rowSchedule: string;
  rowBooking: string;
  rowTerm: string;
  rowUpdated: string;
  rowActions: string;
  verdict: string;
  openNow: string;
  closedNow: string;
  scheduleUnknown: string;
  noData: string;
  // profile / favorites / address / watch
  favoritesNav: string;
  favoritesTitle: string;
  favoritesEmpty: string;
  favServicesHead: string;
  favClinicsHead: string;
  addToFav: string;
  removeFromFav: string;
  watchPrice: string;
  watching: string;
  watchTitle: string;
  watchPhone: string;
  watchSubmit: string;
  watchToast: string;
  watchInvalidPhone: string;
  addressTitle: string;
  addressPlaceholder: string;
  addressFind: string;
  addressSaving: string;
  addressNotFound: string;
  addressClear: string;
  addressHint: string;
  addressMine: string;
  cancel: string;
  save: string;
  // account / cabinet
  cabinetNav: string;
  cabinetTitle: string;
  authPhone: string;
  authPassword: string;
  authLogin: string;
  authRegister: string;
  authLogout: string;
  authToRegister: string;
  authToLogin: string;
  authLoggedAs: string;
  authGuestNote: string;
  authErrExists: string;
  authErrBadPhone: string;
  authErrWeak: string;
  authErrBadCreds: string;
  authErrGeneric: string;
  myServicesHead: string;
  shareLocation: string;
  locationDenied: string;
  loginToWatch: string;
};

const DICT: Record<Locale, Dict> = {
  ru: {
    metaTitle: "MedSales — сравнение цен на медуслуги в Казахстане",
    metaDescription:
      "Найдите анализ, приём врача или диагностику и сравните цены в клиниках вашего города.",
    searchPlaceholder: "Найдите анализ, приём врача или услугу",
    searchPlaceholderShort: "Поиск услуги",
    searchAria: "Поиск медуслуги",
    clear: "Очистить",
    popular: "Популярные услуги",
    nothingFound:
      "Ничего не нашли. Проверьте написание или выберите популярную услугу.",
    searching: "Ищем…",
    home: "Главная",
    catalog: "Каталог",
    catalogTitle: "Каталог услуг",
    clinicsNav: "Клиники",
    categories: "Категории",
    chooseCity: "Выбор города",
    heroSubtitle:
      "Сравните цены на услуги в клиниках. А если есть назначение врача, ИИ-помощник ниже соберёт маршрут по аптекам рядом.",
    assistantCoreEyebrow: "Ядро MedSales",
    assistantCoreTitle: "ИИ-помощник по назначению",
    assistantCoreBody:
      "Сфотографируйте рецепт: найдём, где купить дешевле рядом, посчитаем курс и проверим бесплатное обеспечение.",
    assistantCoreCta: "Открыть помощника",
    statPrices: "цен",
    statClinics: "клиник",
    statPharmacies: "аптек",
    statCities: "городов",
    statFrom: "от",
    statTo: "до",
    statAvg: "средняя",
    statClinicsCount: "клиник",
    lookOtherCities: "Посмотрите в других городах, где она есть:",
    notFoundAnyCity: "Эта услуга пока не найдена ни в одном городе.",
    tryAnotherCity: "Попробуйте выбрать другой город в шапке.",
    branches: "Филиалы",
    servicesAndPrices: "Услуги и цены",
    noBranchesInCity: "Нет филиалов в этом городе.",
    noMapPoints: "Нет точек на карте.",
    noMapPointsClinics: "Нет точек на карте для этих клиник.",
    onMap: "На карте",
    route: "Маршрут",
    call: "Позвонить",
    write: "Написать",
    openIn2gis: "Открыть в 2ГИС",
    sourceShort: "Сайт",
    reviewsOn2gis: "Отзывы на 2ГИС",
    inCatalog: "в каталоге",
    pricesFrom: "цены от",
    onMapSection: "На карте",
    filters: "Фильтры",
    sortLabel: "Сортировка",
    sortPriceAsc: "Сначала дешёвые",
    sortPriceDesc: "Сначала дорогие",
    sortUpdated: "Сначала свежие цены",
    sortRating: "Сначала с рейтингом",
    sortNear: "Сначала ближайшие",
    priceWord: "Цена",
    bandAny: "Любая цена",
    bandLt: "до 5 000 ₸",
    bandMid: "5 000 – 15 000 ₸",
    bandGt: "от 15 000 ₸",
    ratingOnly: "Рейтинг 4+",
    resetFilters: "Сбросить фильтры",
    geoLoading: "Определяем ваше местоположение…",
    geoDenied:
      "Не удалось определить местоположение. Разрешите доступ к геолокации в браузере.",
    nothingByFilters: "По выбранным фильтрам ничего нет.",
    showMap: "Показать на карте",
    hideMap: "Скрыть карту",
    errorTitle: "Что-то пошло не так",
    errorHint: "Не удалось загрузить данные. Попробуйте ещё раз.",
    retry: "Повторить",
    nfTitle: "Страница не найдена",
    nfHint:
      "Возможно, услуга или клиника были перемещены или ещё не добавлены.",
    toHome: "На главную",
    historyTitle: "История цены",
    historyEmpty: "История начнёт накапливаться со следующих обновлений цен.",
    historyMinTitle: "История минимальной цены",
    nowPrice: "сейчас",
    chartAria: "График минимальной цены по дням",
    logoAria: "MedSales — на главную",
    crumbsAria: "Хлебные крошки",
    picksTitle: "Быстрый выбор",
    pickCheapest: "Самый дешёвый",
    pickClosest: "Самый близкий",
    pickOptimal: "Оптимальный",
    pickShowClosest: "Показать ближайший",
    pickWhyPrice: "Самая низкая цена в городе",
    pickWhyBalance: "Лучшее сочетание цены и качества",
    pickWhyNear: "Ближе всего к вам",
    pickGo: "Подробнее",
    onlyOnlineBooking: "Только с онлайн-записью",
    onlineBookingYes: "Есть онлайн-запись",
    onlineBookingNo: "Нет онлайн-записи",
    book: "Записаться",
    compareAdd: "К сравнению",
    compareAdded: "В сравнении",
    compareOpen: "Сравнить",
    compareTitle: "Сравнение клиник",
    compareHint: "Отметьте 2–4 клиники галочкой, чтобы сравнить.",
    compareClear: "Очистить",
    rowRating: "Рейтинг",
    rowSentiment: "Тон отзывов",
    rowDistance: "Расстояние",
    rowSchedule: "Режим работы",
    rowBooking: "Онлайн-запись",
    rowTerm: "Срок анализа",
    rowUpdated: "Обновлено",
    rowActions: "Действия",
    verdict: "Вердикт: оптимальный выбор",
    openNow: "Открыто сейчас",
    closedNow: "Сейчас закрыто",
    scheduleUnknown: "Режим не указан",
    noData: "нет данных",
    favoritesNav: "Избранное",
    favoritesTitle: "Избранное",
    favoritesEmpty:
      "Здесь появится то, что вы отметите звёздочкой — услуги и клиники.",
    favServicesHead: "Услуги",
    favClinicsHead: "Клиники",
    addToFav: "В избранное",
    removeFromFav: "Убрать из избранного",
    watchPrice: "Следить за ценой",
    watching: "Вы следите за ценой",
    watchTitle: "Сообщим, когда цена снизится",
    watchPhone: "Номер WhatsApp",
    watchSubmit: "Следить",
    watchToast: "Готово. Уведомим в WhatsApp, когда цена снизится.",
    watchInvalidPhone: "Введите номер в формате +7 700 000 00 00.",
    addressTitle: "Мой адрес",
    addressPlaceholder: "Улица и дом, город",
    addressFind: "Найти",
    addressSaving: "Ищем адрес…",
    addressNotFound: "Адрес не найден. Уточните написание.",
    addressClear: "Удалить адрес",
    addressHint:
      "Постоянный адрес по желанию. Для подбора аптек рядом в Помощнике достаточно один раз нажать «Поделиться геопозицией» — координаты не обязаны храниться здесь.",
    addressMine: "Мой адрес сохранён",
    cancel: "Отмена",
    save: "Сохранить",
    cabinetNav: "Кабинет",
    cabinetTitle: "Личный кабинет",
    authPhone: "Номер телефона",
    authPassword: "Пароль",
    authLogin: "Войти",
    authRegister: "Зарегистрироваться",
    authLogout: "Выйти",
    authToRegister: "Нет аккаунта? Зарегистрироваться",
    authToLogin: "Уже есть аккаунт? Войти",
    authLoggedAs: "Вы вошли как",
    authGuestNote:
      "Войдите по номеру и паролю, чтобы избранное и адрес сохранились в аккаунте.",
    authErrExists: "Этот номер уже зарегистрирован. Войдите.",
    authErrBadPhone: "Введите номер в формате +7 700 000 00 00.",
    authErrWeak: "Пароль слишком короткий (минимум 4 символа).",
    authErrBadCreds: "Неверный номер или пароль.",
    authErrGeneric: "Что-то пошло не так. Попробуйте ещё раз.",
    myServicesHead: "Мои услуги",
    shareLocation: "Поделиться геолокацией",
    locationDenied: "Доступ к геолокации не выдан. Разрешите в браузере.",
    loginToWatch: "Войдите, чтобы следить за ценой",
  },
  kk: {
    metaTitle: "MedSales — Қазақстандағы медқызмет бағаларын салыстыру",
    metaDescription:
      "Талдау, дәрігер қабылдауын немесе диагностиканы тауып, қалаңыздағы клиникалардың бағаларын салыстырыңыз.",
    searchPlaceholder: "Талдау, дәрігер қабылдауын немесе қызметті табыңыз",
    searchPlaceholderShort: "Қызметті іздеу",
    searchAria: "Медқызметті іздеу",
    clear: "Тазалау",
    popular: "Танымал қызметтер",
    nothingFound:
      "Ештеңе табылмады. Жазылуын тексеріңіз немесе танымал қызметті таңдаңыз.",
    searching: "Іздеудеміз…",
    home: "Басты бет",
    catalog: "Каталог",
    catalogTitle: "Қызметтер каталогы",
    clinicsNav: "Клиникалар",
    categories: "Санаттар",
    chooseCity: "Қаланы таңдау",
    heroSubtitle:
      "Клиникадағы қызмет бағаларын салыстырыңыз. Дәрігер тағайындауы болса, төмендегі ЖИ-көмекші жақын жердегі дәріханалар маршрутын жинайды.",
    assistantCoreEyebrow: "MedSales өзегі",
    assistantCoreTitle: "Тағайындау бойынша ЖИ-көмекші",
    assistantCoreBody:
      "Рецептті суретке түсіріңіз: жақын жерден арзанырақ сатып алуды табамыз, курсты есептейміз және тегін қамтуды тексереміз.",
    assistantCoreCta: "Көмекшіні ашу",
    statPrices: "баға",
    statClinics: "клиника",
    statPharmacies: "дәріхана",
    statCities: "қала",
    statFrom: "бастап",
    statTo: "дейін",
    statAvg: "орташа",
    statClinicsCount: "клиника",
    lookOtherCities: "Қызмет бар басқа қалаларды қараңыз:",
    notFoundAnyCity: "Бұл қызмет әзірге бірде-бір қалада табылмады.",
    tryAnotherCity: "Жоғарыдан басқа қаланы таңдап көріңіз.",
    branches: "Филиалдар",
    servicesAndPrices: "Қызметтер мен бағалар",
    noBranchesInCity: "Бұл қалада филиал жоқ.",
    noMapPoints: "Картада нүкте жоқ.",
    noMapPointsClinics: "Бұл клиникалар үшін картада нүкте жоқ.",
    onMap: "Картада",
    route: "Бағыт",
    call: "Қоңырау шалу",
    write: "Жазу",
    openIn2gis: "2ГИС-те ашу",
    sourceShort: "Сайт",
    reviewsOn2gis: "2ГИС-тегі пікірлер",
    inCatalog: "каталогта",
    pricesFrom: "бағасы",
    onMapSection: "Картада",
    filters: "Сүзгілер",
    sortLabel: "Сұрыптау",
    sortPriceAsc: "Алдымен арзаны",
    sortPriceDesc: "Алдымен қымбаты",
    sortUpdated: "Алдымен жаңа бағалар",
    sortRating: "Алдымен рейтингі жоғары",
    sortNear: "Алдымен жақын маңай",
    priceWord: "Баға",
    bandAny: "Кез келген баға",
    bandLt: "5 000 ₸-ге дейін",
    bandMid: "5 000 – 15 000 ₸",
    bandGt: "15 000 ₸-ден жоғары",
    ratingOnly: "Рейтинг 4+",
    resetFilters: "Сүзгілерді тазарту",
    geoLoading: "Орналасқан жеріңізді анықтаудамыз…",
    geoDenied:
      "Орналасқан жерді анықтау мүмкін болмады. Браузерде геолокацияға рұқсат беріңіз.",
    nothingByFilters: "Таңдалған сүзгілер бойынша ештеңе жоқ.",
    showMap: "Картадан көрсету",
    hideMap: "Картаны жасыру",
    errorTitle: "Бірдеңе дұрыс болмады",
    errorHint: "Деректерді жүктеу мүмкін болмады. Қайталап көріңіз.",
    retry: "Қайталау",
    nfTitle: "Бет табылмады",
    nfHint: "Қызмет немесе клиника жылжытылған не әлі қосылмаған болуы мүмкін.",
    toHome: "Басты бетке",
    historyTitle: "Баға тарихы",
    historyEmpty: "Тарих келесі баға жаңартуларынан бастап жинала бастайды.",
    historyMinTitle: "Ең төмен баға тарихы",
    nowPrice: "қазір",
    chartAria: "Күндер бойынша ең төмен баға графигі",
    logoAria: "MedSales — басты бет",
    crumbsAria: "Навигация",
    picksTitle: "Жылдам таңдау",
    pickCheapest: "Ең арзаны",
    pickClosest: "Ең жақыны",
    pickOptimal: "Оңтайлы",
    pickShowClosest: "Жақынын көрсету",
    pickWhyPrice: "Қаладағы ең төмен баға",
    pickWhyBalance: "Баға мен сапаның үздік үйлесімі",
    pickWhyNear: "Сізге ең жақыны",
    pickGo: "Толығырақ",
    onlyOnlineBooking: "Тек онлайн жазылумен",
    onlineBookingYes: "Онлайн жазылу бар",
    onlineBookingNo: "Онлайн жазылу жоқ",
    book: "Жазылу",
    compareAdd: "Салыстыруға",
    compareAdded: "Салыстыруда",
    compareOpen: "Салыстыру",
    compareTitle: "Клиникаларды салыстыру",
    compareHint: "Салыстыру үшін 2–4 клиниканы белгілеңіз.",
    compareClear: "Тазалау",
    rowRating: "Рейтинг",
    rowSentiment: "Пікірлер тоны",
    rowDistance: "Қашықтық",
    rowSchedule: "Жұмыс режимі",
    rowBooking: "Онлайн жазылу",
    rowTerm: "Талдау мерзімі",
    rowUpdated: "Жаңартылды",
    rowActions: "Әрекеттер",
    verdict: "Шешім: оңтайлы таңдау",
    openNow: "Қазір ашық",
    closedNow: "Қазір жабық",
    scheduleUnknown: "Режим көрсетілмеген",
    noData: "дерек жоқ",
    favoritesNav: "Таңдаулылар",
    favoritesTitle: "Таңдаулылар",
    favoritesEmpty:
      "Мұнда жұлдызшамен белгілеген нәрсеңіз көрінеді — қызметтер мен клиникалар.",
    favServicesHead: "Қызметтер",
    favClinicsHead: "Клиникалар",
    addToFav: "Таңдаулыларға",
    removeFromFav: "Таңдаулылардан алу",
    watchPrice: "Бағаны қадағалау",
    watching: "Сіз бағаны қадағалап жатырсыз",
    watchTitle: "Баға төмендегенде хабарлаймыз",
    watchPhone: "WhatsApp нөмірі",
    watchSubmit: "Қадағалау",
    watchToast: "Дайын. Баға төмендегенде WhatsApp арқылы хабарлаймыз.",
    watchInvalidPhone: "Нөмірді +7 700 000 00 00 форматында енгізіңіз.",
    addressTitle: "Менің мекенжайым",
    addressPlaceholder: "Көше мен үй, қала",
    addressFind: "Табу",
    addressSaving: "Мекенжайды іздеудеміз…",
    addressNotFound: "Мекенжай табылмады. Жазылуын тексеріңіз.",
    addressClear: "Мекенжайды жою",
    addressHint:
      "Тұрақты мекенжай міндетті емес. Жақын дәріханалар үшін Көмекшіде «Геолокацияны бөлісу» жеткілікті — мұнда сақтау міндетті емес.",
    addressMine: "Мекенжайым сақталды",
    cancel: "Бас тарту",
    save: "Сақтау",
    cabinetNav: "Кабинет",
    cabinetTitle: "Жеке кабинет",
    authPhone: "Телефон нөмірі",
    authPassword: "Құпиясөз",
    authLogin: "Кіру",
    authRegister: "Тіркелу",
    authLogout: "Шығу",
    authToRegister: "Аккаунт жоқ па? Тіркелу",
    authToLogin: "Аккаунт бар ма? Кіру",
    authLoggedAs: "Сіз кірдіңіз:",
    authGuestNote:
      "Таңдаулылар мен мекенжай аккаунтта сақталуы үшін нөмір мен құпиясөзбен кіріңіз.",
    authErrExists: "Бұл нөмір тіркелген. Кіріңіз.",
    authErrBadPhone: "Нөмірді +7 700 000 00 00 форматында енгізіңіз.",
    authErrWeak: "Құпиясөз тым қысқа (кемінде 4 таңба).",
    authErrBadCreds: "Нөмір немесе құпиясөз қате.",
    authErrGeneric: "Бірдеңе дұрыс болмады. Қайталап көріңіз.",
    myServicesHead: "Менің қызметтерім",
    shareLocation: "Геолокацияны бөлісу",
    locationDenied: "Геолокацияға рұқсат берілмеді. Браузерде рұқсат етіңіз.",
    loginToWatch: "Бағаны қадағалау үшін кіріңіз",
  },
};

export function getDict(locale: Locale): Dict {
  return DICT[locale];
}

// ── Chat assistant strings (kept separate from the main Dict for clarity) ──
export const CHAT_T: Record<
  Locale,
  {
    title: string;
    button: string;
    placeholder: string;
    greeting: string;
    s1: string;
    s2: string;
    s3: string;
    error: string;
    thinking: string;
    disclaimer: string;
    send: string;
    close: string;
  }
> = {
  ru: {
    title: "Помощник MedSales",
    button: "Помощник",
    placeholder: "Спросите про услугу или цену…",
    greeting:
      "Привет! Помогу выбрать клинику по цене и отзывам. Спросите, например:",
    s1: "Где дешевле сдать общий анализ крови?",
    s2: "Хороший гинеколог рядом с отзывами",
    s3: "Что такое УЗИ щитовидной железы и где сделать?",
    error: "Не смог ответить сейчас. Попробуйте поиск по услугам выше.",
    thinking: "Думаю…",
    disclaimer: "ИИ может ошибаться и не заменяет врача.",
    send: "Отправить",
    close: "Закрыть",
  },
  kk: {
    title: "MedSales көмекшісі",
    button: "Көмекші",
    placeholder: "Қызмет немесе баға туралы сұраңыз…",
    greeting:
      "Сәлем! Баға мен пікірлер бойынша клиниканы таңдауға көмектесемін. Мысалы:",
    s1: "Қанның жалпы талдауын қайда арзан тапсыруға болады?",
    s2: "Жақын маңдағы жақсы пікірлі гинеколог",
    s3: "Қалқанша безінің УДЗ-сі деген не және қайда жасатуға болады?",
    error: "Қазір жауап бере алмадым. Жоғарыдағы іздеуді пайдаланыңыз.",
    thinking: "Ойлап жатырмын…",
    disclaimer: "ИИ қателесуі мүмкін және дәрігерді алмастырмайды.",
    send: "Жіберу",
    close: "Жабу",
  },
};

export function chatT(locale: Locale) {
  return CHAT_T[locale];
}
