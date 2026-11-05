import "server-only";
import { LatLngSchema } from "@klikgo/types";
import { cookies } from "next/headers";
import { z } from "zod";

/** Cookie holding where the customer wants delivery (guests and signed-in customers alike). */
export const LOCATION_COOKIE = "kg_loc";

const StoredLocationSchema = z.object({
  location: LatLngSchema,
  label: z.string().max(60).optional(),
});
export type DeliveryLocation = z.infer<typeof StoredLocationSchema>;

/** The delivery location from the cookie, validated; null when unset or tampered with. */
export async function readDeliveryLocation(): Promise<DeliveryLocation | null> {
  const raw = (await cookies()).get(LOCATION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = StoredLocationSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Attributes of the delivery-location cookie. */
export interface LocationCookie {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: "/";
  readonly maxAge: number;
}

/** Cookie attributes: readable by the server only, a year long, same-site. */
export function deliveryLocationCookie(value: DeliveryLocation): LocationCookie {
  return {
    name: LOCATION_COOKIE,
    value: JSON.stringify(value),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  };
}
