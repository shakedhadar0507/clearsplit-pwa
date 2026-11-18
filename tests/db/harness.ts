import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres?host=/var/tmp';
const root = path.resolve(__dirname, '../..');

/** Creates a fresh database with the Supabase stub + all migrations applied. */
export async function freshDb(): Promise<Db> {
  const name = `cs_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/postgres(\?|$)/, `/${name}$1`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('set client_min_messages = error');
  const roles = await client.query(`select 1 from pg_roles where rolname = 'authenticated'`);
  let stub = readFileSync(path.join(root, 'tests/db/supabase-stub.sql'), 'utf8');
  if (roles.rowCount) stub = stub.replace(/^create role .*$/gm, '');
  await client.query(stub);
  const dir = path.join(root, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await client.query(readFileSync(path.join(dir, f), 'utf8'));
  }
  return new Db(client, name, url);
}

export class Db {
  constructor(public client: pg.Client, public name: string, public url: string) {}

  async close() {
    await this.client.end();
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${this.name}`);
    await admin.end();
  }

  /** Run SQL as a given user (authenticated role + JWT sub) or anon (uid null). */
  async as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    await this.client.query('begin');
    try {
      await this.client.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
      await this.client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
      const r = await this.client.query(sql, params);
      await this.client.query('commit');
      return r.rows as T[];
    } catch (e) {
      await this.client.query('rollback');
      throw e;
    }
  }

  async rpc<T = unknown>(uid: string | null, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const keys = Object.keys(args);
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    const rows = await this.as<{ r: T }>(uid, sql, keys.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v;
    }));
    return rows[0]?.r as T;
  }

  /** Simulate Supabase Auth signUp (GoTrue inserts into auth.users). */
  async signUp(email: string, meta: Record<string, unknown>): Promise<string> {
    const r = await this.client.query(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify(meta)]);
    return r.rows[0].id;
  }

  async sql<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.client.query(sql, params)).rows as T[];
  }
}

export async function expectErr(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes(code)) return;
    throw new Error(`Expected error containing "${code}" but got: ${msg}`);
  }
  throw new Error(`Expected error "${code}" but call succeeded`);
}

/** Creates owner + n invited friends. Returns ids. */
export async function setupUsers(db: Db, n: number) {
  const ownerTok = (await db.sql<{ t: string }>(`select public.bootstrap_owner_invitation('owner@example.com') as t`))[0].t;
  const owner = await db.signUp('owner@example.com', { invite_token: ownerTok, display_name: 'Owner' });
  const friends: string[] = [];
  for (let i = 0; i < n; i++) {
    const inv = await db.rpc<{ token: string }>(owner, 'create_invitation', { p_email: `f${i}@example.com` });
    friends.push(await db.signUp(`f${i}@example.com`, { invite_token: inv.token, display_name: `Friend ${i}` }));
  }
  return { owner, friends };
}
