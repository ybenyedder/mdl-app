import { closeDb, dbDriver, ensureMigrated } from './index';

async function main(): Promise<void> {
  try {
    await ensureMigrated();
    console.log(`Migrations PostgreSQL (${dbDriver}) vérifiées et à jour.`);
  } finally {
    await closeDb();
  }
}

main().catch((error) => {
  console.error('Erreur lors de la migration :', error);
  process.exit(1);
});
