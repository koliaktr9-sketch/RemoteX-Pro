import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "./db.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? "";
if (!email || password.length < 16 || Buffer.byteLength(password, "utf8") > 72) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (16–72 UTF-8 bytes) in .env");
const hash = await bcrypt.hash(password, 12);
await db.query(
  `INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin')
   ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='admin'`,
  [email,hash]
);
console.log(`Administrator account provisioned: ${email}`);
await db.end();
