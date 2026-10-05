import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env["DATABASE_URL"] ?? "postgres://agenticpad:agenticpad@localhost:5432/agenticpad" },
});
