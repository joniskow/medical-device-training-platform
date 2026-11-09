// Lightweight scheduled publisher; it never receives jobs or processes source assets.
import {Pool} from 'pg';
import {DefaultAzureCredential} from '@azure/identity';
import {ServiceBusClient} from '@azure/service-bus';
import {createPostgresOutboxStore} from '@medical-device/db';
import {createAzureServiceBusDispatcher} from '/app/dist/messaging/azure-service-bus-dispatcher.js';
import {publishOneOutboxMessage} from '/app/dist/outbox-publisher.js';
const pool=new Pool({connectionString:`postgresql://medical_device_outbox_publisher:${encodeURIComponent(process.env.POSTGRES_OUTBOX_PASSWORD)}@mdt-personal-pg.postgres.database.azure.com:5432/medical_device?sslmode=verify-full`,max:1,connectionTimeoutMillis:10000,statement_timeout:10000,query_timeout:12000});
const client=new ServiceBusClient('mdt-personal-sb-01.servicebus.windows.net',new DefaultAzureCredential());
const dispatcher=createAzureServiceBusDispatcher({client,queueName:'asset-processing',signingSecret:process.env.SERVICE_BUS_SIGNING_SECRET});
let published=0;
try{
 const outbox=createPostgresOutboxStore(pool),deadline=Date.now()+30000;
 while(published<100&&Date.now()<deadline){
  const result=await publishOneOutboxMessage({outbox,dispatcher,workerId:'scheduled-outbox-pump'});
  if(result.status==='EMPTY')break;
  if(result.status!=='PUBLISHED')throw Error('OUTBOX_PUMP_PUBLISH_FAILED');
  published++;
 }
 console.log(JSON.stringify({check:'scheduled-outbox-pump',status:'PASS',published}));
}catch{console.error('OUTBOX_PUMP_FAILED');process.exitCode=1;}
finally{await Promise.allSettled([dispatcher.close(),client.close(),pool.end()]);}
