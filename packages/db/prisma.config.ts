import { defineConfig } from "prisma/config";

// The Prisma CLI (introspection, `db pull`) uses the direct connection, not the pooler,
// because Supavisor transaction mode does not support the session features the CLI needs.
const directUrl = process.env.DIRECT_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
