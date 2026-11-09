import {createMachineIntegrationHttp} from './machine-integration-http.js';
import {createMachineIntegrationStore} from '@medical-device/db';
import { assertProductionConfiguration } from '@medical-device/contracts';
import { createEmailVerificationStore } from '@medical-device/db';
import { createEmailVerificationService } from './email-verification-service.js';
import { createAzureVerificationEmailSender } from './verification-email-sender.js';
import { createLessonRenderStore } from '@medical-device/db';
import { createLessonRenderService } from './lesson-render-service.js';
import { createOperationsStore, withOperationalAdmission } from '@medical-device/db';
import { installOperationalHttp, opaqueOperationalKey, emitOperationalEvent } from './operations-runtime.js';
import { randomUUID } from 'node:crypto';
import { boundedInteger, technicalLimits } from '@medical-device/contracts';
import {createLifecycleGovernanceStore,createDiscoveryInquiryStore,createTechnicalReportingStore,createProtectedExportStore,createCustomerWebhookStore,createLifecycleNotificationStore,createRetentionGovernanceStore,createTechnicalMeteringStore,readAiCostRates} from '@medical-device/db';
import {createLifecycleHttp} from './lifecycle-http.js';
import {createRetentionTrackedStorage,createRetentionResourceStore,createSourceUsageMeteringStore,readSourceUsageRates,assertHybridRetrievalAvailable} from '@medical-device/db';
import {createAzureEmbeddingProvider} from '@medical-device/ai-gateway';
import {readWebhookKeys,deriveWebhookSecret} from '@medical-device/db';
import {createMediaReviewService} from './media-review-service.js';
import {createReconstructionService,readReconstructionModes} from './reconstruction-service.js';
import {createMediaAssetService} from './media-asset-service.js';
import {createModelImportService} from './model-import-service.js';
import {createCourseStoryStore} from '@medical-device/db';
import {createPersonalWalletStore} from '@medical-device/db';
import {createCandidateLearningAccessStore} from '@medical-device/db';
import {createCandidateEnrollmentStore} from '@medical-device/db';
import {createPublicCourseCatalogService} from './public-course-catalog.js';
import {createCourseOfferingStore} from '@medical-device/db';
import { readBrowserAuthConfig } from './browser-auth-config.js';
import {createPersonalAccountStore} from '@medical-device/db';
import {createOrganizationProfileStore} from '@medical-device/db';
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { DefaultAzureCredential } from "@azure/identity";
import { createPostgresAiRunStore, createPostgresCourseReviewStore, createPostgresJobStore, createPostgresKnowledgeStore, createPostgresOrganizationMembershipStore, createPostgresUploadSessionStore } from "@medical-device/db";
import { createAzureOpenAiGateway, createDeterministicAiGateway, createSourceGroundedDraftService, createStagedLearningGateway } from "@medical-device/ai-gateway";
import { createAzureBlobStorage, createReleaseArtifactPublisher } from "@medical-device/storage";
import { createJobStatusService } from "./job-status-service.js";
import { createEntraRequestAuthenticator } from "./entra-authenticator.js";
import { createJobStatusHttpServer } from "./job-status-http.js";
import { createUploadSessionService } from "./upload-session-service.js";
import { createPostgresModelAssetService } from "./postgres-model-asset-service.js";
import { createPostgresModelSessionService } from "./postgres-model-session-service.js";
import { createPostgresAssessmentSessionService } from "./assessment-session-service.js";
import { createPostgresEnrollmentService } from "./enrollment-service.js";
import { createLearnerSimulationService } from "./learner-simulation-service.js";
import { createPostgresCredentialService } from "./credential-service.js";
import { createPublicVerificationService } from "./public-verification-service.js";
import { createAttemptReviewService } from './attempt-review.js';
import { createNotificationService } from './notification-service.js';
import { createMemberService } from './member-service.js';
import {createInvitationService} from './invitation-service.js';
import {readInvitationConfiguration} from './invitation-configuration.js';
import { createCourseChangeService } from './course-change-service.js';
import { createAttemptInvalidationService } from './attempt-invalidation.js';
import { createOpenMontageSceneService } from './openmontage-scene-service.js';
import { createOpenMontageGenerationService } from './openmontage-generation-service.js';
import { readImageGenerationBaseInstructions } from './image-generation-configuration.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`API_CONFIGURATION_MISSING:${name}`);
  return value;
}

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

