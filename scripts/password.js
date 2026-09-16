import { randomBytes, scryptSync } from 'node:crypto';
const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Usage: npm run password -- "a password of at least 12 characters"');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
console.log(`scrypt:${salt}:${scryptSync(password, salt, 32).toString('hex')}`);
