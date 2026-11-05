import "server-only";
import { ValidationError, type GeoPoint } from "@klikgo/core";
import { LatLngSchema } from "@klikgo/types";
import { readDeliveryLocation } from "../customer/location";

/** `?lat=&lng=` when given, otherwise the delivery-location cookie; an error when neither is set. */
export async function pointFrom(url: URL): Promise<GeoPoint | ValidationError> {
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");
  if (lat !== null || lng !== null) {
    const parsed = LatLngSchema.safeParse({ lat: Number(lat), lng: Number(lng) });
    return parsed.success ? parsed.data : new ValidationError("Invalid location.");
  }
  const stored = await readDeliveryLocation();
  return stored?.location ?? new ValidationError("Set your delivery address first.");
}
