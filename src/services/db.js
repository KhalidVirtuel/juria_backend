import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();
async function wait(ms){ return new Promise(r => setTimeout(r, ms)); }
export async function connectWithRetry(retries=30, delay=1500){
  for(let i=1;i<=retries;i++){
    try{ await prisma.$queryRaw`SELECT 1`; console.log(`[DB] Connected (attempt ${i})`); return prisma; }
    catch(e){ console.log(`[DB] Not ready (attempt ${i}) -> retry in ${delay}ms`); await wait(delay); }
  }
  throw new Error('MySQL not reachable via Prisma');
}
