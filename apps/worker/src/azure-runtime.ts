import {createMediaAssetProcessor} from './media-asset-processor.js';
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
import { createDeterministicAssetScanner } from "./asset-scanner.js";
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
}

export function createAzureBackgroundProcessingRuntime(options: AzureBackgroundProcessingOptions): {
  runtime: ReturnType<typeof createBackgroundProcessingRuntime>;
  ensureStorage(): Promise<void>;
  close(): Promise<void>;
} {
  const credential = new DefaultAzureCredential();
  if(options.emailReports?.namespace.toLowerCase()===options.serviceBusNamespace.toLowerCase())throw Error('EMAIL_REPORT_NAMESPACE_MUST_BE_DEDICATED');
  const databasePool = new Pool({ connectionString: options.databaseUrl });
  const outboxPool = new Pool({ connectionString: options.outboxDatabaseUrl });
  const jobStore = createPostgresJobStore(databasePool);
  const lifecycleStore = createPostgresAssetLifecycleStore(databasePool);
  const outbox = createPostgresOutboxStore(outboxPool);
  const notices=createCourseChangeNotificationStore(databasePool);
  const qualifications=createScheduledQualificationStore(databasePool);
  const credentialNotices=createCredentialNotificationStore(databasePool);
  const invitationEmails=options.invitationEmail?createInvitationEmailProcessor(databasePool,options.invitationEmail):undefined;
  const storage = createAzureBlobStorage({
    accountUrl: options.storageAccountUrl,
    credential,
    containerName: options.storageContainerName
  });
  const scanner = createDeterministicAssetScanner();
  const openMontageProvider = options.openMontageProvider ?? createOpenMontageProvider();
  const speechProvider = options.speechProvider ?? createSpeechProvider();
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
    processor: createPdfAssetProcessor({storage,knowledge:createPostgresKnowledgeStore(databasePool),fallback:createGlbAssetProcessor({storage,models:createModelImportStore(databasePool),fallback:createMediaAssetProcessor({storage,fallback:options.processor})})}),
    lifecycleStore,
    scanner,
    workerId: options.workerId,
    processReconstruction:input=>processReconstructionJob({jobStore,storage,sources:createReconstructionStore(databasePool),engine:options.reconstructionEngine,...input}),
    processOpenMontageGeneration:input=>processOpenMontageGenerationJob({jobStore,storage,provider:openMontageProvider,speech:speechProvider,...input}),
    maxConcurrentCalls: options.reconstructionEngine?1:options.maxConcurrentCalls,
    onError: async (args) => { await options.onError?.(args); }
  });
  const reportClient=options.emailReports?new ServiceBusClient(options.emailReports.namespace,credential):undefined;
  const reportStore=createEmailDeliveryReportStore(databasePool);
  const reportConsumer=options.emailReports&&reportClient?createEmailReportConsumer({client:reportClient,queueName:options.emailReports.queueName,expected:{topic:options.emailReports.topic,sender:options.emailReports.sender},workerId:options.workerId,
    resolveOrganization:async operationId=>(await outboxPool.query(`SELECT organization_id FROM email_delivery_attempts WHERE operation_id=$1`,[operationId])).rows[0]?.organization_id??null,
    apply:(tenant,report)=>reportStore.apply(tenant,report),onError:options.onError}):undefined;
  const runtime = createBackgroundProcessingRuntime({
    outbox,
    dispatcher,
    consumer:{async close(){const closed=await Promise.allSettled([consumer.close(),reportConsumer?.close()]);const failed=closed.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;}},
    workerId: options.workerId,
    publishIntervalMs: options.publishIntervalMs,
    maintenance:async()=>{
      if(invitationEmails){
        const invitations=await outboxPool.query(`SELECT outbox_event_id,organization_id FROM outbox_events WHERE event_type='organization.invitation.deliver' AND state IN ('PENDING','CLAIMED') AND available_at<=now() ORDER BY available_at,outbox_event_id LIMIT 5`);
        for(const event of invitations.rows){const result=await invitationEmails.process({organizationId:event.organization_id,actorId:options.workerId,correlationId:event.outbox_event_id},event.outbox_event_id);if('errorCode' in result)await options.onError?.(new Error(result.errorCode));}
      }
      const jobs=await outboxPool.query(`SELECT outbox_event_id,organization_id,event_type FROM outbox_events WHERE event_type IN ('course.change.notify','course.change.assign','credential.qualify','credential.issued','credential.revoked','credential.superseded','credential.expire','credential.expired') AND state='PENDING' AND available_at<=now() ORDER BY available_at,outbox_event_id LIMIT 5`);
      for(const job of jobs.rows){const result=await (job.event_type==='credential.qualify'?qualifications:job.event_type.startsWith('credential.')?credentialNotices:notices).process({organizationId:job.organization_id,actorId:options.workerId,correlationId:job.outbox_event_id},job.outbox_event_id);if('errorCode' in result&&result.errorCode)await options.onError?.(new Error(result.errorCode));}
    },
    onError: options.onError
  });

  return {
    runtime,
    ensureStorage: () => storage.ensureContainers(),
    async close() {
      try{await runtime.close();}finally{await Promise.allSettled([serviceBusClient.close(),reportClient?.close(),databasePool.end(),outboxPool.end()]);}
    }
  };
}
