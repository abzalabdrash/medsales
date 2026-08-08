"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

/**
 * Поиск по названию препарата или действующему веществу.
 *
 * Намеренно обычная форма с submit, а не поиск «на каждую букву»: запрос
 * идёт в SQLite на сервере, и дёргать его на каждое нажатие — лишняя
 * нагрузка при нулевой пользе для пользователя, который всё равно
 * дописывает название до конца.
 */
export function DrugSearch({ initial, city }: { initial: string; city: string }) {
  const [value, setValue] = useState(initial);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (city) params.set("city", city);
    router.push(`/lekarstva${params.size ? `?${params}` : ""}`);
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Название или действующее вещество — например, ибупрофен"
          aria-label="Поиск лекарства"
          className="w-full rounded-xl border border-line bg-surface py-3 pl-10 pr-3 text-sm outline-none focus:border-brand"
        />
      </div>
      <button
        type="submit"
        className="pressable rounded-xl bg-brand px-5 text-sm font-medium text-white"
      >
        Найти
      </button>
    </form>
  );
}
