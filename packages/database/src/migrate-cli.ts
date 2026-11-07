import { createDatabase } from "./client";

const handle = await createDatabase({ migrate: true });
console.log(JSON.stringify({ level: "info", msg: "migrations applied", driver: handle.kind }));
await handle.close();
