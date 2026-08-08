/**
 * Расчёт потребности на курс лечения.
 *
 * Зеркало pharma/course.py — намеренно продублировано, а не вызывается
 * через API: считать надо мгновенно, прямо при движении ползунков, и
 * гонять ради арифметики запрос на сервер незачем.
 *
 * Смысл всей затеи: аптека показывает цену УПАКОВКИ, а лечение измеряется
 * курсом. «1 капсула 3 раза в день 40 дней» — это 120 капсул, то есть
 * четыре упаковки по 30, а не одна. Разница в четыре раза, и именно на ней
 * ошибается любой поиск по каталогу.
 */

export type CourseInput = {
  packSize: number | null;
  isDivisible: boolean;
  form?: string | null;
  dosePerIntake?: number;
  timesPerDay?: number;
  days?: number;
};

export type CourseResult = {
  units: number | null;
  packs: number | null;
  leftover: number | null;
  explainer: string;
  isEstimate: boolean;
  warning: string | null;
};

const UNIT_WORD: Record<string, string> = {
  таблетки: "таб.",
  капсулы: "капс.",
  драже: "драже",
  суппозитории: "свечей",
  "раствор для инъекций": "амп.",
  саше: "пакетиков",
  пластырь: "шт",
};

function n(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

export function computeCourse(input: CourseInput): CourseResult {
  const { packSize, isDivisible, form } = input;
  const dose = input.dosePerIntake && input.dosePerIntake > 0 ? input.dosePerIntake : 1;
  const freq = input.timesPerDay ?? 0;
  const days = input.days ?? 0;

  if (!freq || !days) {
    return {
      units: null,
      packs: null,
      leftover: null,
      explainer: "укажите, сколько раз в день и сколько дней принимать",
      isEstimate: false,
      warning: null,
    };
  }

  const units = dose * freq * days;
  const word = UNIT_WORD[form ?? ""] ?? "ед.";
  const dosePart = dose !== 1 ? `${n(dose)} × ` : "";
  const base = `${dosePart}${n(freq)} р/день × ${days} дн = ${n(units)} ${word}`;

  // Мазь, сироп, спрей: «№1» — это один тюбик, а не одна доза. Считать
  // упаковки нельзя, расход зависит от площади нанесения.
  if (!isDivisible || !packSize) {
    return {
      units,
      packs: null,
      leftover: null,
      explainer: `${base} — расход зависит от объёма нанесения`,
      isEstimate: true,
      warning: "Форма неделимая: точное число упаковок не рассчитать. Уточните у фармацевта.",
    };
  }

  // Округление всегда вверх: лучше остаток, чем прерванный курс.
  const packs = Math.ceil(units / packSize);
  const leftover = packs * packSize - units;
  let explainer = `${base} = ${packs} уп. по ${packSize}`;
  if (leftover > 0) explainer += ` (останется ${n(leftover)})`;

  return { units, packs, leftover, explainer, isEstimate: false, warning: null };
}
