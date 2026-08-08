"use client";

import { useState } from "react";

// Real clinic logo when we have one; otherwise a clean monogram (initials on a
// deterministic warm tint). No egg-shaped icon placeholders, no neon.
const TINTS = [
  "#a14a47", // clay red
  "#b06a3f", // terracotta
  "#8a6a3a", // ochre
  "#5f7a4e", // olive
  "#46708a", // slate blue
  "#7d5566", // muted mauve
  "#9c6b4f", // sand brown
  "#4f7a72", // pine
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string): string {
  const words = name
    .replace(/[«»"'(),.№]/g, " ")
    .split(/\s+/)
    .filter((w) => /[A-Za-zА-Яа-яЁё]/.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function Avatar({
  name,
  logo,
  size = 48,
  className = "",
}: {
  name: string;
  logo?: string | null;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const box = `shrink-0 overflow-hidden rounded-xl border border-line ${className}`;
  const style = { width: size, height: size };

  if (logo && !broken) {
    return (
      <div className={`${box} grid place-items-center bg-white`} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logo}
          alt={name}
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-contain p-1"
        />
      </div>
    );
  }

  const tint = TINTS[hash(name) % TINTS.length];
  return (
    <div
      className={`${box} grid place-items-center font-semibold text-white`}
      style={{ ...style, backgroundColor: tint, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
