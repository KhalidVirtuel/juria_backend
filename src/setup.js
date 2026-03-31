// src/scripts/setup.js
import { PrismaClient } from '@prisma/client';
import bcryptjs from 'bcryptjs';

const prisma = new PrismaClient();

async function setup() {
  console.log('🚀 Setup de la base de données...');
  
  // 1. Vérifier la connexion
  await prisma.$connect();
  console.log('✅ Connexion à la base de données OK');
  
  // 2. Créer un utilisateur de test
  const email = 'admin@juria.ma';
  const password = 'admin123';
  
  const existing = await prisma.user.findUnique({ where: { email } });
  
  if (!existing) {
    const passwordHash = await bcryptjs.hash(password, 10);
    
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Admin',
        lastName: 'Juria',
        firm: 'Cabinet Juria',
        specialty: 'Droit général'
      }
    });
    
    console.log('✅ Utilisateur admin créé');
    console.log('📧 Email:', email);
    console.log('🔑 Mot de passe:', password);
  } else {
    console.log('✅ Utilisateur admin existe déjà');
  }
  
  // 3. Vérifier les tables
  const userCount = await prisma.user.count();
  console.log(`📊 Nombre d'utilisateurs: ${userCount}`);
  
  console.log('✅ Setup terminé !');
}

setup()
  .catch(console.error)
  .finally(() => prisma.$disconnect());