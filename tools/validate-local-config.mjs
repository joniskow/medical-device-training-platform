import { existsSync, readFileSync } from "node:fs";

const env = readFileSync(".env.example", "utf8");
const required = [
  "APP_ENV",
  "DATABASE_URL",
  "AZURITE_BLOB_ENDPOINT",
  "AI_PROVIDER_MODE",
  "TENANT_CONTEXT_REQUIRED",
  "AUDIT_LOGGING_ENABLED"
];

const missing = required.filter((name) => !new RegExp(`^${name}=`, "m").test(env));
if (missing.length > 0) {
  console.error(`Missing local configuration keys: ${missing.join(", ")}`);
  process.exitCode = 1;
} else if (!existsSync("infra/local/docker-compose.yml")) {
  console.error("Missing infra/local/docker-compose.yml");
  process.exitCode = 1;
} else {
  console.log("Local configuration passed.");
}
