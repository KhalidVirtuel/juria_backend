import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function connectWithRetry(retries = 15, delayMs = 1000){
  for(let i=1;i<=retries;i++){
    try{
      await prisma.$connect();
      console.log(`[DB] Connected (attempt ${i})`);
      return;
    }catch(e){
      if(i===retries) throw e;
      await new Promise(r=>setTimeout(r, delayMs));
    }
  }
}
