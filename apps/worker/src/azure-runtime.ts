import {createMediaAssetProcessor} from './media-asset-processor.js';
import {createOperationalQueueSampler} from './operational-sampler.js';
import {createRetentionTrackedStorage,createRetentionResourceStore,assertHybridRetrievalAvailable} from '@medical-device/db';
import {createAzureEmbeddingProvider} from '@medical-device/ai-gateway';
import {createSourceUsageMeteringStore,readSourceUsageRates} from '@medical-device/db';
import {createMeteredSpeechProvider,createMeteredVideoProvider,createMeteredReconstructionEngine,withProviderUsageContext} from './provider-usage.js';
import { createLessonRenderStore } from '@medical-device/db';
import { processHostedLessonRenderJob } from './hosted-lesson-render.js';
import { createOperationsStore,createProtectedExportStore,createRetentionGovernanceStore } from '@medical-device/db';
import { createBudgetedJobHandler } from './budgeted-job.js';
import { processAssetJob } from './job-runner.js';
import { boundedInteger } from '@medical-device/contracts';
import { createCustomerWebhookProcessor } from './customer-webhooks.js';
import { createLifecycleNotificationProcessor } from './lifecycle-notifications.js';
import {processReconstructionJob} from './reconstruction-job.js';
import {processOpenMontageGenerationJob} from './openmontage-generation-job.js';
import {createOpenMontageProvider} from './openmontage-provider.js';
import {createSpeechProvider} from './speech-provider.js';
import {createReconstructionStore} from '@medical-device/db';
import type {ReconstructionEngine} from '@medical-device/contracts';
import {createPdfAssetProcessor} from "./pdf-asset-processor.js";
import {createGlbAssetProcessor} from './glb-asset-processor.js';
import {createModelImportStore} from '@medical-device/db';
import { DefaultAzureCredential } from "@azure/identity";
import { ServiceBusClient } from "@azure/service-bus";
import { Pool } from "pg";
import type { AssetProcessorPort, OpenMontageProviderPort, SpeechSynthesisPort } from "@medical-device/contracts";
import { createPostgresKnowledgeStore, createPostgresAssetLifecycleStore, createPostgresJobStore, createPostgresOutboxStore,createCourseChangeNotificationStore,createScheduledQualificationStore,createCredentialNotificationStore } from "@medical-device/db";
import { createBackgroundProcessingRuntime } from "./worker-runtime.js";
import { createAzureServiceBusDispatcher } from "./messaging/azure-service-bus-dispatcher.js";
import { createAzureServiceBusWorker } from "./messaging/azure-service-bus-consumer.js";
import { createAzureBlobStorage } from "./storage/azure-blob-storage.js";
import { createAssetScannerFromEnvironment } from "./asset-scanner.js";
import {createInvitationEmailProcessor,type InvitationEmailSender} from './invitation-email.js';
import type {InvitationEmailRateLimit} from '@medical-device/db';
import {createEmailDeliveryReportStore} from '@medical-device/db';
import {createEmailReportConsumer} from './email-report-consumer.js';
import type {EmailReportConfiguration} from './email-report-configuration.js';

export interface AzureBackgroundProcessingOptions {
  databaseUrl: string;
  outboxDatabaseUrl: string;
  serviceBusNamespace: string;
  storageAccountUrl: string;
  storageContainerName: string;
  serviceBusQueueName: string;
  signingSecret: string;
  workerId: string;
  processor: AssetProcessorPort;
  reconstructionEngine?:ReconstructionEngine;
  openMontageProvider?: OpenMontageProviderPort;
  speechProvider?: SpeechSynthesisPort;
  maxConcurrentCalls?: number;
  publishIntervalMs?: number;
  onError?: (error: unknown) => Promise<void> | void;
  invitationEmail?:{sender:InvitationEmailSender;keys:ReadonlyMap<string,Buffer>;applicationOrigin:string;rateLimit:InvitationEmailRateLimit};
  emailReports?:EmailReportConfiguration;
  operationalSecret?:string;
  webhookKeys?:ReadonlyMap<string,Buffer>;
}

