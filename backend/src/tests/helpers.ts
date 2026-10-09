import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { seed } from '../seed';

export async function resetAndSeed() {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('aquageno')) {
    throw new Error('Refusing to reset a database whose URL does not contain aquageno');
  }
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table.tablename}" RESTART IDENTITY CASCADE`);
  }
  await seed();
}

export function agent() {
  return request.agent(app);
}

export async function login(email: string, password: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res;
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function disconnect() {
  await prisma.$disconnect();
}
