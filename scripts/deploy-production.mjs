import { spawn } from 'node:child_process';
import { cp, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const siteId = '7b9253fa-7b7b-4a7d-96ba-bf1757a225c5';
const repository = resolve(import.meta.dirname, '..');
const prefix = join(tmpdir(), 'contotron-deploy-');
const stage = await mkdtemp(prefix);

try {
  await cp(join(repository, 'dist'), join(stage, 'dist'), { recursive: true });
  await copyFile(join(repository, 'netlify.toml'), join(stage, 'netlify.toml'));

  // Netlify CLI on this host cannot write to the repository's old .netlify/v1
  // directory. A fresh, isolated working directory keeps the same site ID,
  // redirects and headers while deploying the build already verified above.
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['--yes', 'netlify-cli', 'deploy', '--prod', '--no-build', '--dir', 'dist', '--site', siteId];
  const exitCode = await new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd: stage,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('close', code => done(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  const safePrefix = resolve(tmpdir()) + sep;
  if (!resolve(stage).startsWith(safePrefix) || !stage.startsWith(prefix)) {
    throw new Error('Percorso temporaneo di deploy inatteso: pulizia non eseguita.');
  }
  await rm(stage, { recursive: true, force: true });
}
