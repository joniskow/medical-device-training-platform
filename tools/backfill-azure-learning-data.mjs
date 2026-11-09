// Append to the backfill operator module inside a private, one-shot Azure job.
// Discovery uses the migration role; indexing uses the tenant-scoped runtime role.
const admin=new Pool({connectionString:`postgresql://${encodeURIComponent(process.env.POSTGRES_ADMIN_LOGIN)}:${encodeURIComponent(process.env.POSTGRES_ADMIN_PASSWORD)}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DATABASE}?sslmode=verify-full`,max:1,connectionTimeoutMillis:10000});
const sources=[];
try{
 for(const {organization_id:organizationId} of (await admin.query('SELECT DISTINCT organization_id FROM organization_memberships')).rows){
  await admin.query("SELECT set_config('app.organization_id',$1,false)",[organizationId]);
  const rows=await admin.query(`SELECT DISTINCT k.asset_version_id FROM knowledge_chunks k JOIN asset_versions v USING(organization_id,asset_version_id) WHERE k.source_hash=v.sha256 AND v.state IN ('READY_FOR_REVIEW','APPROVED') AND NOT public.lifecycle_asset_suppressed(v.asset_version_id)`);
  for(const row of rows.rows)sources.push({organizationId,assetVersionId:row.asset_version_id});
 }
}finally{await admin.end();}
if(sources.length>100)throw Error('BACKFILL_BATCH_LIMIT_EXCEEDED');
let indexed=0;
for(const source of sources){
 const env={...process.env,DATABASE_URL:`postgresql://medical_device_runtime:${encodeURIComponent(process.env.POSTGRES_RUNTIME_PASSWORD)}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DATABASE}?sslmode=verify-full`,EMBEDDING_BACKFILL_CONFIRM_ORGANIZATION:source.organizationId};
 let cursor='';
 do{const result=await backfillKnowledgeEmbeddings(env,[source.organizationId,source.assetVersionId,cursor]);indexed+=result.indexed;cursor=result.nextCursor??'';if(indexed>1000)throw Error('BACKFILL_BATCH_LIMIT_EXCEEDED');}while(cursor);
}
console.log(JSON.stringify({check:'existing-source-backfill',status:'PASS',sources:sources.length,indexed}));