export function createAzureBackgroundProcessingRuntime(options: AzureBackgroundProcessingOptions): {
  runtime: ReturnType<typeof createBackgroundProcessingRuntime>;
  ensureStorage(): Promise<void>;
  close(): Promise<void>;
} {
  const credential = new DefaultAzureCredential();
  if(options.emailReports?.namespace.toLowerCase()===options.serviceBusNamespace.toLowerCase())throw Error('EMAIL_REPORT_NAMESPACE_MUST_BE_DEDICATED');
  const databasePool = new Pool({ connectionString: options.databaseUrl,max:5,connectionTimeoutMillis:2000,statement_timeout:10000,query_timeout:12000,idleTimeoutMillis:30000 });
  const outboxPool = new Pool({ connectionString: options.outboxDatabaseUrl,max:2,connectionTimeoutMillis:2000,statement_timeout:10000,query_timeout:12000,idleTimeoutMillis:30000 });
  const jobStore = createPostgresJobStore(databasePool);
  const meteringPool=new Pool({connectionString:options.databaseUrl,max:2,connectionTimeoutMillis:2000,statement_timeout:10000,query_timeout:12000,idleTimeoutMillis:30000});
  const sourceUsage=createSourceUsageMeteringStore(meteringPool,{rates:readSourceUsageRates(process.env.SOURCE_USAGE_RATES_JSON),telemetrySecret:options.operationalSecret});
  const lifecycleStore = createPostgresAssetLifecycleStore(databasePool);
  const outbox = createPostgresOutboxStore(outboxPool);
  const notices=createCourseChangeNotificationStore(databasePool);
  const qualifications=createScheduledQualificationStore(databasePool);
  const credentialNotices=createCredentialNotificationStore(databasePool);
  const invitationEmails=options.invitationEmail?createInvitationEmailProcessor(databasePool,options.invitationEmail):undefined;
  const storage = createRetentionTrackedStorage(databasePool,createAzureBlobStorage({
    accountUrl: options.storageAccountUrl,
    credential,
    containerName: options.storageContainerName,
    onUsage:sourceUsage.storage
  }),{receiptPool:meteringPool});
  const scanner = createAssetScannerFromEnvironment();
  const openMontageProvider = createMeteredVideoProvider(options.openMontageProvider ?? createOpenMontageProvider(),sourceUsage.record);
  const speechProvider = createMeteredSpeechProvider(options.speechProvider ?? createSpeechProvider(),sourceUsage.record);
  const reconstructionEngine=options.reconstructionEngine?createMeteredReconstructionEngine(options.reconstructionEngine,sourceUsage.record):undefined;
  const embeddings=createAzureEmbeddingProvider(process.env,{onUsage:sourceUsage.record});
  const processor=createPdfAssetProcessor({storage,knowledge:createPostgresKnowledgeStore(databasePool,embeddings),fallback:createGlbAssetProcessor({storage,models:createModelImportStore(databasePool),fallback:createMediaAssetProcessor({storage,fallback:options.processor})})});
  const admission=createOperationsStore(databasePool);
  const budgeted=(key:string,fallback:number,handler:Parameters<typeof createBudgetedJobHandler>[0]['handler'])=>options.operationalSecret?createBudgetedJobHandler({store:admission,jobStore,secret:options.operationalSecret,estimateCents:boundedInteger(process.env[key],fallback,50000,key),handler,recordUsage:sourceUsage.record}):(input:Parameters<ReturnType<typeof createBudgetedJobHandler>>[0])=>withProviderUsageContext(input.tenant,()=>handler({...input,signal:new AbortController().signal}));
  const webhooks=options.webhookKeys?.size?createCustomerWebhookProcessor(databasePool,{keys:options.webhookKeys}):undefined;
  const exports=createProtectedExportStore(databasePool,storage);
  const retention=createRetentionGovernanceStore(databasePool,storage);
  const retentionResources=createRetentionResourceStore(databasePool,storage);
  const lifecycleEmails=options.invitationEmail?createLifecycleNotificationProcessor(databasePool,{sender:options.invitationEmail.sender}):undefined;
  const serviceBusClient = new ServiceBusClient(options.serviceBusNamespace, credential);
  const dispatcher = createAzureServiceBusDispatcher({
    client: serviceBusClient,
    queueName: options.serviceBusQueueName,
    signingSecret: options.signingSecret
  });
  const consumer = createAzureServiceBusWorker({
    client: serviceBusClient,
    queueName: options.serviceBusQueueName,
    signingSecret: options.signingSecret,
    dispatcher,
    jobStore,
    storage,
    processor,
    lifecycleStore,
    scanner,
    workerId: options.workerId,
    processAsset:budgeted('ASSET_MAX_RUN_COST_CENTS',100,input=>processAssetJob({jobStore,storage,processor,lifecycleStore,scanner,...input})),
    processReconstruction:budgeted('RECONSTRUCTION_MAX_RUN_COST_CENTS',1000,input=>processReconstructionJob({jobStore,storage,sources:createReconstructionStore(databasePool),engine:reconstructionEngine,...input})),
    processOpenMontageGeneration:budgeted('VIDEO_MAX_RUN_COST_CENTS',1000,input=>processOpenMontageGenerationJob({jobStore,storage,provider:openMontageProvider,speech:speechProvider,...input})),
    processLessonRender:budgeted('LESSON_MAX_RUN_COST_CENTS',500,input=>processHostedLessonRenderJob({jobStore,store:createLessonRenderStore(databasePool),storage,speech:speechProvider,...input})),
    maxConcurrentCalls: options.reconstructionEngine?1:options.maxConcurrentCalls,
    onError: async (args) => { await options.onError?.(args); }
  });
  const reportClient=options.emailReports?new ServiceBusClient(options.emailReports.namespace,credential):undefined;
  const reportStore=createEmailDeliveryReportStore(databasePool);
  const reportConsumer=options.emailReports&&reportClient?createEmailReportConsumer({client:reportClient,queueName:options.emailReports.queueName,expected:{topic:options.emailReports.topic,sender:options.emailReports.sender},workerId:options.workerId,
    resolveOrganization:async operationId=>(await outboxPool.query(`SELECT organization_id FROM email_delivery_attempts WHERE operation_id=$1`,[operationId])).rows[0]?.organization_id??null,
    apply:(tenant,report)=>reportStore.apply(tenant,report),onError:options.onError}):undefined;
  const telemetryReceiver=options.operationalSecret?serviceBusClient.createReceiver(options.serviceBusQueueName):undefined;
  const sampleOperations=telemetryReceiver&&options.operationalSecret?createOperationalQueueSampler({outboxPool,applicationPool:databasePool,receiver:telemetryReceiver,secret:options.operationalSecret}):undefined;
  const maintenanceSignal=(domain:'webhook'|'email'|'export'|'credential',result:unknown)=>{
    if(!result||typeof result!=='object')return;
    const state='state' in result?String(result.state):'unknown';
    const failed=('errorCode' in result&&Boolean(result.errorCode))||['FAILED','RETRY_PENDING'].includes(state)||(['email','webhook'].includes(domain)&&state==='PENDING');
    try{console.log(JSON.stringify({event:'domain_processing_result',service:'worker',domain,state:['FAILED','RETRY_PENDING','SUCCEEDED','ACCEPTED','SKIPPED','PENDING','PUBLISHED','WAITING_FOR_VERIFICATION','SCHEDULED','STALE','SUPPRESSED'].includes(state)?state:'other',failed}));}catch{/* Best-effort observability cannot change committed domain state. */}
  };
  const runtime = createBackgroundProcessingRuntime({
    outbox,
    dispatcher,
    consumer:{async close(){const closed=await Promise.allSettled([consumer.close(),reportConsumer?.close()]);const failed=closed.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;}},
    workerId: options.workerId,
    publishIntervalMs: options.publishIntervalMs,
    maintenance:async()=>{
      await sampleOperations?.();
      await outboxPool.query('SELECT public.advance_inquiry_lifecycle()');
      const due=await outboxPool.query(`SELECT * FROM public.due_lifecycle_deliveries()`);
      for(const item of due.rows){
        const context={organizationId:item.organization_id,actorId:options.workerId,correlationId:item.work_id};
        if(item.kind==='export')maintenanceSignal('export',await exports.process(context,item.work_id));
        else if(item.kind==='webhook'&&webhooks)maintenanceSignal('webhook',await webhooks.process(context,item.work_id));
      }
      const retentionOrganizations=await outboxPool.query('SELECT * FROM public.due_retention_organizations()');
      for(const item of retentionOrganizations.rows)await retention.purgeDue({organizationId:item.organization_id,actorId:options.workerId,correlationId:'retention:'+options.workerId});
      const resourceOrganizations=await outboxPool.query('SELECT * FROM public.due_retention_resource_organizations()');
      for(const item of resourceOrganizations.rows)await retentionResources.purgeDue({organizationId:item.organization_id,actorId:options.workerId,correlationId:'resource-retention:'+options.workerId});
      if(lifecycleEmails){
        const messages=await outboxPool.query(`SELECT outbox_event_id,organization_id FROM outbox_events WHERE event_type='lifecycle.notification.deliver' AND state IN ('PENDING','CLAIMED') AND available_at<=now() ORDER BY available_at,outbox_event_id LIMIT 5`);
        for(const message of messages.rows)maintenanceSignal('email',await lifecycleEmails.process({organizationId:message.organization_id,actorId:options.workerId,correlationId:message.outbox_event_id},message.outbox_event_id));
      }
      if(invitationEmails){
        const invitations=await outboxPool.query(`SELECT outbox_event_id,organization_id FROM outbox_events WHERE event_type='organization.invitation.deliver' AND state IN ('PENDING','CLAIMED') AND available_at<=now() ORDER BY available_at,outbox_event_id LIMIT 5`);
        for(const event of invitations.rows){const result=await invitationEmails.process({organizationId:event.organization_id,actorId:options.workerId,correlationId:event.outbox_event_id},event.outbox_event_id);maintenanceSignal('email',result);if('errorCode' in result)await options.onError?.(new Error(result.errorCode));}
      }
      const jobs=await outboxPool.query(`SELECT outbox_event_id,organization_id,event_type FROM outbox_events WHERE event_type IN ('course.change.notify','course.change.assign','credential.qualify','credential.issued','credential.revoked','credential.superseded','credential.expire','credential.expired') AND state='PENDING' AND available_at<=now() ORDER BY available_at,outbox_event_id LIMIT 5`);
      for(const job of jobs.rows){const result=await (job.event_type==='credential.qualify'?qualifications:job.event_type.startsWith('credential.')?credentialNotices:notices).process({organizationId:job.organization_id,actorId:options.workerId,correlationId:job.outbox_event_id},job.outbox_event_id);if(job.event_type.startsWith('credential.'))maintenanceSignal('credential',result);if('errorCode' in result&&result.errorCode)await options.onError?.(new Error(result.errorCode));}
    },
    onError: options.onError
  });

  return {
    runtime,
    ensureStorage: async () => {if(embeddings)await assertHybridRetrievalAvailable(databasePool);await storage.ensureContainers();},
    async close() {
      try{await runtime.close();}finally{await Promise.allSettled([telemetryReceiver?.close(),serviceBusClient.close(),reportClient?.close(),databasePool.end(),outboxPool.end(),meteringPool.end()]);}
    }
  };
}