assertProductionConfiguration('api', process.env);
const postgresHost = process.env.POSTGRES_HOST?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim() ?? (postgresHost
  ? `postgresql://${encodeURIComponent(process.env.POSTGRES_RUNTIME_LOGIN?.trim() || "medical_device_runtime")}:${encodeURIComponent(required("POSTGRES_RUNTIME_PASSWORD"))}@${postgresHost}:5432/${process.env.POSTGRES_DATABASE?.trim() || "medical_device"}?sslmode=require`
  : required("DATABASE_URL"));
const pool = new Pool({ connectionString: databaseUrl, max: boundedInteger(process.env.API_DB_POOL_MAX,5,32,'API_DB_POOL_MAX'), connectionTimeoutMillis:2000,statement_timeout:10000,query_timeout:12000,idleTimeoutMillis:30000 });
const operationsStore=createOperationsStore(pool);
const operationalSecret=process.env.OPERATIONAL_KEY_SECRET?.trim();
if(['production','staging'].includes(process.env.APP_ENV?.toLowerCase()??'')&&!operationalSecret)throw Error('OPERATIONAL_KEY_SECRET_REQUIRED');
const store = createPostgresJobStore(pool);
const organizationContextResolver = createPostgresOrganizationMembershipStore(pool);
const statusService = createJobStatusService(store);
const storageConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
const storageAccountUrl = process.env.STORAGE_ACCOUNT_URL?.trim();
const meteringPool=new Pool({connectionString:databaseUrl,max:2,connectionTimeoutMillis:2000,statement_timeout:10000,query_timeout:12000,idleTimeoutMillis:30000});
const sourceUsage=createSourceUsageMeteringStore(meteringPool,{rates:readSourceUsageRates(process.env.SOURCE_USAGE_RATES_JSON),telemetrySecret:operationalSecret});
const storage = createRetentionTrackedStorage(pool,createAzureBlobStorage({
  ...(storageConnectionString ? { connectionString: storageConnectionString } : { accountUrl: required("STORAGE_ACCOUNT_URL"), credential: new DefaultAzureCredential() }),
  containerName: process.env.STORAGE_CONTAINER_NAME?.trim() || "source-assets",
  maxReadBytes: Number(process.env.STORAGE_MAX_READ_BYTES ?? 128 * 1024 * 1024),
  onUsage:sourceUsage.storage,
  allowHttp: Boolean(storageConnectionString && process.env.APP_ENV !== "production")
}),{receiptPool:meteringPool});
await storage.ensureContainers();
const courseReviewStore = createPostgresCourseReviewStore(pool, { releaseArtifacts: createReleaseArtifactPublisher({ storage }) });
const uploadSessionService = createUploadSessionService({
  store: createPostgresUploadSessionStore(pool),
  storage,
  jobStore: store,
  uploadTtlSeconds: Number(process.env.UPLOAD_SESSION_TTL_SECONDS ?? 900),
  privateUpload: true
});
const modelAssetService = createPostgresModelAssetService({ pool, storage, privateDelivery:true });
const modelSessionService = createPostgresModelSessionService({ pool });
const aiMode = process.env.AI_PROVIDER_MODE?.trim() || "deterministic";
const instructionalDeployment = process.env.AZURE_OPENAI_INSTRUCTIONAL_DEPLOYMENT?.trim();
const instructionalModel = process.env.AZURE_OPENAI_INSTRUCTIONAL_MODEL?.trim();
if (Boolean(instructionalDeployment) !== Boolean(instructionalModel)) throw Error('AI_INSTRUCTIONAL_CONFIGURATION_INCOMPLETE');
const stagedLearning = aiMode === 'azure-openai' && process.env.AI_STAGED_LEARNING !== 'false';
const providerGateway = aiMode === "azure-openai"
  ? createAzureOpenAiGateway({
    endpoint: required("AZURE_OPENAI_ENDPOINT"),
    apiKey: required("AZURE_OPENAI_API_KEY"),
    deployment: instructionalDeployment || required("AZURE_OPENAI_DEPLOYMENT"),
    model: instructionalModel || process.env.AZURE_OPENAI_MODEL?.trim() || "gpt-4o-mini",
    apiVersion: process.env.AZURE_OPENAI_API_VERSION?.trim() || "2024-10-21"
  })
  : createDeterministicAiGateway();
