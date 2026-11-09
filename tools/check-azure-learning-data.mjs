// Private operator diagnostics: emit counts only, never source text or tenant IDs.
import {Pool} from 'pg';
const pool=new Pool({connectionString:`postgresql://${encodeURIComponent(process.env.POSTGRES_ADMIN_LOGIN)}:${encodeURIComponent(process.env.POSTGRES_ADMIN_PASSWORD)}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DATABASE}?sslmode=require`,max:1,connectionTimeoutMillis:10000});
try{
 const tenants=(await pool.query('SELECT DISTINCT organization_id FROM organization_memberships')).rows;
 const counts={tenants:tenants.length,chunks:0,verifiedChunks:0,embeddings:0};
 for(const tenant of tenants){
  await pool.query("SELECT set_config('app.organization_id',$1,false)",[tenant.organization_id]);
  const row=(await pool.query(`SELECT (SELECT count(*)::int FROM knowledge_chunks) AS chunks,(SELECT count(*)::int FROM knowledge_chunks k JOIN asset_versions v USING(organization_id,asset_version_id) WHERE k.source_hash=v.sha256) AS verified,(SELECT count(*)::int FROM knowledge_embeddings) AS embeddings`)).rows[0];
  counts.chunks+=row.chunks;counts.verifiedChunks+=row.verified;counts.embeddings+=row.embeddings;
 }
 console.log(JSON.stringify({check:'existing-source-index',status:'PASS',...counts}));
}catch{console.error('EXISTING_SOURCE_INDEX_CHECK_FAILED');process.exitCode=1;}finally{await pool.end();}
