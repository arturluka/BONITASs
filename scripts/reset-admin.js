import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import { db } from '../database/database.js';

const rl = readline.createInterface({ input, output });
try {
  const name = (await rl.question('Nome do administrador: ')).trim();
  const email = (await rl.question('E-mail usado no login: ')).trim().toLowerCase();
  const password = await rl.question('Nova senha (mínimo 10 caracteres): ');

  if (name.length < 2 || !email.includes('@') || password.length < 10) {
    throw new Error('Dados inválidos. Use um e-mail válido e uma senha com pelo menos 10 caracteres.');
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare(`
    INSERT INTO admins(name,email,password_hash)
    VALUES(?,?,?)
    ON CONFLICT(email) DO UPDATE SET
      name=excluded.name,
      password_hash=excluded.password_hash
  `).run(name, email, hash);

  console.log(`Acesso administrativo configurado para ${email}.`);
  console.log('Agora execute npm.cmd start e entre em http://localhost:3000/admin');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rl.close();
  db.close();
}
