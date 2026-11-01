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
import { createAzureOpenAiGateway, createDeterministicAiGateway, createSourceGroundedDraftService } from "@medical-device/ai-gateway";
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

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`API_CONFIGURATION_MISSING:${name}`);
  return value;
}

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

const postgresHost = process.env.POSTGRES_HOST?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim() ?? (postgresHost
  ? `postgresql://${encodeURIComponent(process.env.POSTGRES_RUNTIME_LOGIN?.trim() || "medical_device_runtime")}:${encodeURIComponent(required("POSTGRES_RUNTIME_PASSWORD"))}@${postgresHost}:5432/${process.env.POSTGRES_DATABASE?.trim() || "medical_device"}?sslmode=require`
  : required("DATABASE_URL"));
const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.API_DB_POOL_MAX ?? 5) });
const store = createPostgresJobStore(pool);
const organizationContextResolver = createPostgresOrganizationMembershipStore(pool);
const statusService = createJobStatusService(store);
const storageConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
const storageAccountUrl = process.env.STORAGE_ACCOUNT_URL?.trim();
const storage = createAzureBlobStorage({
  ...(storageConnectionString ? { connectionString: storageConnectionString } : { accountUrl: required("STORAGE_ACCOUNT_URL"), credential: new DefaultAzureCredential() }),
  containerName: process.env.STORAGE_CONTAINER_NAME?.trim() || "source-assets",
  maxReadBytes: Number(process.env.STORAGE_MAX_READ_BYTES ?? 128 * 1024 * 1024),
  allowHttp: Boolean(storageConnectionString && process.env.APP_ENV !== "production")
});
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
const aiGateway = aiMode === "azure-openai"
  ? createAzureOpenAiGateway({
    endpoint: required("AZURE_OPENAI_ENDPOINT"),
    apiKey: required("AZURE_OPENAI_API_KEY"),
    deployment: required("AZURE_OPENAI_DEPLOYMENT"),
    model: process.env.AZURE_OPENAI_MODEL?.trim() || "gpt-4o-mini",
    apiVersion: process.env.AZURE_OPENAI_API_VERSION?.trim() || "2024-10-21"
  })
  : createDeterministicAiGateway();
const knowledgeStore = createPostgresKnowledgeStore(pool);
const draftService = createSourceGroundedDraftService({
  knowledge: knowledgeStore,
  gateway: aiGateway,
  aiRuns: createPostgresAiRunStore(pool),
  draftStore: courseReviewStore,
  promptVersion: process.env.AI_PROMPT_VERSION?.trim() || "course-draft.v1"
});
const server = createJobStatusHttpServer({
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
  learnerSimulationService: createLearnerSimulationService(pool,modelSessionService),
  credentialService: createPostgresCredentialService(pool),
  publicVerificationService:createPublicVerificationService(pool,{perAddress:Number(process.env.VERIFICATION_PER_ADDRESS_PER_MINUTE??60),perCredential:Number(process.env.VERIFICATION_PER_CREDENTIAL_PER_MINUTE??30)}),
  staticRoot: process.env.WEB_ROOT?.trim() || resolve(fileURLToPath(new URL("../../web/dist/", import.meta.url)))
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "api_started", port }));
});

const shutdown = async (signal: string) => {
  server.close();
  await pool.end();
  console.log(JSON.stringify({ event: "api_stopped", signal }));
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
