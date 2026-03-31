import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const email = 'demo@juria.local';
const password = 'demo123';

const run = async () => {
  const exists = await prisma.user.findUnique({ where: { email } });
  if (!exists) {
    await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        firstName: 'Demo',
        lastName: 'User'
      }
    });
    console.log('Seeded user:', email, '/', password);
  } else {
    console.log('User already exists:', email);
  }
};
run().finally(() => prisma.$disconnect());