const learningGateway = stagedLearning ? createStagedLearningGateway(providerGateway) : providerGateway;
const aiGateway=operationalSecret?{execute:(request:Parameters<typeof providerGateway.execute>[0])=>withOperationalAdmission({store:operationsStore,key:opaqueOperationalKey(operationalSecret,'ai',JSON.stringify([request.tenant.organizationId,request.tenant.actorId,randomUUID()])),estimateCents:boundedInteger(process.env.AI_MAX_RUN_COST_CENTS,100,50000,'AI_MAX_RUN_COST_CENTS'),action:async signal=>{signal.throwIfAborted();const result=await learningGateway.execute(request);signal.throwIfAborted();return result;},onWarning:()=>emitOperationalEvent({event:'budget_threshold',entryPoint:'http'})})}:learningGateway;
const embeddingProvider=createAzureEmbeddingProvider(process.env,{onUsage:sourceUsage.record,admit:async(tenant,action)=>operationalSecret?withOperationalAdmission({store:operationsStore,key:opaqueOperationalKey(operationalSecret,'embeddings',JSON.stringify([tenant.organizationId,randomUUID()])),estimateCents:boundedInteger(process.env.EMBEDDING_MAX_RUN_COST_CENTS,10,50000,'EMBEDDING_MAX_RUN_COST_CENTS'),action:async signal=>{signal.throwIfAborted();const result=await action();signal.throwIfAborted();return result;}}):action()});
if(embeddingProvider)await assertHybridRetrievalAvailable(pool);
const knowledgeStore = createPostgresKnowledgeStore(pool,embeddingProvider);
const draftService = createSourceGroundedDraftService({
  knowledge: knowledgeStore,
  gateway: aiGateway,
  aiRuns: createPostgresAiRunStore(pool,{costRates:readAiCostRates(process.env.AI_COST_RATES_JSON)}),
  draftStore: courseReviewStore,
  promptVersion: process.env.AI_PROMPT_VERSION?.trim() || (stagedLearning ? 'staged-learning.v1' : 'course-draft.v2'),
  defaultTokenBudget: stagedLearning ? technicalLimits.maxAiTokensPerRun : undefined
});
const openMontageSceneService = createOpenMontageSceneService(pool, storage, { baseInstructions: readImageGenerationBaseInstructions() });
const openMontageGenerationService = createOpenMontageGenerationService({ jobs: createPostgresJobStore(pool), storage, scenes: openMontageSceneService });
const webhookKeys=readWebhookKeys(process.env.WEBHOOK_KEYS_JSON);
const server = createJobStatusHttpServer({
  machineIntegrationApi:createMachineIntegrationHttp({store:createMachineIntegrationStore(pool),reports:createTechnicalReportingStore(pool),exports:createProtectedExportStore(pool,storage),webhooks:createCustomerWebhookStore(pool),webhookKeyIds:new Set(webhookKeys.keys()),webhookSigningSecret:(tenant,id,key)=>{const master=webhookKeys.get(key);if(!master)throw Error('WEBHOOK_KEY_UNAVAILABLE');return deriveWebhookSecret(master,tenant.organizationId,id);}}),
  lifecycleApi:createLifecycleHttp({retentionResources:createRetentionResourceStore(pool,storage),metering:createTechnicalMeteringStore(pool),governance:createLifecycleGovernanceStore(pool),discovery:createDiscoveryInquiryStore(pool),reports:createTechnicalReportingStore(pool),exports:createProtectedExportStore(pool,storage),webhooks:createCustomerWebhookStore(pool),notifications:createLifecycleNotificationStore(pool),retention:createRetentionGovernanceStore(pool,storage),webhookKeyIds:new Set(webhookKeys.keys()),webhookSigningSecret:(tenant,id,key)=>{const master=webhookKeys.get(key);if(!master)throw Error('WEBHOOK_KEY_UNAVAILABLE');return deriveWebhookSecret(master,tenant.organizationId,id);}}),
  authenticatedAdmission:operationalSecret?principal=>operationsStore.takeRate(opaqueOperationalKey(operationalSecret,'http:identity',JSON.stringify([principal.issuer,principal.identityTenant,principal.subject])),120):undefined,
  lessonRenders:createLessonRenderService({store:createLessonRenderStore(pool),jobs:store,storage}),
  emailVerificationService:process.env.EMAIL_VERIFICATION_ENABLED==='true'?createEmailVerificationService({store:createEmailVerificationStore(pool),secret:required('EMAIL_VERIFICATION_SECRET'),sender:createAzureVerificationEmailSender({endpoint:required('EMAIL_VERIFICATION_ENDPOINT'),senderAddress:required('EMAIL_VERIFICATION_SENDER'),credential:new DefaultAzureCredential()})}):undefined,
  publicCourseCatalogService:createPublicCourseCatalogService(pool),
  candidateLearningAccessStore:createCandidateLearningAccessStore(pool),
  personalWalletStore:createPersonalWalletStore(pool),
  candidateEnrollmentStore:createCandidateEnrollmentStore(pool),
  courseOfferingStore: createCourseOfferingStore(pool),
  browserAuthConfig: readBrowserAuthConfig(process.env),
  statusService,
  organizationContextResolver,
  authenticator: createEntraRequestAuthenticator({
    tenantId: required("ENTRA_TENANT_ID"),
    audience: required("ENTRA_AUDIENCE"),
    openIdConfigurationUrl: required("ENTRA_OPENID_CONFIGURATION_URL"),
    issuer: process.env.ENTRA_ISSUER?.trim() || undefined,
    organizationClaim: process.env.ENTRA_ORGANIZATION_CLAIM?.trim() || "organization_id",
    rolesClaim: process.env.ENTRA_ROLES_CLAIM?.trim() || "roles"
  }),
  allowedOrigins: csv(process.env.ALLOWED_ORIGINS),
  maxBodyBytes: Number(process.env.API_MAX_BODY_BYTES ?? 8 * 1024),
  uploadSessionService,
  draftService,
  knowledgeStore,
  courseReviewStore,
  modelAssetService,
  mediaAssetService:createMediaAssetService(pool,storage,true),
  mediaReviewService:createMediaReviewService(pool,storage),
  reconstructionService:process.env.RECONSTRUCTION_MODES?.trim()?createReconstructionService(pool,storage,readReconstructionModes(process.env.RECONSTRUCTION_MODES)):undefined,
  modelImportService:createModelImportService(pool,storage),
  modelSessionService,
  assessmentSessionService: createPostgresAssessmentSessionService(pool),
  enrollmentService: createPostgresEnrollmentService(pool),
  courseStoryStore: createCourseStoryStore(pool),
  attemptReviewService: createAttemptReviewService(pool),
  notificationService:createNotificationService(pool),
  courseChangeService:createCourseChangeService(pool),
  personalAccountStore:createPersonalAccountStore(pool),
  organizationProfileStore:createOrganizationProfileStore(pool),
  memberService:createMemberService(pool),
  invitationService:createInvitationService(pool,readInvitationConfiguration(process.env)),
  attemptInvalidationService: createAttemptInvalidationService(pool),
  openMontageSceneService,
  openMontageGenerationService,
  learnerSimulationService: createLearnerSimulationService(pool,modelSessionService),
  credentialService: createPostgresCredentialService(pool),
  publicVerificationService:createPublicVerificationService(pool,{perAddress:Number(process.env.VERIFICATION_PER_ADDRESS_PER_MINUTE??60),perCredential:Number(process.env.VERIFICATION_PER_CREDENTIAL_PER_MINUTE??30)}),
  staticRoot: process.env.WEB_ROOT?.trim() || resolve(fileURLToPath(new URL("../../web/dist/", import.meta.url)))
});

const port = Number(process.env.PORT ?? 8080);
const operationalHttp=operationalSecret?installOperationalHttp(server,{store:operationsStore,pool,secret:operationalSecret,dependencyProbe:()=>storage.ensureContainers(),maxBodyBytes:65536,timeoutMs:30000}):undefined;
server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "api_started", port }));
});

const shutdown = async (signal: string) => {
  if(operationalHttp)await operationalHttp.close();else await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  await Promise.all([pool.end(),meteringPool.end()]);
  console.log(JSON.stringify({ event: "api_stopped", signal }));
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
