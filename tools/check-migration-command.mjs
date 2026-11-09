import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {readMigrationConfiguration} from './migrate-database.mjs';

const env={ADMIN_DATABASE_URL:'postgresql://admin:secret@localhost:54329/medical_device',DATABASE_URL:'postgresql://medical_device_runtime:runtime@localhost:54329/medical_device',POSTGRES_RUNTIME_PASSWORD:'runtime',POSTGRES_OUTBOX_PASSWORD:'outbox',MIGRATION_CONFIRM_DATABASE:'medical_device'};
assert.equal(readMigrationConfiguration(env).runtimePassword,'runtime');
assert.throws(()=>readMigrationConfiguration({...env,MIGRATION_CONFIRM_DATABASE:'other'}),/MIGRATION_DATABASE_CONFIRMATION_INVALID/);
assert.throws(()=>readMigrationConfiguration({...env,DATABASE_URL:env.DATABASE_URL.replace('localhost','another-host')}),/MIGRATION_DATABASE_CONFIGURATION_INVALID/);
assert.throws(()=>readMigrationConfiguration({...env,DATABASE_URL:env.DATABASE_URL.replace(':runtime@',':wrong@')}),/MIGRATION_DATABASE_CONFIGURATION_INVALID/);
const result=spawnSync(process.execPath,['tools/migrate-database.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,ADMIN_DATABASE_URL:'secret-database-value-should-not-log'}});
assert.notEqual(result.status,0);assert.ok(!result.stderr.includes('secret-database-value'));assert.match(result.stderr,/database_migration_failed/);
const docker=await readFile(new URL('../Dockerfile.worker',import.meta.url),'utf8');
assert.match(docker,/COPY tools\/migrate-database.mjs \.\/tools\/migrate-database.mjs/);
const bicep=await readFile(new URL('../infra/azure/database-migration-job.bicep',import.meta.url),'utf8');
assert.match(bicep,/triggerType:'Manual'/);assert.match(bicep,/tools\/migrate-database.mjs/);
console.log('Migration command passed: explicit target, matched restricted runtime, malformed configuration fail closed, safe diagnostics and packaged manual job entrypoint.');
