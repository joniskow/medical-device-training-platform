import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const testProject = 'medical-device-technical-test';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = resolve(root, 'infra/local/docker-compose.yml');
const volumeNames = ['postgres-data', 'postgres-vector-data', 'azurite-data'].map(name => `${testProject}_${name}`);

export function assertDisposableVolumes(volumes, confirmation) {
  if (confirmation !== testProject) throw Error('TEST_RESET_REQUIRES_EXACT_PROJECT_CONFIRMATION');
  const seen = new Set();
  for (const volume of volumes) {
    if (!volume || !volumeNames.includes(volume.Name) || seen.has(volume.Name) || volume.Labels?.['com.docker.compose.project'] !== testProject) throw Error('TEST_VOLUME_OWNERSHIP_MISMATCH');
    seen.add(volume.Name);
  }
}

function docker(args, capture = false) {
  const result = spawnSync('docker', args, { cwd: root, shell: false, windowsHide: true, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', timeout: 180000 });
  if (result.error || result.status !== 0) throw Error('LOCAL_TEST_DOCKER_COMMAND_FAILED');
  return result.stdout ?? '';
}
const compose = args => docker(['compose', '--project-name', testProject, '--file', composeFile, ...args]);

async function main() {
  const [action, flag, confirmation] = process.argv.slice(2);
  if (!['up', 'down', 'reset'].includes(action) || process.argv.length > 5 || (action === 'reset' ? flag !== '--confirm-project' || confirmation !== testProject : flag !== undefined)) throw Error('USAGE: node tools/local-test-environment.mjs up|down|reset [--confirm-project medical-device-technical-test]');
  if (process.env.NODE_ENV === 'production') throw Error('LOCAL_TEST_ENVIRONMENT_REFUSES_PRODUCTION');
  if (action === 'reset') {
    // Inspect every existing volume owned by this exact project before deleting anything.
    const names = docker(['volume', 'ls', '--filter', `label=com.docker.compose.project=${testProject}`, '--format', '{{.Name}}'], true).trim().split(/\r?\n/).filter(Boolean);
    const volumes = names.length ? JSON.parse(docker(['volume', 'inspect', ...names], true)) : [];
    assertDisposableVolumes(volumes, confirmation);
    compose(['down', '--volumes', '--remove-orphans']);
  }
  if (action === 'down') { compose(['down']); return; }
  for (const port of [54329, 54339, 10000, 10001, 10002]) {
    const ids = docker(['ps', '--filter', `publish=${port}`, '--format', '{{.ID}}'], true).trim().split(/\r?\n/).filter(Boolean);
    if (ids.length) {
      const containers = JSON.parse(docker(['inspect', ...ids], true));
      if (containers.some(container => container.Config.Labels?.['com.docker.compose.project'] !== testProject)) throw Error(`LOCAL_TEST_PORT_CONFLICT:${port}`);
    }
  }
  compose(['up', '--detach', '--wait', '--wait-timeout', '120', 'postgres', 'postgres-vector', 'azurite']);
  const { Pool } = await import('pg');
  const { applyProcessingJobMigration, grantRuntimeDomainTables, reconcileOutboxTablePermissions } = await import('../packages/db/dist/index.js');
  const pool = new Pool({ connectionString: 'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device', connectionTimeoutMillis: 5000 });
  try {
    await applyProcessingJobMigration(pool);
    await grantRuntimeDomainTables(pool, 'local_runtime');
    await reconcileOutboxTablePermissions(pool, 'medical_device_outbox_publisher');
    const roles = (await pool.query("SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('local_runtime','medical_device_outbox_publisher') ORDER BY rolname")).rows;
    if (roles.length !== 2 || roles.some(role => role.rolsuper || role.rolbypassrls)) throw Error('LOCAL_TEST_RUNTIME_ROLE_UNSAFE');
    console.log('Disposable local environment ready; migrations applied and restricted runtime/outbox roles verified.');
  } finally { await pool.end(); }
  const vectorPool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54339/medical_device',connectionTimeoutMillis:5000});
  try{await applyProcessingJobMigration(vectorPool);await grantRuntimeDomainTables(vectorPool,'local_runtime');await reconcileOutboxTablePermissions(vectorPool,'medical_device_outbox_publisher');}finally{await vectorPool.end();}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
