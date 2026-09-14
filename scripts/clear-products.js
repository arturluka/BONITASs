import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { db } from '../database/database.js';

const rl = readline.createInterface({ input, output });
try {
  const answer = (await rl.question('Apagar todos os produtos da loja? Digite APAGAR para confirmar: ')).trim();
  if (answer !== 'APAGAR') {
    console.log('Operação cancelada. Nenhum produto foi alterado.');
  } else {
    const result = db.prepare('DELETE FROM products').run();
    console.log(`${result.changes} produto(s) apagado(s). A loja está pronta para receber suas roupas.`);
  }
} finally {
  rl.close();
  db.close();
}
