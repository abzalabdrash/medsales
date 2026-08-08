"use client";

import { useMemo, useState } from "react";
import { computeCourse } from "@/lib/course";
import { tenge } from "@/lib/format";

/**
 * Расчёт стоимости курса.
 *
 * Ради этого блока всё и затевалось. Аптека показывает цену упаковки, а
 * человеку нужно знать, во сколько обойдётся лечение целиком: «1 капсула
 * 3 раза в день 40 дней» — это 120 капсул, четыре упаковки, а не одна.
 *
 * Значения по умолчанию (1 раз в день, 30 дней) выбраны так, чтобы блок
 * сразу показывал осмысленный результат, а не пустоту с просьбой ввести
 * данные.
 */
export function CourseCalculator({
  packSize,
  isDivisible,
  form,
  price,
}: {
  packSize: number | null;
  isDivisible: boolean;
  form: string | null;
  price: number | null;
}) {
  const [dose, setDose] = useState(1);
  const [times, setTimes] = useState(1);
  const [days, setDays] = useState(30);

  const result = useMemo(
    () =>
      computeCourse({
        packSize,
        isDivisible,
        form,
        dosePerIntake: dose,
        timesPerDay: times,
        days,
      }),
    [packSize, isDivisible, form, dose, times, days],
  );

  const total = result.packs && price ? result.packs * price : null;

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-base font-semibold">Сколько нужно на курс</h2>
      <p className="mt-1 text-sm text-muted">
        Введите схему приёма из назначения — посчитаем упаковки и сумму.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <NumberField label="За приём" value={dose} onChange={setDose} min={0.5} step={0.5} />
        <NumberField label="Раз в день" value={times} onChange={setTimes} min={1} step={1} />
        <NumberField label="Дней" value={days} onChange={setDays} min={1} step={1} />
      </div>

      <div className="mt-4 rounded-lg bg-paper p-4">
        <p className="text-sm text-ink">{result.explainer}</p>

        {result.packs !== null && (
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted">
              {result.packs} упак.
              {price ? ` × ${tenge(price)}` : ""}
            </span>
            {total !== null && (
              <span className="text-2xl font-semibold tabular-nums text-brand-ink">
                {tenge(total)}
              </span>
            )}
          </div>
        )}

        {result.warning && (
          <p className="mt-3 text-sm text-muted">{result.warning}</p>
        )}
      </div>

      <p className="mt-3 text-xs text-muted">
        Расчёт справочный. Схему приёма назначает врач — мы её не меняем.
      </p>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  step: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          // пустое поле и мусор не должны обнулять расчёт
          if (Number.isFinite(v) && v >= min) onChange(v);
        }}
        className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm tabular-nums outline-none focus:border-brand"
      />
    </label>
  );
}
