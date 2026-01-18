import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const dataPath = path.join(process.cwd(), 'prisma/seed/adpc.v1.json');
  const { questions, version } = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  console.log(`🌱 Iniciando Seed ADPC versão ${version}...`);

  for (const q of questions) {
    // Upsert da Questão
    const question = await prisma.adpcQuestion.upsert({
      where: { code: q.code },
      update: {
        text: q.text,
        dimension: q.dimension,
        version: version
      },
      create: {
        code: q.code,
        text: q.text,
        dimension: q.dimension,
        version: version
      }
    });

    // Upsert das Opções
    for (const opt of q.options) {
      await prisma.adpcOption.upsert({
        where: {
          questionId_code: {
            questionId: question.id,
            code: opt.code
          }
        },
        update: {
          text: opt.text,
          weight: opt.weight
        },
        create: {
          questionId: question.id,
          code: opt.code,
          text: opt.text,
          weight: opt.weight
        }
      });
    }
  }

  console.log('✅ Seed finalizado com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
