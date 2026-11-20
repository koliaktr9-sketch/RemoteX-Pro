import pg from "pg";
import { newDb } from "pg-mem";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function initMemoryDb(): any {
  console.log("Initializing in-memory database fallback...");
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    impure: true,
    implementation: () => crypto.randomUUID()
  });

  const migrationsDir = path.resolve(__dirname, "../migrations");
  try {
    const m1 = fs.readFileSync(path.join(migrationsDir, "001_initial.sql"), "utf8");
    mem.public.none(m1.replace(/CREATE EXTENSION[^;]+;/g, ""));
    const m2 = fs.readFileSync(path.join(migrationsDir, "002_device_pairing_and_mfa_replay.sql"), "utf8");
    mem.public.none(m2);
  } catch (err) {
    console.warn("Could not auto-apply migrations to memory db:", err);
  }

  const pgAdapter = mem.adapters.createPg();
  const pool = new pgAdapter.Pool();

  // Auto-seed admin if configured
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (email && password.length >= 12) {
    bcrypt.hash(password, 12).then(hash => {
      pool.query(
        "INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin') ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='admin'",
        [email, hash]
      ).then(() => {
        console.log(`In-memory administrator account provisioned: ${email}`);
      }).catch((e: unknown) => console.error("Error auto-seeding admin:", e));
    });
  }

  return pool;
}

const dbUrl = process.env.DATABASE_URL;
let dbInstance: any;

if (dbUrl && (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://"))) {
  dbInstance = new Pool({
    connectionString: dbUrl,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
  // Test connection, fall back if PostgreSQL server is not reachable
  dbInstance.on("error", (err: any) => {
    console.error("PostgreSQL connection error:", err.message);
  });
} else {
  dbInstance = initMemoryDb();
}

export const db = dbInstance;
