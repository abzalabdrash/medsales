"use client";

import Link from "next/link";
import { Bell, BellRing } from "lucide-react";
import {
  useProfile,
  addWatch,
  removeWatch,
  isWatched,
} from "@/lib/profile";
import { useAuth } from "@/lib/auth";
import { withCity } from "@/lib/url";
import { useI18n } from "./I18nProvider";

// Watch the price of THIS service AT THIS clinic. Tied to the account: the
// WhatsApp notification (mock) would go to the account phone, so guests are
// pointed to the cabinet to log in first.
export function OfferWatchButton({
  clinicId,
  serviceId,
  clinicName,
  serviceName,
  city,
  price,
}: {
  clinicId: string;
  serviceId: string;
  clinicName: string;
  serviceName: string;
  city: string;
  price?: number;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const profile = useProfile();
  const watching = profile.watches.some(
    (w) => w.clinicId === clinicId && w.serviceId === serviceId,
  );

  const base =
    "pressable relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-lg border";

  if (!user) {
    return (
      <Link
        href={withCity("/kabinet", city)}
        title={t.loginToWatch}
        aria-label={t.loginToWatch}
        className={`${base} border-line bg-paper text-muted`}
      >
        <Bell size={17} aria-hidden />
      </Link>
    );
  }

  function toggle() {
    if (watching) {
      removeWatch(clinicId, serviceId);
    } else {
      addWatch({
        clinicId,
        serviceId,
        clinicName,
        serviceName,
        city,
        phone: user!.phone,
        price,
      });
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={watching}
      title={watching ? t.watching : t.watchPrice}
      aria-label={watching ? t.watching : t.watchPrice}
      className={`${base} ${
        watching
          ? "border-brand bg-brand-wash text-brand-ink"
          : "border-line bg-paper text-muted"
      }`}
    >
      {watching ? <BellRing size={17} aria-hidden /> : <Bell size={17} aria-hidden />}
    </button>
  );
}
