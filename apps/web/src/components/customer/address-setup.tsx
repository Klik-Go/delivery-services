"use client";

import { Button } from "@klikgo/ui";
import { LocateFixed, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type JSX } from "react";
import { FormError } from "@/components/auth/form-error";
import { TextField } from "@/components/auth/text-field";
import { PinMap, type Pin } from "@/components/map/pin-map";
import { postJson, requestJson } from "@/lib/post-json";

interface Suggestion {
  readonly id: string;
  readonly primary: string;
  readonly secondary: string | null;
}

/** Ayala Avenue, Makati: where the map starts when we know nothing yet. */
const DEFAULT_PIN: Pin = { lat: 14.5547, lng: 121.0244 };

/**
 * Address setup: GPS, autocomplete (when configured) and a pin to drag; signed-in customers also
 * save the address with a landmark and contact number. Out of zone → the waitlist.
 */
export function AddressSetup({
  signedIn,
  placesEnabled,
  initial,
}: {
  readonly signedIn: boolean;
  readonly placesEnabled: boolean;
  readonly initial: Pin | null;
}): JSX.Element {
  const t = useTranslations("Customer.address");
  const tCustomer = useTranslations("Customer");
  const router = useRouter();
  const [pin, setPin] = useState<Pin>(initial ?? DEFAULT_PIN);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const session = useMemo(() => crypto.randomUUID(), []);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [outOfArea, setOutOfArea] = useState(false);
  const [form, setForm] = useState({
    label: "Home",
    landmark: "",
    street: "",
    barangay: "",
    city: "",
    notes: "",
    contactPhone: "",
  });

  useEffect(() => {
    if (!placesEnabled || query.trim().length < 2) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        q: query,
        session,
        lat: String(pin.lat),
        lng: String(pin.lng),
      });
      void requestJson<Suggestion[]>(
        "GET",
        `/api/geo/autocomplete?${params.toString()}`,
        undefined,
        "",
      ).then((r) => setSuggestions(r.ok ? r.data : []));
    }, 300);
    return () => clearTimeout(timer);
    // Only re-query when the text changes; the pin is just a bias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, placesEnabled, session]);

  async function choose(suggestion: Suggestion): Promise<void> {
    setSuggestions([]);
    setQuery(suggestion.primary);
    const params = new URLSearchParams({ id: suggestion.id, session });
    const place = await requestJson<{ location: Pin }>(
      "GET",
      `/api/geo/place?${params.toString()}`,
      undefined,
      t("noResults"),
    );
    if (place.ok) setPin(place.data.location);
    else setError(place.message);
  }

  function locate(): void {
    if (!("geolocation" in navigator)) {
      setError(t("locationDenied"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setPin({
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        });
      },
      () => {
        setLocating(false);
        setError(t("locationDenied"));
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const label = form.street || form.landmark || form.label;
    const located = await requestJson<{ zone: { name: string } | null }>(
      "PUT",
      "/api/location",
      { location: pin, label: label.slice(0, 60) || undefined },
      t("failed"),
    );
    if (!located.ok) {
      setSaving(false);
      setError(located.message);
      return;
    }
    if (!located.data.zone) {
      setSaving(false);
      setOutOfArea(true);
      return;
    }
    if (signedIn) {
      const saved = await postJson(
        "/api/addresses",
        { ...form, location: pin, isDefault: true },
        t("failed"),
      );
      if (!saved.ok) {
        setSaving(false);
        setError(saved.message);
        return;
      }
    }
    router.push("/");
    router.refresh();
  }

  if (outOfArea) return <WaitlistForm pin={pin} message={tCustomer("notInArea")} />;

  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));
  return (
    <div className="flex flex-col gap-4">
      {placesEnabled ? (
        <div className="relative">
          <label className="text-ink flex flex-col gap-1 text-sm font-semibold">
            {t("search")}
            <span className="relative">
              <Search
                aria-hidden
                className="text-ink-muted absolute top-1/2 left-3 size-5 -translate-y-1/2"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="border-ink-muted/40 focus:border-brand-800 text-ink min-h-tap w-full rounded-xl border-2 pr-3 pl-10"
                autoComplete="off"
              />
            </span>
          </label>
          {suggestions.length > 0 ? (
            <ul className="rounded-card border-brand-100 absolute z-[1100] mt-1 w-full overflow-hidden border-2 bg-white shadow-lg">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => void choose(s)}
                    className="min-h-tap hover:bg-brand-50 w-full px-3 py-2 text-left"
                  >
                    <span className="text-ink block font-semibold">{s.primary}</span>
                    {s.secondary ? (
                      <span className="text-ink-muted block text-sm">{s.secondary}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <PinMap value={pin} onChange={setPin} label={t("mapLabel")} />
      <Button variant="secondary" onClick={locate} disabled={locating} className="self-start">
        <LocateFixed aria-hidden className="size-5" />
        {locating ? t("locating") : t("useMyLocation")}
      </Button>
      {signedIn ? (
        <div className="flex flex-col gap-3">
          <TextField
            label={t("landmark")}
            name="landmark"
            required
            value={form.landmark}
            onChange={set("landmark")}
          />
          <TextField
            label={t("street")}
            name="street"
            value={form.street}
            onChange={set("street")}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label={t("barangay")}
              name="barangay"
              required
              value={form.barangay}
              onChange={set("barangay")}
            />
            <TextField
              label={t("city")}
              name="city"
              required
              value={form.city}
              onChange={set("city")}
            />
          </div>
          <TextField
            label={t("contactPhone")}
            name="contactPhone"
            type="tel"
            inputMode="tel"
            required
            placeholder="0917 123 4567"
            value={form.contactPhone}
            onChange={set("contactPhone")}
          />
          <TextField label={t("label")} name="label" value={form.label} onChange={set("label")} />
          <TextField label={t("notes")} name="notes" value={form.notes} onChange={set("notes")} />
        </div>
      ) : (
        <p className="text-ink-muted text-sm">
          {t("guestNote")}{" "}
          <a
            href="/auth/sign-in?next=%2Faddress"
            className="text-brand-800 font-semibold underline"
          >
            {t("signIn")}
          </a>
        </p>
      )}
      <FormError message={error} />
      <Button size="lg" onClick={() => void save()} disabled={saving}>
        {saving ? t("saving") : t("save")}
      </Button>
    </div>
  );
}

/** "Bring Klik Go to your area": name, number and barangay for expansion planning. */
export function WaitlistForm({
  pin,
  message,
}: {
  readonly pin: Pin;
  readonly message: string;
}): JSX.Element {
  const t = useTranslations("Customer.waitlist");
  const [form, setForm] = useState({ name: "", phone: "", email: "", barangay: "", city: "" });
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(): Promise<void> {
    setState("sending");
    setError(null);
    const result = await postJson("/api/waitlist", { ...form, location: pin }, t("submit"));
    if (result.ok) setState("done");
    else {
      setState("idle");
      setError(result.message);
    }
  }

  return (
    <section
      aria-labelledby="waitlist-heading"
      className="bg-surface-muted rounded-card flex flex-col gap-3 p-4"
    >
      <p role="status" className="bg-accent-100 text-ink rounded-xl p-3 font-semibold">
        {message}
      </p>
      <h2 id="waitlist-heading" className="text-ink text-xl font-bold">
        {t("title")}
      </h2>
      {state === "done" ? (
        <p aria-live="polite" className="text-ink">
          {t("thanks")}
        </p>
      ) : (
        <>
          <p className="text-ink-muted text-sm">{t("lead")}</p>
          <TextField label={t("name")} name="name" value={form.name} onChange={set("name")} />
          <TextField
            label={t("phone")}
            name="phone"
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={set("phone")}
          />
          <TextField
            label={t("email")}
            name="email"
            type="email"
            value={form.email}
            onChange={set("email")}
          />
          <TextField
            label={t("barangay")}
            name="waitlistBarangay"
            value={form.barangay}
            onChange={set("barangay")}
          />
          <TextField
            label={t("city")}
            name="waitlistCity"
            value={form.city}
            onChange={set("city")}
          />
          <FormError message={error} />
          <Button onClick={() => void submit()} disabled={state === "sending"}>
            {state === "sending" ? t("submitting") : t("submit")}
          </Button>
        </>
      )}
    </section>
  );
}
