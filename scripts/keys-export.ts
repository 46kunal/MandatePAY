// Exports the local mandate signing keys (.keys/*.private.pem) as env lines for a host with no lasting disk
// (Vercel). Writes them to .keys/hosting.env (gitignored) and prints only the file path and key ids, never a key.
// Paste the two lines into the Vercel project's environment variables, then delete the file.
//   npm run keys:export
import { promises as fs } from 'node:fs';
import path from 'node:path';

async function main() {
  const { getKeyPair, resolveKeyDir, KEY_ROLES } = await import('../lib/mandate');
  const { keyEnvName } = await import('../lib/mandate/keys');
  const dir = resolveKeyDir();
  const lines: string[] = ['# MandatePay mandate signing keys. Secret: paste into the host, never commit.'];
  for (const role of KEY_ROLES) {
    const { kid } = await getKeyPair(role, dir); // creates the key locally if it does not exist yet
    const pem = await fs.readFile(path.join(dir, `${role}.private.pem`), 'utf8');
    lines.push(`${keyEnvName(role)}=${Buffer.from(pem, 'utf8').toString('base64')}`);
    console.log(`${role}: ${kid}`);
  }
  const out = path.join(dir, 'hosting.env');
  await fs.writeFile(out, lines.join('\n') + '\n', { mode: 0o600 });
  console.log(`Wrote ${out}. Copy its two lines into Vercel, then delete the file.`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
