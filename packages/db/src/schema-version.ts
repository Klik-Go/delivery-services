/**
 * The newest migration in supabase/migrations that this build of the app expects the database to
 * have. /api/health/ready compares it with the database; schema-version.test.ts fails CI when a
 * migration is added without bumping it.
 */
export const LATEST_MIGRATION = "20261111100000";
