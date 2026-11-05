// Cucumber.js runs Gherkin scenarios in features/ against a running Klik Go server.
// TypeScript step definitions load through the tsx ESM loader (see package.json "test:bdd").
// @db scenarios need the local database; @auth scenarios also need Supabase Auth (GoTrue) and the
// service-role key for test setup. CI runs `supabase start` first; locally they are skipped when
// the variables are missing so `pnpm test:bdd` still works without Docker.
function tagExpression() {
  const skip = ["@wip"];
  if (!process.env.DATABASE_URL) skip.push("@db");
  if (!(
    process.env.DATABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )) {
    skip.push("@auth");
  }
  return skip.map((tag) => `not ${tag}`).join(" and ");
}

export default {
  paths: ["features/**/*.feature"],
  import: ["features/support/**/*.ts", "features/step_definitions/**/*.ts"],
  format: ["progress-bar", "summary", "html:reports/cucumber-report.html"],
  formatOptions: { snippetInterface: "async-await" },
  tags: tagExpression(),
  strict: true,
};
