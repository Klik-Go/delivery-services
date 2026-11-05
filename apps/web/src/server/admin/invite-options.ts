import "server-only";
import { getPrismaClient } from "@klikgo/db";

/** Stores and zones an admin can attach an invite to (read model for the admin console). */
export async function getInviteOptions(): Promise<{
  merchants: { id: string; name: string }[];
  zones: { id: string; name: string }[];
}> {
  const prisma = getPrismaClient();
  const [merchants, zones] = await Promise.all([
    prisma.merchants.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.zones.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { merchants, zones };
}
