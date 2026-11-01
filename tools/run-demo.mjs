import { startDemoServer } from "./demo-server.mjs";

const demo = await startDemoServer();
console.log(`Local demo ready: ${demo.url}`);
console.log("Press Ctrl+C to stop the API and in-process worker. Local PostgreSQL/Azurite remain available for the next run.");

const shutdown = async signal => {
  console.log(`Stopping local demo (${signal})…`);
  await demo.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
