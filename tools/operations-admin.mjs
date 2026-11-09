import {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';

const [action,path]=process.argv.slice(2);
if(!['status','pause','resume','snapshot','compare'].includes(action))throw Error('USAGE: operations-admin.mjs status|pause|resume|snapshot <path>|compare <path>');
if(!process.env.OPERATIONS_ADMIN_DATABASE_URL)throw Error('OPERATIONS_ADMIN_DATABASE_URL_REQUIRED');
const pool=new Pool({connectionString:process.env.OPERATIONS_ADMIN_DATABASE_URL,max:1,connectionTimeoutMillis:3000,statement_timeout:30000});
try {
  if(action==='pause'||action==='resume'){
    if(process.env.OPERATIONS_CONFIRM_DATABASE!==new URL(process.env.OPERATIONS_ADMIN_DATABASE_URL).pathname.slice(1))throw Error('OPERATIONS_CONFIRM_DATABASE_MISMATCH');
    await pool.query('UPDATE operational_control SET paused=$1 WHERE singleton',[action==='pause']);
    console.log(JSON.stringify({event:'operational_admission_changed',paused:action==='pause',time:new Date().toISOString()}));
  }else if(action==='status'){
    const result=await pool.query(`SELECT (SELECT paused FROM operational_control WHERE singleton) AS paused,
      count(*) FILTER(WHERE completed_at IS NULL AND lease_until>clock_timestamp()) AS active,
      coalesce(sum(coalesce(charged_cents,estimate_cents)) FILTER(WHERE period=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date),0) AS reserved_and_charged_cents FROM operational_reservations`);
    console.log(JSON.stringify({event:'operational_status',...result.rows[0],time:new Date().toISOString()}));
  }else{
    if(!path)throw Error('SNAPSHOT_PATH_REQUIRED');
    const snapshot={schemaVersion:'recovery-evidence.v1',capturedAt:new Date().toISOString(),tables:{}};
    // Snapshot only deterministic hashes. Neither credential identities nor source material
    // should appear in operator artifacts. Stream rows would be appropriate beyond pilot size.
    for(const table of ['release_manifests','credentials']){
      const result=await pool.query(`SELECT row_to_json(t)::text AS row FROM public.${table} t ORDER BY row_to_json(t)::text`);
      snapshot.tables[table]={count:result.rowCount,sha256:createHash('sha256').update(result.rows.map(item=>item.row).join('\n')).digest('hex')};
    }
    if(action==='snapshot')await writeFile(path,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});
    else{
      const previous=JSON.parse(await readFile(path,'utf8'));
      if(previous.schemaVersion!==snapshot.schemaVersion||JSON.stringify(previous.tables)!==JSON.stringify(snapshot.tables))throw Error('RECOVERY_EVIDENCE_MISMATCH');
      console.log(JSON.stringify({event:'recovery_evidence_verified',capturedAt:previous.capturedAt,verifiedAt:snapshot.capturedAt,tables:snapshot.tables}));
    }
  }
}finally{await pool.end();}
