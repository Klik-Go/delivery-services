// Cucumber.js runs Gherkin scenarios in features/ against a running Klik Go server.
// TypeScript step definitions load through the tsx ESM loader (see package.json "test:bdd").
export default {
  paths: ["features/**/*.feature"],
  import: ["features/support/**/*.ts", "features/step_definitions/**/*.ts"],
  format: ["progress-bar", "summary", "html:reports/cucumber-report.html"],
  formatOptions: { snippetInterface: "async-await" },
  // @db scenarios need a local Supabase (CI runs `supabase start` first). Skip them when no DB is configured.
  tags: process.env.DATABASE_URL ? "not @wip" : "not @wip and not @db",
  strict: true,
};
