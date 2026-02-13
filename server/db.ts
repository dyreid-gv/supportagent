import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

export const db = drizzle({
  connection: process.env.DATABASE_URL,
  schema,
  ws: ws,
});
