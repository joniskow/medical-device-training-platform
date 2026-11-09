import type {createMediaReviewService} from './media-review-service.js';
import type {createEmailVerificationService} from './email-verification-service.js';
import type { LessonRenderService } from './lesson-render-service.js';
import type {createLifecycleHttp} from './lifecycle-http.js';
import type {createMachineIntegrationHttp} from './machine-integration-http.js';
import { learnerOpenApi } from '@medical-device/contracts';
import type {createReconstructionService} from './reconstruction-service.js';
import type {MediaAssetService} from './media-asset-service.js';
import type {createModelImportService} from './model-import-service.js';
import type {createCourseStoryStore} from '@medical-device/db';
import type {createPersonalWalletStore} from '@medical-device/db';
import type {createCandidateLearningAccessStore} from '@medical-device/db';
import type {createCandidateEnrollmentStore} from '@medical-device/db';
import type {createPublicCourseCatalogService} from './public-course-catalog.js';
import type {createCourseOfferingStore,CourseOfferingInput} from '@medical-device/db';
import type { BrowserAuthConfig } from './browser-auth-config.js';
import type {createPersonalAccountStore} from '@medical-device/db';
import type {createOrganizationProfileStore} from '@medical-device/db';
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { JobStatusResponse } from "./job-status-service.js";
import type { CourseReviewStorePort, KnowledgeStorePort, OperatorRetryRequest, ReviewDecision, ReviewTargetType, TenantContext } from "@medical-device/contracts";
import type { UploadSessionInput, UploadSessionService } from "./upload-session-service.js";
import type { ModelAssetService } from "./model-asset-service.js";
import type { ModelSessionService, ModelSessionStartRequest } from "./model-session-service.js";
import type { AssessmentSessionService } from "./assessment-session-service.js";
import type { EnrollmentService } from "./enrollment-service.js";
import type { LearnerSimulationService } from "./learner-simulation-service.js";
import type { CredentialService } from "./credential-service.js";
import type { PublicVerificationService } from "./public-verification-service.js";
import type { createAttemptReviewService } from './attempt-review.js';
import type { createNotificationService } from './notification-service.js';
import type { createMemberService } from './member-service.js';
import type { createInvitationService } from './invitation-service.js';
import type { createCourseChangeService } from './course-change-service.js';
import type { createAttemptInvalidationService } from './attempt-invalidation.js';
import type { OpenMontageSceneService } from './openmontage-scene-service.js';
import type { OpenMontageGenerationService } from '@medical-device/contracts';

export interface SourceGroundedDraftService {
  generate(tenant: TenantContext, request: { sourceArtifactIds: string[]; mediaAssetVersionIds?: string[]; userInstruction?: string; outputSchemaVersion?: string; tokenBudget?: number; videoLesson?: boolean }): Promise<unknown>;
}

export interface AuthenticatedPrincipal {
  subject: string;
  issuer?:string;
  identityTenant?:string;
  /** Only populated after signed identity claims explicitly attest email verification. */
  verifiedEmail?: string;
  verificationExpiresAt?:string;
  authenticationExpiresAt?:string;
  machineIdentity?:{clientId:string;servicePrincipalId:string;applicationRoles:readonly string[];issuedAt:string};
  /** Optional legacy claim. Tenant scope is resolved from server-side membership data. */
  organizationId?: string;
  roles: readonly string[];
}

export interface OrganizationContextResolver {
  createOrganization?(subject:string,name:string,key:string,correlationId:string):Promise<{organizationId:string;name:string}>;
  listOrganizationContexts?(subject:string):Promise<readonly {organizationId:string;name?:string}[]>;
  resolveActiveOrganizations(subject: string): Promise<readonly string[]>;
  resolveOrganizationRoles?(subject:string,organizationId:string):Promise<readonly string[]>;
  selectOrganization?(subject:string,organizationId:string,key:string,correlationId:string):Promise<void>;
}

export interface RequestAuthenticator {
  authenticate(request: IncomingMessage): Promise<AuthenticatedPrincipal | null>;
}

export interface JobStatusService {
  get(tenant: TenantContext, jobId: string): Promise<JobStatusResponse | null>;
  retry(tenant: TenantContext, jobId: string, request: OperatorRetryRequest): Promise<JobStatusResponse | null>;
}

export interface JobStatusHttpOptions {
  emailVerificationService?:ReturnType<typeof createEmailVerificationService>;
  lessonRenders?:LessonRenderService;
  lifecycleApi?:ReturnType<typeof createLifecycleHttp>;
  machineIntegrationApi?:ReturnType<typeof createMachineIntegrationHttp>;
  authenticatedAdmission?:(principal:AuthenticatedPrincipal)=>Promise<boolean>;
  mediaReviewService?:ReturnType<typeof createMediaReviewService>;
  reconstructionService?:ReturnType<typeof createReconstructionService>;
  modelImportService?:ReturnType<typeof createModelImportService>;
  browserAuthConfig?: BrowserAuthConfig;
  statusService: JobStatusService;
  authenticator: RequestAuthenticator;
  organizationContextResolver: OrganizationContextResolver;
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
  uploadSessionService?: UploadSessionService;
  draftService?: SourceGroundedDraftService;
  knowledgeStore?: KnowledgeStorePort;
  courseReviewStore?: CourseReviewStorePort;
  modelAssetService?: ModelAssetService;
  mediaAssetService?: MediaAssetService;
  modelSessionService?: ModelSessionService;
  assessmentSessionService?: AssessmentSessionService;
  enrollmentService?: EnrollmentService;
  courseStoryStore?: ReturnType<typeof createCourseStoryStore>;
  learnerSimulationService?: LearnerSimulationService;
  credentialService?: CredentialService;
  publicVerificationService?: PublicVerificationService;
  attemptReviewService?: ReturnType<typeof createAttemptReviewService>;
  notificationService?: ReturnType<typeof createNotificationService>;
  courseChangeService?: ReturnType<typeof createCourseChangeService>;
  publicCourseCatalogService?:ReturnType<typeof createPublicCourseCatalogService>;
  personalWalletStore?:ReturnType<typeof createPersonalWalletStore>;
  candidateLearningAccessStore?:ReturnType<typeof createCandidateLearningAccessStore>;
  candidateEnrollmentStore?:ReturnType<typeof createCandidateEnrollmentStore>;
  courseOfferingStore?:ReturnType<typeof createCourseOfferingStore>;
  personalAccountStore?:ReturnType<typeof createPersonalAccountStore>;
  organizationProfileStore?:ReturnType<typeof createOrganizationProfileStore>;
  memberService?:ReturnType<typeof createMemberService>;
  invitationService?:ReturnType<typeof createInvitationService>;
  attemptInvalidationService?: ReturnType<typeof createAttemptInvalidationService>;
  openMontageSceneService?: OpenMontageSceneService;
  openMontageGenerationService?: OpenMontageGenerationService & { preview(tenant: TenantContext, generationId: string): Promise<{ bytes: Uint8Array; contentType: string } | null> };
  staticRoot?: string;
}

const jobIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const defaultMaxBodyBytes = 8 * 1024;

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown, origin?: string, cacheControl?: string) {
  response.statusCode = statusCode;
  if (statusCode === 204) {
    setSecurityHeaders(response);
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    response.end();
    return;
  }
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  setSecurityHeaders(response);
  if (cacheControl) response.setHeader("Cache-Control", cacheControl);
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.end(JSON.stringify(body));
}

function writeHtml(response: ServerResponse, statusCode: number, body: string) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  setSecurityHeaders(response);
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: https://*.blob.core.windows.net; media-src 'self' blob: https://*.blob.core.windows.net; connect-src 'self' https://login.microsoftonline.com https://*.blob.core.windows.net; frame-ancestors 'none'");
  response.end(body);
}

const staticFiles: Record<string, { file: string; contentType: string; binary?: boolean }> = {
  '/admin': {file:'admin.html',contentType:'text/html; charset=utf-8'},
  '/admin.js': {file:'admin.js',contentType:'text/javascript; charset=utf-8'},
  '/admin-viewer.js': {file:'admin-viewer.js',contentType:'text/javascript; charset=utf-8'},
  '/admin.css': {file:'admin.css',contentType:'text/css; charset=utf-8'},
  '/developer/api': { file: 'api-docs.html', contentType: 'text/html; charset=utf-8' },
  '/developer/api-docs.js': { file: 'api-docs.js', contentType: 'text/javascript; charset=utf-8' },
  '/developer/training-viewer.js': { file: 'training-viewer.js', contentType: 'text/javascript; charset=utf-8' },
  '/developer/starter': { file: 'developer-starter.html', contentType: 'text/html; charset=utf-8' },
  '/developer/developer-starter.js': { file: 'developer-starter.js', contentType: 'text/javascript; charset=utf-8' },
  '/developer/training-viewer.d.ts': { file: 'training-viewer.d.ts', contentType: 'text/plain; charset=utf-8' },
  '/developer/client.tgz': {file:'medical-device-api-client-0.1.0.tgz',contentType:'application/gzip',binary:true},
  '/developer/guide': {file:'developer-integration.md',contentType:'text/plain; charset=utf-8'},
  '/developer/starter-source': {file:'developer-starter.ts',contentType:'text/plain; charset=utf-8'},
  '/developer/nxstage-review.json': {file:'nxstage-familiarization.review.json',contentType:'application/json; charset=utf-8'},
  '/author/candidate-workbench.js': {file:'candidate-workbench.js',contentType:'text/javascript; charset=utf-8'},
  '/author/author-model-runtime.js': {file:'author-model-runtime.js',contentType:'text/javascript; charset=utf-8'},
  '/learner/author-model-runtime.js': {file:'author-model-runtime.js',contentType:'text/javascript; charset=utf-8'},
  '/author/managed-auth.js': {file:'managed-auth.js',contentType:'text/javascript; charset=utf-8'},
  '/learner/managed-auth.js': {file:'managed-auth.js',contentType:'text/javascript; charset=utf-8'},
  '/wallet': {file:'wallet.html',contentType:'text/html; charset=utf-8'},
  '/wallet.js': {file:'wallet.js',contentType:'text/javascript; charset=utf-8'},
  '/candidate-training': {file:'candidate-training.html',contentType:'text/html; charset=utf-8'},
  '/candidate-training.js': {file:'candidate-training.js',contentType:'text/javascript; charset=utf-8'},
  '/catalog': {file:'catalog.html',contentType:'text/html; charset=utf-8'},
  '/catalog.js': {file:'catalog.js',contentType:'text/javascript; charset=utf-8'},
  '/signin': {file:'signin.html',contentType:'text/html; charset=utf-8'},
  '/signout': {file:'signin.html',contentType:'text/html; charset=utf-8'},
  '/author/signin.js': {file:'signin.js',contentType:'text/javascript; charset=utf-8'},
  '/auth/redirect': {file:'auth-redirect.html',contentType:'text/html; charset=utf-8'},
  '/auth/redirect.js': {file:'auth-redirect.js',contentType:'text/javascript; charset=utf-8'},
  "/author/members": {file:"members.html",contentType:"text/html; charset=utf-8"},
  "/author/members.js": {file:"members.js",contentType:"text/javascript; charset=utf-8"},
  "/author/course-availability": {file:"course-availability.html",contentType:"text/html; charset=utf-8"},
  "/author/course-availability.js": {file:"course-availability.js",contentType:"text/javascript; charset=utf-8"},
  "/author/organization-settings": {file:"organization-settings.html",contentType:"text/html; charset=utf-8"},
  "/author/organization-settings.js": {file:"organization-settings.js",contentType:"text/javascript; charset=utf-8"},
  "/account": {file:"account.html",contentType:"text/html; charset=utf-8"},
  "/author/account.js": {file:"account.js",contentType:"text/javascript; charset=utf-8"},
  "/organizations": {file:"organizations.html",contentType:"text/html; charset=utf-8"},
  "/invitations": {file:"invitation.html",contentType:"text/html; charset=utf-8"},
  "/author/invitations": {file:"invitation-admin.html",contentType:"text/html; charset=utf-8"},
  "/author/invitation-admin.js": {file:"invitation-admin.js",contentType:"text/javascript; charset=utf-8"},
  "/author/invitation.js": {file:"invitation.js",contentType:"text/javascript; charset=utf-8"},
  "/author/organizations.js": {file:"organizations.js",contentType:"text/javascript; charset=utf-8"},
  "/verify": {file:"verify.html",contentType:"text/html; charset=utf-8"},
  "/verify.js": {file:"verify.js",contentType:"text/javascript; charset=utf-8"},
  "/author/jobs": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/demo": { file: "demo.html", contentType: "text/html; charset=utf-8" },
  "/demo.css": { file: "demo.css", contentType: "text/css; charset=utf-8" },
  "/demo.js": { file: "demo.js", contentType: "text/javascript; charset=utf-8" },
  "/model-manifest.json": { file: "model-manifest.json", contentType: "application/json; charset=utf-8" },
  "/model/aurora-infusion-controller.glb": { file: "model/aurora-infusion-controller.glb", contentType: "model/gltf-binary", binary: true },
  "/model/aurora-training-manifest.json": { file: "model/aurora-training-manifest.json", contentType: "application/json; charset=utf-8" },
  "/model/aurora-training-scene-manifest.json": { file: "model/aurora-training-scene-manifest.json", contentType: "application/json; charset=utf-8" },
  "/model/aurora-training.glb": { file: "model/aurora-training.glb", contentType: "model/gltf-binary", binary: true },
  "/model/nxstage-system-one.glb": { file: "model/nxstage-system-one.glb", contentType: "model/gltf-binary", binary: true },
  "/model/nxstage-system-one-manifest.json": { file: "model/nxstage-system-one-manifest.json", contentType: "application/json; charset=utf-8" },
  "/model/nxstage-training-scene-manifest.json": { file: "model/nxstage-training-scene-manifest.json", contentType: "application/json; charset=utf-8" },
  "/model/nxstage-review-scene.json": { file: "model/nxstage-review-scene.json", contentType: "application/json; charset=utf-8" },
  "/model/nxstage-cinematic-source.glb": { file: "model/nxstage-cinematic-source.glb", contentType: "model/gltf-binary", binary: true },
  "/model/nxstage-cinematic-source-manifest.json": { file: "model/nxstage-cinematic-source-manifest.json", contentType: "application/json; charset=utf-8" },
  "/model/nxstage-cinematic-scene-manifest.json": { file: "model/nxstage-cinematic-scene-manifest.json", contentType: "application/json; charset=utf-8" },
  "/demo-assets/aic-priming-demo.mp4": { file: "demo-assets/aic-priming-demo.mp4", contentType: "video/mp4", binary: true },
  "/demo-assets/nxstage-office-background-openmontage.mp4": { file: "demo-assets/nxstage-office-background-openmontage.mp4", contentType: "video/mp4", binary: true },
  "/demo-assets/nxstage-office-background-photo-openmontage.mp4": { file: "demo-assets/nxstage-office-background-photo-openmontage.mp4", contentType: "video/mp4", binary: true },
  "/demo-assets/nxstage-hallway-to-room-background-openmontage.mp4": { file: "demo-assets/nxstage-hallway-to-room-background-openmontage.mp4", contentType: "video/mp4", binary: true },
  "/demo-assets/nxstage-hallway-to-room-composite.mp4": { file: "demo-assets/nxstage-hallway-to-room-composite.mp4", contentType: "video/mp4", binary: true },
  "/demo-assets/nxstage-clinical-photo-v2.png": { file: "demo-assets/nxstage-clinical-photo-v2.png", contentType: "image/png", binary: true },
  "/demo-assets/nxstage-clinical-photo-v4.png": { file: "demo-assets/nxstage-clinical-photo-v4.png", contentType: "image/png", binary: true },
  "/demo-assets/nxstage-photo-video-composite-review.png": { file: "demo-assets/nxstage-photo-video-composite-review.png", contentType: "image/png", binary: true },
  "/demo-assets/nxstage-system-one-preview.png": { file: "demo-assets/nxstage-system-one-preview.png", contentType: "image/png", binary: true },
  ...Object.fromEntries(Array.from({ length: 8 }, (_, index) => { const id = String(index).padStart(3, "0"); return [`/demo-assets/view-${id}.png`, { file: `demo-assets/view-${id}.png`, contentType: "image/png", binary: true }]; })),
  "/author/assignments": { file: "assignments.html", contentType: "text/html; charset=utf-8" },
  "/author/assignments.js": { file: "assignments.js", contentType: "text/javascript; charset=utf-8" },
  "/author/auth-session.js": { file: "auth-session.js", contentType: "text/javascript; charset=utf-8" },
  "/learner/auth-session.js": { file: "auth-session.js", contentType: "text/javascript; charset=utf-8" },
  "/learner/courses": { file: "learner.html", contentType: "text/html; charset=utf-8" },
  "/learner/learner.js": { file: "learner.js", contentType: "text/javascript; charset=utf-8" },
  "/author/job-status.js": { file: "job-status.js", contentType: "text/javascript; charset=utf-8" },
  "/learner/model": { file: "model.html", contentType: "text/html; charset=utf-8" },
  "/learner/model-player.js": { file: "model-player.js", contentType: "text/javascript; charset=utf-8" },
  "/learner/model-contract.js": { file: "model-contract.js", contentType: "text/javascript; charset=utf-8" },
  "/learner/model-manifest.json": { file: "model-manifest.json", contentType: "application/json; charset=utf-8" },
  "/learner/model-manifest.mobile.json": { file: "model-manifest.mobile.json", contentType: "application/json; charset=utf-8" },
  "/learner/model-manifest.reduced.json": { file: "model-manifest.reduced.json", contentType: "application/json; charset=utf-8" },
  "/learner/nxstage-review-manifest.json": { file: "model/nxstage-review-manifest.json", contentType: "application/json; charset=utf-8" },
  "/learner/model/nxstage-review.glb": { file: "model/nxstage-review.glb", contentType: "model/gltf-binary", binary: true },
  "/learner/model/optimization-report.json": { file: "model/optimization-report.json", contentType: "application/json; charset=utf-8" },
  "/learner/model/aurora-infusion-controller.mobile.glb": { file: "model/aurora-infusion-controller.mobile.glb", contentType: "model/gltf-binary", binary: true },
  "/learner/model/aurora-infusion-controller.reduced.glb": { file: "model/aurora-infusion-controller.reduced.glb", contentType: "model/gltf-binary", binary: true },
  "/learner/model/aurora-infusion-controller.glb": { file: "model/aurora-infusion-controller.glb", contentType: "model/gltf-binary", binary: true }
};

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

function correlationId(request: IncomingMessage): string {
  const candidate = request.headers["x-correlation-id"];
  if (typeof candidate === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)) return candidate;
  const generated = `corr:${randomUUID()}`;
  request.headers["x-correlation-id"] = generated;
  return generated;
}

function tenantFor(request: IncomingMessage, principal: AuthenticatedPrincipal, organizationId: string): TenantContext {
  return {
    organizationId,
    actorId: principal.subject,
    correlationId: correlationId(request)
  };
}

async function readJsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBodyBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(bytes);
  }
  if (size === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("REQUEST_BODY_INVALID_JSON");
  }
}

function jobIdFromPath(pathname: string, action?: "retry"): string | null {
  const parts = pathname.split("/");
  const expectedLength = action ? 6 : 5;
  if (parts.length !== expectedLength || parts[1] !== "api" || parts[2] !== "v1" || parts[3] !== "jobs") return null;
  if (action && parts[5] !== action) return null;
  let jobId: string;
  try {
    jobId = decodeURIComponent(parts[4]);
  } catch {
    return null;
  }
  return jobIdPattern.test(jobId) ? jobId : null;
}

function isOperator(principal: AuthenticatedPrincipal): boolean {
  return principal.roles.includes("operator");
}

function canUpload(principal: AuthenticatedPrincipal): boolean {
  return principal.roles.some((role) => ["operator", "author", "organization_admin"].includes(role));
}

function canReview(principal: AuthenticatedPrincipal): boolean {
  return principal.roles.some((role) => ["operator", "reviewer", "organization_admin"].includes(role));
}

function canPublish(principal: AuthenticatedPrincipal): boolean {
  return principal.roles.some((role) => ["operator", "publisher", "organization_admin"].includes(role));
}

function pathParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "v1") return null;
  return parts;
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function modelAssetPath(pathname: string): { releaseId: string; modelVersionId: string } | null {
  const parts = pathParts(pathname);
  if (!parts || parts.length !== 6 || parts[2] !== "releases" || parts[4] !== "model-assets") return null;
  const releaseId = decodePathSegment(parts[3]);
  const modelVersionId = decodePathSegment(parts[5]);
  return releaseId && modelVersionId ? { releaseId, modelVersionId } : null;
}

function modelSessionPath(pathname: string, action?: "actions" | "debrief"): string | null {
  const parts = pathParts(pathname);
  if (!parts || parts.length !== (action ? 5 : 4) || parts[2] !== "model-sessions" || (action && parts[4] !== action)) return null;
  return decodePathSegment(parts[3]);
}

function modelSessionStartPath(pathname: string): boolean {
  const parts = pathParts(pathname);
  return Boolean(parts && parts.length === 3 && parts[2] === "model-sessions");
}

function organizationUploadCreatePath(pathname: string): string | null {
  const parts = pathParts(pathname);
  if (!parts || parts.length !== 6 || parts[2] !== "organizations" || parts[4] !== "assets" || parts[5] !== "upload-sessions") return null;
  return decodeURIComponent(parts[3]);
}

function uploadSessionActionPath(pathname: string, action: "complete" | "cancel" | "content"): string | null {
  const parts = pathParts(pathname);
  if (!parts || parts.length !== 5 || parts[2] !== "upload-sessions" || parts[4] !== action) return null;
  return decodeURIComponent(parts[3]);
}

function openMontagePath(pathname: string): { collection: 'briefs' | 'artifacts' | 'scenes' | 'generations'; id?: string; action?: 'approve' | 'video' | 'preview' | 'narration' } | null {
  const parts = pathParts(pathname);
  if (!parts || parts[2] !== 'openmontage') return null;
  if (parts.length === 4 && parts[3] === 'briefs') return { collection: 'briefs' };
  if (parts.length === 4 && parts[3] === 'artifacts') return { collection: 'artifacts' };
  if (parts.length === 5 && parts[3] === 'artifacts') {
    const id = decodePathSegment(parts[4]);
    return id ? { collection: 'artifacts', id } : null;
  }
  if (parts.length === 6 && parts[3] === 'artifacts' && parts[5] === 'approve') {
    const id = decodePathSegment(parts[4]);
    return id ? { collection: 'artifacts', id, action: 'approve' } : null;
  }
  if (parts.length === 5 && parts[3] === 'scenes') {
    const id = decodePathSegment(parts[4]);
    return id ? { collection: 'scenes', id } : null;
  }
  if (parts.length === 4 && parts[3] === 'generations') return { collection: 'generations' };
  if (parts.length === 5 && parts[3] === 'generations') {
    const id = decodePathSegment(parts[4]);
    return id ? { collection: 'generations', id } : null;
  }
  if (parts.length === 6 && parts[3] === 'generations' && parts[5] === 'preview') {
    const id = decodePathSegment(parts[4]);
    return id ? { collection: 'generations', id, action: 'preview' } : null;
  }
  if (parts.length === 6 && parts[3] === 'generations' && parts[5] === 'narration') {
    const id = decodePathSegment(parts[4]);
    return id ? { collection: 'generations', id, action: 'narration' } : null;
  }
  if (parts.length === 6 && parts[3] === 'scenes' && parts[5] === 'video') {
    const id = decodePathSegment(parts[4]);
    return id ? { collection: 'scenes', id, action: 'video' } : null;
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validUploadCreateBody(value: unknown): value is UploadSessionInput {
  return isObject(value)
    && typeof value.sourceType === "string"
    && typeof value.fileName === "string"
    && typeof value.contentType === "string"
    && typeof value.sizeBytes === "number"
    && typeof value.sha256 === "string"
    && (value.productId === undefined || typeof value.productId === "string");
}

function validUploadCompleteBody(value: unknown): value is { blobKey: string; contentType: string; sizeBytes: number; sha256: string } {
  return isObject(value)
    && typeof value.blobKey === "string"
    && typeof value.contentType === "string"
    && typeof value.sizeBytes === "number"
    && typeof value.sha256 === "string";
}

function courseDraftPath(pathname: string): string | null {
  const parts = pathParts(pathname);
  if (!parts || parts.length !== 5 || parts[2] !== "course-versions" || parts[4] !== "generate-draft") return null;
  return decodeURIComponent(parts[3]);
}

function courseReviewPath(pathname: string, action?: "publish" | "revise" | "simulation" | "model-preview" | "model-binding" | "model-replacement" | "history"): string | null {
  const parts = pathParts(pathname);
  if (!parts || parts.length !== (action ? 5 : 4) || parts[2] !== "course-versions") return null;
  if (action && parts[4] !== action) return null;
  return decodeURIComponent(parts[3]);
}

function validDraftBody(value: unknown): value is { sourceArtifactIds: string[]; mediaAssetVersionIds?: string[]; userInstruction?: string; outputSchemaVersion?: string; tokenBudget?: number; videoLesson?: boolean } {
  return isObject(value)
    && Array.isArray(value.sourceArtifactIds)
    && value.sourceArtifactIds.length > 0
    && value.sourceArtifactIds.length <= 32
    && value.sourceArtifactIds.every((item) => typeof item === "string" && item.length > 0 && item.length <= 128)
    && (value.mediaAssetVersionIds === undefined || (Array.isArray(value.mediaAssetVersionIds) && value.mediaAssetVersionIds.length <= 32 && new Set(value.mediaAssetVersionIds).size === value.mediaAssetVersionIds.length && value.mediaAssetVersionIds.every(id=>typeof id === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(id))))
    && (value.userInstruction === undefined || (typeof value.userInstruction === "string" && value.userInstruction.length <= 2_000))
    && (value.outputSchemaVersion === undefined || (typeof value.outputSchemaVersion === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value.outputSchemaVersion)))
    && (value.tokenBudget === undefined || (typeof value.tokenBudget === "number" && Number.isSafeInteger(value.tokenBudget)))
    && (value.videoLesson === undefined || typeof value.videoLesson === "boolean");
}

function validRetryBody(value: unknown): value is { reason: string } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { reason?: unknown }).reason === "string"
    && (value as { reason: string }).reason.trim().length >= 1
    && (value as { reason: string }).reason.trim().length <= 500;
}

function validModelActionBody(value: unknown): boolean {
  if (!isObject(value) || typeof value.clientActionId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value.clientActionId)) return false;
  if (typeof value.releaseBindingId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value.releaseBindingId) || typeof value.modelVersionId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value.modelVersionId) || typeof value.expectedSequence !== "number" || !Number.isSafeInteger(value.expectedSequence) || value.expectedSequence < 1) return false;
  const type = String(value.type);
  if (!['select_component','activate_target','transform_component','reset_component','request_hint','open_component','inspect_component','complete_step','acknowledge_fault','diagnose_fault','resolve_fault'].includes(type)) return false;
  if(Object.keys(value).some(k=>!['clientActionId','releaseBindingId','modelVersionId','expectedSequence','type','componentId','targetId','source','transform','value','stepId'].includes(k)))return false;
  for(const key of ['value','stepId'])if(value[key]!==undefined&&(typeof value[key]!=='string'||!(value[key] as string).trim()||(value[key] as string).length>2000))return false;
  if(value.componentId!==undefined&&(typeof value.componentId!=='string'||!value.componentId.trim()||value.componentId.length>200))return false;
  if(value.targetId!==undefined&&(typeof value.targetId!=='string'||!value.targetId.trim()||value.targetId.length>200))return false;
  if(['select_component','activate_target','transform_component','reset_component'].includes(type)&&value.componentId===undefined)return false;
  if(type==='activate_target'&&value.targetId===undefined)return false;
  if(value.source!==undefined&&!['CANVAS','COMPONENT_LIST','KEYBOARD'].includes(String(value.source)))return false;
  if(type==='select_component'&&value.source===undefined)return false;
  if(type==='reset_component')return value.transform===undefined&&value.value===undefined&&value.stepId===undefined;
  if(value.transform===undefined)return type!=='transform_component';
  if(value.componentId===undefined)return false;
  if (!isObject(value.transform)) return false;
  const transformKeys = Object.keys(value.transform);
  return transformKeys.length > 0
    && transformKeys.every((key) => ["rotationY", "translationX"].includes(key))
    && (value.transform.rotationY === undefined || (typeof value.transform.rotationY === "number" && Number.isFinite(value.transform.rotationY)))
    && (value.transform.translationX === undefined || (typeof value.transform.translationX === "number" && Number.isFinite(value.transform.translationX)));
}

function validModelSessionStartBody(value: unknown): value is ModelSessionStartRequest {
  if (!isObject(value)) return false;
  const required = ["releaseId", "activityId", "simulationDefinitionId", "modelVersionId", "enrollmentId", "attemptId", "policyId"];
  if (!required.every((key) => typeof value[key] === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value[key] as string))) return false;
  return value.expiresInSeconds === undefined || (typeof value.expiresInSeconds === "number" && Number.isSafeInteger(value.expiresInSeconds) && value.expiresInSeconds >= 60 && value.expiresInSeconds <= 86_400);
}

function validReviewBody(value: unknown): value is { targetType: ReviewTargetType; targetId: string; decision: ReviewDecision; rationale: string; revision: number } {
  if (!isObject(value)) return false;
  const targetTypes = ["COURSE", "AI_DRAFT", "SOURCE", "MODEL", "SIMULATION", "ASSESSMENT", "POLICY", "VIDEO_LESSON"];
  const decisions = ["APPROVE", "REJECT", "NEEDS_CHANGES"];
  return targetTypes.includes(String(value.targetType))
    && typeof value.targetId === "string" && jobIdPattern.test(value.targetId)
    && decisions.includes(String(value.decision))
    && typeof value.rationale === "string" && value.rationale.trim().length >= 1 && value.rationale.length <= 4_000
    && typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision > 0;
}

function idempotencyKey(request: IncomingMessage): string | null {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value) ? value : null;
}

async function bodyAndHash(request: IncomingMessage, maxBodyBytes: number): Promise<{ body: unknown; hash: string }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBodyBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(bytes);
  }
  const raw = Buffer.concat(chunks);
  if (raw.length === 0) return { body: {}, hash: createHash("sha256").update(raw).digest("hex") };
  try {
    return { body: JSON.parse(raw.toString("utf8")), hash: createHash("sha256").update(raw).digest("hex") };
  } catch {
    throw new Error("REQUEST_BODY_INVALID_JSON");
  }
}

export function createJobStatusHttpServer(options: JobStatusHttpOptions): Server {
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const maxBodyBytes = options.maxBodyBytes ?? defaultMaxBodyBytes;
  return createServer(async (request, response) => {
    setSecurityHeaders(response);
    response.setHeader("X-Correlation-Id", correlationId(request));
    const origin = typeof request.headers.origin === "string" && allowedOrigins.has(request.headers.origin)
      ? request.headers.origin
      : undefined;
      if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      if (request.headers.origin && !origin) {
        writeJson(response, 403, errorBody("CORS_ORIGIN_DENIED", "Origin is not allowed."));
        return;
      }
      response.statusCode = 204;
      response.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Correlation-Id, Idempotency-Key, X-Organization-Id");
      response.setHeader("Access-Control-Max-Age", "600");
      response.end();
      return;
    }

    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === 'GET' && url.pathname === '/' && options.staticRoot) {
        // MSAL's redirect bridge can return to the application homepage.
        response.writeHead(302, {Location: '/signin'});
        response.end();
        return;
      }
      if (url.pathname === '/api/v1/openapi.json') {
        if (request.method !== 'GET') { writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use GET.'), origin); return; }
        writeJson(response, 200, learnerOpenApi, origin); return;
      }
      if(url.pathname==='/api/v1/catalog'||url.pathname.startsWith('/api/v1/catalog/')){
        if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET to browse courses.'),origin);return;}
        if(request.headers.origin&&!origin){writeJson(response,403,errorBody('CORS_ORIGIN_DENIED','Origin is not allowed.'));return;}
        if(!options.publicCourseCatalogService){writeJson(response,503,errorBody('CATALOG_UNAVAILABLE','Course browsing is unavailable.'),origin);return;}
        try{
          const publicId=url.pathname==='/api/v1/catalog'?undefined:url.pathname.slice('/api/v1/catalog/'.length);
          if([...url.searchParams.keys()].some(key=>key!=='after')||url.searchParams.getAll('after').length>1||(publicId!==undefined&&url.searchParams.has('after')))throw Error('CATALOG_CURSOR_INVALID');
          const result=await options.publicCourseCatalogService.read(request.socket.remoteAddress??'unknown',publicId,url.searchParams.get('after')??undefined);
          writeJson(response,result?200:404,result??errorBody('COURSE_UNAVAILABLE','This course is not available.'),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='CATALOG_RATE_LIMITED'?429:code==='CATALOG_CURSOR_INVALID'?422:503;if(status===429)response.setHeader('Retry-After','60');writeJson(response,status,errorBody(status===503?'CATALOG_UNAVAILABLE':code,'Course browsing could not be completed. Please try again.'),origin);}return;
      }
      if (url.pathname === '/api/v1/auth/config') {
        if (request.method !== 'GET') {
          writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use GET for browser authentication configuration.'), origin);
        } else if (!options.browserAuthConfig) {
          writeJson(response, 503, errorBody('BROWSER_AUTH_UNAVAILABLE', 'Browser sign-in is not configured.'), origin);
        } else {
          const {clientId, tenantId, authority, apiScope, applicationOrigin, knownAuthorities} = options.browserAuthConfig;
          writeJson(response, 200, {clientId, tenantId, authority, apiScope, applicationOrigin, knownAuthorities}, origin);
        }
        return;
      }
      if(url.pathname.startsWith('/api/v1/verify/')){
        if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET to verify a credential.'),origin);return;}
        if(request.headers.origin&&!origin){writeJson(response,403,errorBody('CORS_ORIGIN_DENIED','Origin is not allowed.'));return;}
        if(!options.publicVerificationService){writeJson(response,503,errorBody('VERIFICATION_UNAVAILABLE','Verification is unavailable.'),origin);return;}
        try{
          const result=await options.publicVerificationService.verify(url.pathname.slice('/api/v1/verify/'.length),request.socket.remoteAddress??'unknown');
          writeJson(response,result?200:404,result??errorBody('VERIFICATION_NOT_FOUND','This verification record is not available.'),origin);
        }catch(error){const limited=error instanceof Error&&error.message==='VERIFICATION_RATE_LIMITED';if(limited)response.setHeader('Retry-After','60');writeJson(response,limited?429:503,errorBody(limited?'VERIFICATION_RATE_LIMITED':'VERIFICATION_UNAVAILABLE',limited?'Too many verification requests. Please try again later.':'Verification is temporarily unavailable.'),origin);}
        return;
      }
      if (request.method === "GET" && options.staticRoot && staticFiles[url.pathname]) {
        const staticFile = staticFiles[url.pathname];
        try {
          const acceptsGzip = String(request.headers['accept-encoding'] ?? '').split(',').some(value => {
            const [name, ...parameters] = value.trim().toLowerCase().split(';').map(part => part.trim());
            const quality = parameters.find(part => part.startsWith('q='));
            const q = quality === undefined ? 1 : Number(quality.slice(2));
            return name === 'gzip' && Number.isFinite(q) && q > 0 && q <= 1;
          });
          const filePath = join(options.staticRoot, staticFile.file);
          const compressed = acceptsGzip && staticFile.file.endsWith('.js')
            ? await readFile(`${filePath}.gz`).catch(error => {if(error.code==='ENOENT')return undefined;throw error;}) : undefined;
          const contents = compressed ?? await readFile(filePath);
          response.statusCode = 200;
          response.setHeader("Content-Type", staticFile.contentType);
          response.setHeader('Vary', origin ? 'Origin, Accept-Encoding' : 'Accept-Encoding');
          if (compressed) response.setHeader('Content-Encoding', 'gzip');
          response.setHeader('Content-Length', contents.byteLength);
          setSecurityHeaders(response);
          // Babylon's bundled PBR lighting texture is an embedded data image.
          const embeddedImages = url.pathname === '/admin' || url.pathname === '/learner/model' || url.pathname === '/demo' || url.pathname === '/developer/starter' ? ' data:' : '';
          response.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:${embeddedImages} https://*.blob.core.windows.net; media-src 'self' blob: https://*.blob.core.windows.net; connect-src 'self' https://login.microsoftonline.com https://*.blob.core.windows.net; frame-ancestors 'none'`);
          if (options.browserAuthConfig) {
            const authorityOrigin = new URL(options.browserAuthConfig.authority).origin;
            const trustedOrigins=options.browserAuthConfig.knownAuthorities.map(host=>`https://${host}`).join(' ');
            response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:${embeddedImages} https://*.blob.core.windows.net; media-src 'self' blob: https://*.blob.core.windows.net; connect-src 'self' ${authorityOrigin} ${trustedOrigins} https://*.blob.core.windows.net; frame-src 'self' ${authorityOrigin} ${trustedOrigins}; frame-ancestors ${url.pathname==='/auth/redirect'?"'self'":"'none'"}`);
          }
          if(url.pathname==='/auth/redirect')response.setHeader('X-Frame-Options','SAMEORIGIN');
          response.end(contents);
        } catch {
          writeJson(response, 404, errorBody("NOT_FOUND", "The requested resource was not found."), origin);
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        writeJson(response, 200, { status: "ok" }, origin);
        return;
      }
      const uploadCreateOrganizationId = request.method === "POST" ? organizationUploadCreatePath(url.pathname) : null;
      const uploadCompleteId = request.method === "POST" ? uploadSessionActionPath(url.pathname, "complete") : null;
      const uploadContentId = request.method === "PUT" ? uploadSessionActionPath(url.pathname, "content") : null;
      const openMontageRoute = openMontagePath(url.pathname);
      const uploadCancelId = request.method === "DELETE" ? uploadSessionActionPath(url.pathname, "cancel") : null;
      const draftCourseVersionId = request.method === "POST" ? courseDraftPath(url.pathname) : null;
      const modelPreviewId=courseReviewPath(url.pathname,'model-preview');
      const createSimulationId=courseReviewPath(url.pathname,'simulation');
      const bindModelId=courseReviewPath(url.pathname,'model-binding');
      const replaceModelId=courseReviewPath(url.pathname,'model-replacement');
      const draftHistoryId=courseReviewPath(url.pathname,'history');
      const isApprovedMedia=url.pathname==='/api/v1/approved-media';
      const isApprovedModels=url.pathname==='/api/v1/approved-models';
      const mediaReviewMatch=url.pathname.match(/^\/api\/v1\/media-review(?:\/([^/]+)(?:\/(content|review|frames|rights))?)?$/);
      const reconstructionMatch=url.pathname.match(/^\/api\/v1\/reconstructions(?:\/([^/]+)(?:\/(candidate|quality|foreground|conditioning-image|views))?)?$/);
      const modelImportMatch=url.pathname.match(/^\/api\/v1\/model-imports(?:\/([^/]+)(?:\/(content|review|configuration))?)?$/);
      const reviewCourseVersionId = courseReviewPath(url.pathname);
      const publishCourseVersionId = request.method === "POST" ? courseReviewPath(url.pathname, "publish") : null;
      const reviseCourseVersionId=request.method==='POST'?courseReviewPath(url.pathname,'revise'):null;
      const modelAssetRequest = request.method === "GET" ? modelAssetPath(url.pathname) : null;
      const modelSessionStart = request.method === "POST" && modelSessionStartPath(url.pathname);
      const modelSessionActionId = request.method === "POST" ? modelSessionPath(url.pathname, "actions") : null;
      const modelSessionGetId = request.method === "GET" ? modelSessionPath(url.pathname) : null;
      const modelSessionDebriefId = request.method === "GET" ? modelSessionPath(url.pathname, "debrief") : null;
      const isUploadRoute = uploadCreateOrganizationId !== null || uploadCompleteId !== null || uploadCancelId !== null || uploadContentId !== null;
      const isDraftRoute = draftCourseVersionId !== null;
      const isCourseCollection = url.pathname === "/api/v1/courses";
      const isSourceCollection = url.pathname === "/api/v1/knowledge-sources";
      const assessmentParts = pathParts(url.pathname);
      const isInvitation=assessmentParts?.[2]==='invitations'&&(assessmentParts.length===3||(assessmentParts.length===4&&['accept','preview'].includes(assessmentParts[3]))||(assessmentParts.length===5&&assessmentParts[4]==='revoke'));
      const isMember=assessmentParts?.[2]==='members'&&(assessmentParts.length===3||(assessmentParts.length===5&&['roles','status'].includes(assessmentParts[4])));
      const emailVerificationRoute=/^\/api\/v1\/account\/email-verification\/(start|complete|revoke)$/.exec(url.pathname);
      const lessonRenderRoute=/^\/api\/v1\/lesson-renders(?:\/([A-Za-z0-9._:%-]+)(?:\/(content|cancel|retry))?)?$/.exec(url.pathname);
      const correctedLessonTakeRoute=url.pathname==='/api/v1/lesson-corrected-takes';
      const lifecycleRoute=options.lifecycleApi?.matches(url.pathname)??false;
      const integrationRoute=options.machineIntegrationApi?.matches(url.pathname)??false;
      const isPersonalAccount=url.pathname==='/api/v1/account';
      const isPersonalWallet=url.pathname==='/api/v1/my-credentials';
      const personalSharingMatch=/^\/api\/v1\/my-credentials\/([A-Za-z0-9._:%-]+)\/sharing$/.exec(url.pathname);
      const isCandidateLearningList=url.pathname==='/api/v1/my-candidate-enrollments';
      const isCandidateEnrollment=url.pathname==='/api/v1/candidate-enrollments';
      const courseOfferingMatch=/^\/api\/v1\/releases\/([A-Za-z0-9._:%-]+)\/offering$/.exec(url.pathname);
      const isOrganizationProfile=url.pathname==='/api/v1/organization-profile';
      const isOrganizationContext=assessmentParts?.[2]==='organization-contexts'&&(assessmentParts.length===3||(assessmentParts.length===5&&assessmentParts[4]==='select'));
      const isCourseChangeJob=assessmentParts?.[2]==='course-change-jobs'&&(assessmentParts.length===3||(assessmentParts.length===5&&assessmentParts[4]==='retry'));
      const isCourseChange=assessmentParts?.[2]==='course-changes'&&assessmentParts.length===4;
      const isNotification=assessmentParts?.[2]==='notifications'&&(assessmentParts.length===3||(assessmentParts.length===5&&assessmentParts[4]==='read'));
      const isAttemptInvalidation=assessmentParts?.[2]==='attempts'&&(assessmentParts.length===3||(assessmentParts.length===6&&assessmentParts[5]==='invalidate'));
      const isAttemptReview=assessmentParts?.[2]==='attempt-reviews' && ([3,5].includes(assessmentParts.length)||(assessmentParts.length===6&&assessmentParts[5]==='reset'));
      const isCredentialSharing=assessmentParts?.length===5&&assessmentParts[2]==='credentials'&&assessmentParts[4]==='sharing';
      const isCredentialLifecycle=assessmentParts?.length===5&&assessmentParts[2]==='credentials'&&['revoke','supersede'].includes(assessmentParts[4]);
      const isCredentialCollection=url.pathname==='/api/v1/credentials';
      const isCredentialIssue=assessmentParts?.length===5 && assessmentParts[2]==='enrollments' && assessmentParts[4]==='credential';
      const isLearnerSimulation = assessmentParts?.[2] === "enrollments" && assessmentParts.length===7 && assessmentParts[4]==="activities" && assessmentParts[6]==="start";
      const isContentAcknowledgement=assessmentParts?.[2]==='enrollments' && assessmentParts.length===7 && assessmentParts[4]==='activities' && assessmentParts[6]==='acknowledge';
      const isInspection=assessmentParts?.[2]==='enrollments'&&assessmentParts.length===7&&assessmentParts[4]==='activities'&&assessmentParts[6]==='inspection';
      const isMedia=assessmentParts?.[2]==='enrollments'&&assessmentParts.length===7&&assessmentParts[4]==='activities'&&assessmentParts[6]==='media';
      const isStory=assessmentParts?.[2]==='enrollments'&&assessmentParts[4]==='story'&&(assessmentParts.length===5||(assessmentParts.length===6&&['choices','restart'].includes(assessmentParts[5])));
      const isEnrollmentRoute = assessmentParts?.[2] === "enrollments" && ([3,4].includes(assessmentParts.length) || isLearnerSimulation || isContentAcknowledgement);
      const isAssessmentRoute = assessmentParts?.[2] === "assessment-sessions" && (assessmentParts.length === 3 || assessmentParts.length === 4 || (assessmentParts.length === 5 && assessmentParts[4] === "submit"));
      const sourceParts = pathParts(url.pathname);
      const sourceDetailId = sourceParts?.length === 4 && sourceParts[2] === "knowledge-sources" ? decodeURIComponent(sourceParts[3]) : null;
      const isReviewRoute = reviewCourseVersionId !== null || publishCourseVersionId !== null || reviseCourseVersionId!==null;
      const isModelAssetRoute = modelAssetRequest !== null;
      const isModelSessionRoute = modelSessionStart || modelSessionActionId !== null || modelSessionGetId !== null || modelSessionDebriefId !== null;
      const isGet = request.method === "GET";
      const isRetry = request.method === "POST";
      const jobId = isGet ? jobIdFromPath(url.pathname) : jobIdFromPath(url.pathname, "retry");
      if (!integrationRoute && !lifecycleRoute && !correctedLessonTakeRoute && !lessonRenderRoute && !emailVerificationRoute && !openMontageRoute && !reconstructionMatch && !mediaReviewMatch && !modelImportMatch && !isInspection && !isApprovedMedia && !isMedia && !isStory && !modelPreviewId && !createSimulationId && !bindModelId && !replaceModelId && !draftHistoryId && !isApprovedModels && !personalSharingMatch && !isPersonalWallet && !isCandidateLearningList && !isCandidateEnrollment && !courseOfferingMatch && !isPersonalAccount && !isOrganizationProfile && !isInvitation && !isMember && !isOrganizationContext && !isCourseChangeJob && !isCourseChange && !isNotification && !isAttemptInvalidation && !isAttemptReview && !jobId && !isUploadRoute && !isDraftRoute && !isReviewRoute && !isModelAssetRoute && !isModelSessionRoute && !isCourseCollection && !isSourceCollection && !sourceDetailId && !isAssessmentRoute && !isEnrollmentRoute && !isCredentialCollection && !isCredentialIssue && !isCredentialLifecycle && !isCredentialSharing) {
        writeJson(response, 404, errorBody("NOT_FOUND", "The requested resource was not found."), origin);
        return;
      }
      if (request.headers.origin && !origin) {
        writeJson(response, 403, errorBody("CORS_ORIGIN_DENIED", "Origin is not allowed."));
        return;
      }

      let principal = await options.authenticator.authenticate(request);
      if (!principal) {
        writeJson(response, 401, errorBody("AUTHENTICATION_REQUIRED", "Authentication is required."), origin);
        return;
      }
      if (!principal.subject) {
        writeJson(response, 401, errorBody("AUTHENTICATION_INVALID", "Authentication is invalid."), origin);
        return;
      }

      if(options.authenticatedAdmission){
        try { if(!await options.authenticatedAdmission(principal)){response.setHeader('Retry-After','60');writeJson(response,429,errorBody('RATE_LIMITED','Retry this request later.'),origin);return;} }
        catch {writeJson(response,503,errorBody('ADMISSION_UNAVAILABLE','Request admission is temporarily unavailable.'),origin);return;}
      }
      const signedEmailVerification=principal.verifiedEmail?{email:principal.verifiedEmail,expiresAt:principal.verificationExpiresAt}:undefined;
      if(principal.machineIdentity){
        if(!options.machineIntegrationApi){writeJson(response,403,errorBody('INTEGRATION_SCOPE_DENIED','This integration is unavailable.'),origin);return;}
        await options.machineIntegrationApi.handleMachine({request,url,principal,
          reply:(status,body)=>writeJson(response,status,status>=400&&isObject(body)&&typeof body.error==='string'?errorBody(body.error,'This integration request could not be completed.'):body,origin),
          readBody:async()=>{if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json')throw Error('INTEGRATION_INPUT_INVALID');return readJsonBody(request,Math.max(maxBodyBytes,65536));},idempotencyKey:()=>idempotencyKey(request)});
        return;
      }
      if(options.emailVerificationService){
        try { principal=await options.emailVerificationService.enrich(principal); }
        catch { writeJson(response,503,errorBody('VERIFICATION_UNAVAILABLE','Account verification is temporarily unavailable.'),origin);return; }
      }
      if(options.personalAccountStore&&!isPersonalAccount){
        if(!principal.issuer||!principal.identityTenant){writeJson(response,401,errorBody('ACCOUNT_IDENTITY_REQUIRED','A validated identity is required.'),origin);return;}
        try{await options.personalAccountStore.access({subject:principal.subject,issuer:principal.issuer,identityTenant:principal.identityTenant,verifiedEmail:principal.verifiedEmail},'GET');await options.personalAccountStore.observeVerification({subject:principal.subject,issuer:principal.issuer,identityTenant:principal.identityTenant,verifiedEmail:principal.verifiedEmail},principal.verificationExpiresAt);}
        catch(error){const locked=error instanceof Error&&error.message==='ACCOUNT_LOCKED';writeJson(response,locked?403:503,errorBody(locked?'ACCOUNT_LOCKED':'ACCOUNT_UNAVAILABLE','Your account is unavailable.'),origin);return;}
      }
      const lifecycleContext={request,url,principal,
        reply:(status:number,body:unknown)=>writeJson(response,status,status>=400&&isObject(body)&&typeof body.error==='string'?errorBody(body.error,'This request could not be completed.'):body,origin),
        readBody:async()=>{if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json')throw Error('LIFECYCLE_REQUEST_INVALID');return readJsonBody(request,Math.max(maxBodyBytes,65536));},
        idempotencyKey:()=>idempotencyKey(request),
        sendBytes:(bytes:Uint8Array,contentType:string)=>{setSecurityHeaders(response);response.statusCode=200;response.setHeader('Content-Type',contentType);if(origin)response.setHeader('Access-Control-Allow-Origin',origin);response.end(bytes);}
      };
      if(lifecycleRoute&&await options.lifecycleApi!.handleAccount(lifecycleContext))return;
      if(emailVerificationRoute){
        if(request.method!=='POST'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use POST.'),origin);return;}
        if(!options.emailVerificationService){writeJson(response,503,errorBody('VERIFICATION_UNAVAILABLE','Email verification is unavailable.'),origin);return;}
        if(!principal.issuer||!principal.identityTenant||!principal.authenticationExpiresAt||!Number.isFinite(Date.parse(principal.authenticationExpiresAt))||Date.parse(principal.authenticationExpiresAt)<=Date.now()){writeJson(response,401,errorBody('ACCOUNT_IDENTITY_REQUIRED','A current validated identity is required.'),origin);return;}
        try {
          if(url.search||request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json without query parameters.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes);
          if(!isObject(body))throw Error('VERIFICATION_INPUT_INVALID');
          const identity={subject:principal.subject,issuer:principal.issuer,identityTenant:principal.identityTenant};
          const action=emailVerificationRoute[1];
          if(action==='start'){
            if(typeof body.email!=='string'||Object.keys(body).some(key=>key!=='email'))throw Error('VERIFICATION_INPUT_INVALID');
            writeJson(response,202,await options.emailVerificationService.start(identity,body.email),origin);
          } else if(action==='complete') {
            if(typeof body.challengeId!=='string'||typeof body.code!=='string'||Object.keys(body).some(key=>!['challengeId','code'].includes(key)))throw Error('VERIFICATION_INPUT_INVALID');
            await options.emailVerificationService.complete(identity,{challengeId:body.challengeId,code:body.code});
            const verified=await options.emailVerificationService.enrich(principal);
            if(options.personalAccountStore)await options.personalAccountStore.observeVerification({...identity,verifiedEmail:verified.verifiedEmail},verified.verificationExpiresAt);
            writeJson(response,200,{verified:true,verificationExpiresAt:verified.verificationExpiresAt},origin);
          } else {
            if(body.confirmed!==true||Object.keys(body).some(key=>key!=='confirmed'))throw Error('VERIFICATION_INPUT_INVALID');
            await options.emailVerificationService.revoke(identity);
            if(options.personalAccountStore)await options.personalAccountStore.observeVerification({...identity,verifiedEmail:signedEmailVerification?.email},signedEmailVerification?.expiresAt);
            writeJson(response,200,{verified:Boolean(signedEmailVerification)},origin);
          }
        } catch(error) {
          const code=error instanceof Error?error.message:'';
          const status=code==='VERIFICATION_RATE_LIMITED'?429:code==='VERIFICATION_INPUT_INVALID'||error instanceof SyntaxError?422:code==='VERIFICATION_UNAVAILABLE'?403:503;
          if(status===429)response.setHeader('Retry-After','60');
          writeJson(response,status,errorBody(status===503?'VERIFICATION_UNAVAILABLE':code,'Email verification could not be completed.'),origin);
        }
        return;
      }
      if(personalSharingMatch){
        if(request.method!=='POST'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use POST.'),origin);return;}
        if(!options.personalWalletStore||!options.personalAccountStore||!options.credentialService){writeJson(response,503,errorBody('PERSONAL_WALLET_UNAVAILABLE','Credential sharing is unavailable.'),origin);return;}
        try{
          if(url.search||request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json')throw Error('CREDENTIAL_REQUEST_INVALID');
          const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
          if(!key||!isObject(body)||Object.keys(body).some(k=>!['enabled','revision'].includes(k))||typeof body.enabled!=='boolean'||!Number.isSafeInteger(body.revision)||Number(body.revision)<0)throw Error('CREDENTIAL_REQUEST_INVALID');
          const credentialId=decodeURIComponent(personalSharingMatch[1]),organizationId=await options.personalWalletStore.resolveOwner(principal.subject,credentialId);
          if(!organizationId)throw Error('CREDENTIAL_NOT_FOUND');
          writeJson(response,200,await options.credentialService.setSharing({organizationId,actorId:principal.subject,correlationId:randomUUID()},credentialId,{enabled:body.enabled,revision:Number(body.revision),idempotencyKey:key}),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='CREDENTIAL_NOT_FOUND'?404:['CREDENTIAL_SHARING_CONFLICT','CREDENTIAL_SHARING_NOT_ALLOWED','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:['CREDENTIAL_REQUEST_INVALID','PERSONAL_WALLET_INVALID'].includes(code)||error instanceof SyntaxError||error instanceof URIError?422:500;writeJson(response,status,errorBody(status===500?'PERSONAL_WALLET_FAILED':code,'Credential sharing could not be changed.'),origin);}
        return;
      }
      if(isPersonalWallet){
        if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET.'),origin);return;}
        if(!options.personalWalletStore||!options.personalAccountStore){writeJson(response,503,errorBody('PERSONAL_WALLET_UNAVAILABLE','Your credentials are unavailable.'),origin);return;}
        try{
          if([...url.searchParams.keys()].some(key=>key!=='after')||url.searchParams.getAll('after').length>1)throw Error('PERSONAL_WALLET_INVALID');
          writeJson(response,200,await options.personalWalletStore.list(principal.subject,url.searchParams.get('after')??undefined),origin);
        }catch(error){const invalid=error instanceof Error&&error.message==='PERSONAL_WALLET_INVALID';writeJson(response,invalid?422:500,errorBody(invalid?'PERSONAL_WALLET_INVALID':'PERSONAL_WALLET_FAILED','Your credentials could not be loaded.'),origin);}
        return;
      }
      if(isCandidateLearningList){
        if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET to view your training.'),origin);return;}
        if(!options.candidateLearningAccessStore||!options.personalAccountStore){writeJson(response,503,errorBody('CANDIDATE_ACCESS_UNAVAILABLE','Your training is unavailable.'),origin);return;}
        try{
          if([...url.searchParams.keys()].some(key=>key!=='after')||url.searchParams.getAll('after').length>1)throw Error('CANDIDATE_ACCESS_INVALID');
          writeJson(response,200,await options.candidateLearningAccessStore.list(principal.subject,url.searchParams.get('after')??undefined),origin);
        }catch(error){const invalid=error instanceof Error&&error.message==='CANDIDATE_ACCESS_INVALID';writeJson(response,invalid?422:503,errorBody(invalid?'CANDIDATE_ACCESS_INVALID':'CANDIDATE_ACCESS_UNAVAILABLE','Your training could not be loaded.'),origin);}return;
      }
      if(isCandidateEnrollment){
        if(request.method!=='POST'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use POST to enroll.'),origin);return;}
        if(!options.candidateEnrollmentStore||!options.personalAccountStore){writeJson(response,503,errorBody('CANDIDATE_ENROLLMENT_UNAVAILABLE','Candidate enrollment is unavailable.'),origin);return;}
        if(!principal.verifiedEmail){writeJson(response,403,errorBody('CANDIDATE_VERIFIED_ACCOUNT_REQUIRED','Sign in with a verified personal account before enrolling.'),origin);return;}
        try{
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
          if(!isObject(body)||body.confirmed!==true||!key||Object.keys(body).some(field=>!['publicId','revision','noticeVersion','confirmed'].includes(field)))throw Error('CANDIDATE_ENROLLMENT_INVALID');
          const result=await options.candidateEnrollmentStore.enroll(principal.subject,{publicId:body.publicId as string,revision:body.revision as number,noticeVersion:body.noticeVersion as string,idempotencyKey:key},tenantFor(request,principal,'').correlationId);
          writeJson(response,200,result,origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='CANDIDATE_VERIFIED_ACCOUNT_REQUIRED'?403:code==='CANDIDATE_COURSE_UNAVAILABLE'?404:['CANDIDATE_DISCLOSURES_CHANGED','CANDIDATE_ENROLLMENT_INACTIVE','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='CANDIDATE_ENROLLMENT_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'CANDIDATE_ENROLLMENT_FAILED':code,'Enrollment could not be completed. Refresh the course details before retrying.'),origin);}return;
      }
      if(isPersonalAccount){
        if(!options.personalAccountStore){writeJson(response,503,errorBody('ACCOUNT_UNAVAILABLE','Personal accounts are unavailable.'),origin);return;}
        if(!principal.issuer||!principal.identityTenant){writeJson(response,401,errorBody('ACCOUNT_IDENTITY_REQUIRED','A validated identity is required.'),origin);return;}
        if(!['GET','POST'].includes(request.method??'')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','This method is not supported.'),origin);return;}
        try{
          const identity={subject:principal.subject,issuer:principal.issuer,identityTenant:principal.identityTenant,verifiedEmail:principal.verifiedEmail};
          if(request.method==='GET'){const account=await options.personalAccountStore.access(identity,'GET');await options.personalAccountStore.observeVerification(identity,principal.verificationExpiresAt);writeJson(response,200,{account},origin);return;}
          const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
          if(!isObject(body)||Object.keys(body).some(k=>!['action','displayName','revision','confirmed'].includes(k))||!['create','update'].includes(body.action as string)||typeof body.displayName!=='string'||body.confirmed!==true||!key||(body.action==='create'&&body.revision!==undefined)||(body.action==='update'&&typeof body.revision!=='number'))throw Error('ACCOUNT_REQUEST_INVALID');
          const account=await options.personalAccountStore.access(identity,body.action==='create'?'CREATE':'UPDATE',{displayName:body.displayName,revision:body.revision as number|undefined,idempotencyKey:key});
          if(!account){writeJson(response,404,errorBody('ACCOUNT_NOT_FOUND','Create your personal profile first.'),origin);return;}
          await options.personalAccountStore.observeVerification(identity,principal.verificationExpiresAt);
          writeJson(response,200,{account},origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='ACCOUNT_LOCKED'?403:['ACCOUNT_CHANGED','ACCOUNT_ALREADY_EXISTS','ACCOUNT_IDENTITY_CONFLICT','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='ACCOUNT_REQUEST_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'ACCOUNT_FAILED':code,status===409?'Account state changed. Reload your profile.':'Your account request could not be completed.'),origin);}return;
      }
      if(isInvitation&&assessmentParts!.length===4){
        response.setHeader('Cache-Control','no-store');
        if(request.method!=='POST'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use POST.'),origin);return;}
        if(!options.invitationService){writeJson(response,503,errorBody('INVITATIONS_UNAVAILABLE','Invitations are unavailable.'),origin);return;}
        try{
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes),preview=assessmentParts![3]==='preview';
          if(url.search||!isObject(body)||Object.keys(body).some(key=>!(preview?['organizationId','invitationId','token']:['organizationId','invitationId','token','role','confirmed']).includes(key))||(!preview&&body.confirmed!==true)||typeof body.organizationId!=='string'||!body.organizationId||body.organizationId.length>128||typeof body.invitationId!=='string'||typeof body.token!=='string'||(!preview&&typeof body.role!=='string')||!principal.verifiedEmail)throw Error('INVITATION_UNAVAILABLE');
          const context=tenantFor(request,principal,body.organizationId);
          const result=preview?await options.invitationService.preview(context,principal.verifiedEmail,{invitationId:body.invitationId,token:body.token}):await options.invitationService.accept(context,principal.verifiedEmail,{invitationId:body.invitationId,token:body.token,role:body.role as string});
          writeJson(response,200,result,origin);
        }catch(error){const unavailable=error instanceof SyntaxError||(error instanceof Error&&error.message==='INVITATION_UNAVAILABLE');writeJson(response,unavailable?422:500,errorBody(unavailable?'INVITATION_UNAVAILABLE':'INVITATION_ACCEPTANCE_FAILED','The invitation could not be accepted.'),origin);}return;
      }
      const organizations = await options.organizationContextResolver.resolveActiveOrganizations(principal.subject);
      if(isOrganizationContext){
        const collection=assessmentParts!.length===3;
        if(collection&&request.method==='POST'){
          if(!principal.verifiedEmail){writeJson(response,403,errorBody('VERIFIED_EMAIL_REQUIRED','Verify your email before creating an organization.'),origin);return;}
          if(!options.organizationContextResolver.createOrganization){writeJson(response,503,errorBody('ORGANIZATION_CREATION_UNAVAILABLE','Organization creation is unavailable.'),origin);return;}
          try{
            if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
            const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
            if(!isObject(body)||Object.keys(body).some(field=>field!=='name')||typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>160||!key)throw Error('ORGANIZATION_REQUEST_INVALID');
            const result=await options.organizationContextResolver.createOrganization(principal.subject,body.name,key,tenantFor(request,principal,'').correlationId);
            writeJson(response,200,result,origin);
          }catch(error){const code=error instanceof Error?error.message:'';const status=code==='ORGANIZATION_REQUEST_INVALID'||error instanceof SyntaxError?422:['IDEMPOTENCY_KEY_REUSED','ORGANIZATION_CREATION_UNAVAILABLE'].includes(code)?409:500;writeJson(response,status,errorBody(status===500?'ORGANIZATION_CREATION_FAILED':code,'Organization creation could not be completed.'),origin);}return;
        }
        if(request.method!==(collection?'GET':'POST')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','This method is not supported.'),origin);return;}
        if(collection){const items=options.organizationContextResolver.listOrganizationContexts?await options.organizationContextResolver.listOrganizationContexts(principal.subject):organizations.map(organizationId=>({organizationId}));writeJson(response,200,{items},origin);return;}
        const target=decodeURIComponent(assessmentParts![3]);
        if(!organizations.includes(target)){writeJson(response,403,errorBody('ORGANIZATION_MEMBERSHIP_REQUIRED','An active membership is required.'),origin);return;}
        if(!options.organizationContextResolver.selectOrganization){writeJson(response,503,errorBody('ORGANIZATION_SELECTION_UNAVAILABLE','Organization selection is unavailable.'),origin);return;}
        try{
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
          if(!isObject(body)||Object.keys(body).length||!key)throw Error('ORGANIZATION_SELECTION_INVALID');
          const context=tenantFor(request,principal,target);
          await options.organizationContextResolver.selectOrganization(principal.subject,target,key,context.correlationId);
          writeJson(response,200,{organizationId:target},origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='ORGANIZATION_MEMBERSHIP_REQUIRED'?403:code==='ORGANIZATION_SELECTION_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'ORGANIZATION_SELECTION_FAILED':code,'Organization selection could not be completed.'),origin);}return;
      }
      const selected=request.headers['x-organization-id'];
      const candidateRoute=isInspection||isMedia||isStory||isModelAssetRoute||isModelSessionRoute||isLearnerSimulation||(isEnrollmentRoute&&(request.method==='GET'||isContentAcknowledgement))||isAssessmentRoute||(isCredentialCollection&&request.method==='GET')||(isCredentialIssue&&request.method==='POST')||(isCredentialSharing&&request.method==='POST')||isNotification;
      let candidateAccess=false;
      if(typeof selected==='string'&&!organizations.includes(selected)&&candidateRoute&&options.candidateLearningAccessStore&&options.personalAccountStore){
        candidateAccess=await options.candidateLearningAccessStore.canAccess(principal.subject,selected);
      }
      if(selected!==undefined&&(typeof selected!=='string'||(!organizations.includes(selected)&&!candidateAccess))){writeJson(response,403,errorBody('ORGANIZATION_MEMBERSHIP_REQUIRED','The selected training context is unavailable.'),origin);return;}
      if(organizations.length===0&&!candidateAccess){writeJson(response,403,errorBody('ORGANIZATION_MEMBERSHIP_REQUIRED','Select an available training context.'),origin);return;}
      if(!selected&&organizations.length!==1){writeJson(response,409,errorBody('ORGANIZATION_CONTEXT_REQUIRED','Select an organization before continuing.'),origin);return;}
      const organizationId=typeof selected==='string'?selected:organizations[0];
      if(candidateAccess){principal={...principal,roles:['learner']};}
      else if(options.organizationContextResolver.resolveOrganizationRoles){
        const roles=await options.organizationContextResolver.resolveOrganizationRoles(principal.subject,organizationId);
        if(!roles.length){writeJson(response,403,errorBody('ORGANIZATION_MEMBERSHIP_REQUIRED','An active role in this organization is required.'),origin);return;}
        principal={...principal,roles:[...roles,...(principal.roles.includes('operator')?['operator']:[])]};
      }else if(organizations.length>1){writeJson(response,503,errorBody('ORGANIZATION_ROLES_UNAVAILABLE','Scoped authorization is unavailable.'),origin);return;}
      const tenant=tenantFor(request,principal,organizationId);
      if(integrationRoute&&await options.machineIntegrationApi!.handleManagement({...lifecycleContext,principal,tenant}))return;
      if(lifecycleRoute&&await options.lifecycleApi!.handleTenant({...lifecycleContext,principal,tenant}))return;
      if(lessonRenderRoute||correctedLessonTakeRoute){
        if(!canUpload(principal)){writeJson(response,403,errorBody('AUTHOR_ROLE_REQUIRED','An author role is required.'),origin);return;}
        if(!options.lessonRenders){writeJson(response,503,errorBody('LESSON_RENDER_UNAVAILABLE','Lesson rendering is unavailable.'),origin);return;}
        try{
          const jobId=lessonRenderRoute?.[1]?decodeURIComponent(lessonRenderRoute[1]):undefined;
          const action=lessonRenderRoute?.[2];
          if(correctedLessonTakeRoute){
            if(request.method!=='POST'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use POST.'),origin);return;}
            if(url.search||request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json')throw Error('LESSON_TAKE_REQUEST_INVALID');
            const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
            if(!isObject(body)||!key||Object.keys(body).some(key=>!['courseVersionId','revision','lessonId','sceneId','assetVersionId','sourceHash','reason'].includes(key)))throw Error('LESSON_TAKE_REQUEST_INVALID');
            writeJson(response,200,await options.lessonRenders.promoteCorrectedTake(tenant,{...body,idempotencyKey:key}),origin);
          }else if(!jobId){
            if(request.method!=='POST'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use POST.'),origin);return;}
            if(url.search||request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json')throw Error('LESSON_RENDER_REQUEST_INVALID');
            const body=await readJsonBody(request,Math.max(maxBodyBytes,65536)),key=idempotencyKey(request);
            if(!isObject(body)||!key||Object.keys(body).some(key=>!['courseVersionId','revision','lessonId','mode'].includes(key)))throw Error('LESSON_RENDER_REQUEST_INVALID');
            writeJson(response,202,await options.lessonRenders.create(tenant,{...body,idempotencyKey:key}),origin);
          }else if(action==='content'){
            if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET.'),origin);return;}
            const kind=url.searchParams.get('kind')??'video';
            if([...url.searchParams.keys()].some(key=>key!=='kind')||url.searchParams.getAll('kind').length>1||!['video','captions','manifest'].includes(kind))throw Error('LESSON_RENDER_REQUEST_INVALID');
            const content=await options.lessonRenders.content(tenant,jobId,kind as 'video'|'captions'|'manifest');
            if(!content){writeJson(response,404,errorBody('LESSON_RENDER_NOT_FOUND','The requested render is unavailable.'),origin);return;}
            setSecurityHeaders(response);response.statusCode=200;response.setHeader('Content-Type',content.contentType);if(origin)response.setHeader('Access-Control-Allow-Origin',origin);response.end(content.bytes);
          }else if(action==='cancel'||action==='retry'){
            if(request.method!=='POST'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use POST.'),origin);return;}
            if(url.search||request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json')throw Error('LESSON_RENDER_REQUEST_INVALID');
            const body=await readJsonBody(request,maxBodyBytes);
            if(!isObject(body)||Object.keys(body).some(key=>key!=='reason')||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>(action==='cancel'?1000:2000))throw Error('LESSON_RENDER_REQUEST_INVALID');
            const result=action==='cancel'?await options.lessonRenders.cancel(tenant,jobId,body.reason):await options.lessonRenders.retry(tenant,jobId,body.reason);
            writeJson(response,result?200:404,result??errorBody('LESSON_RENDER_NOT_FOUND','The requested render is unavailable.'),origin);
          }else{
            if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET.'),origin);return;}
            if(url.search)throw Error('LESSON_RENDER_REQUEST_INVALID');
            const result=await options.lessonRenders.get(tenant,jobId);writeJson(response,result?200:404,result??errorBody('LESSON_RENDER_NOT_FOUND','The requested render is unavailable.'),origin);
          }
        }catch(error){const code=error instanceof Error?error.message:'';const status=['LESSON_RENDER_REQUEST_INVALID','LESSON_TAKE_REQUEST_INVALID','LESSON_RENDER_CANCEL_REASON_INVALID'].includes(code)||error instanceof SyntaxError||error instanceof URIError?422:code==='LESSON_RENDER_CANCELLED'||code.includes('CHANGED')||code.includes('STALE')||code.includes('NOT_APPROVED')||code.includes('REVIEW_REQUIRED')||code==='LESSON_TAKE_DECODE_OR_DURATION_INVALID'||code==='LESSON_RENDER_CURRENT_PREVIEW_REQUIRED'||code==='IDEMPOTENCY_KEY_REUSED'?409:code.includes('DENIED')||code.includes('FORBIDDEN')||code.includes('ROLE_REQUIRED')?403:code.includes('NOT_FOUND')?404:503;writeJson(response,status,errorBody(status===503?'LESSON_RENDER_UNAVAILABLE':code,'The lesson render request could not be completed.'),origin);}
        return;
      }
      if (openMontageRoute) {
        if (openMontageRoute.collection === 'generations') {
          if (!options.openMontageGenerationService) { writeJson(response, 503, errorBody('OPENMONTAGE_GENERATION_UNAVAILABLE', 'OpenMontage generation is unavailable.'), origin); return; }
          const service = options.openMontageGenerationService;
          const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
          try {
            if (!openMontageRoute.id) {
              if (request.method !== 'POST') { writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use POST to create an OpenMontage generation.'), origin); return; }
              if (!canUpload(principal)) { writeJson(response, 403, errorBody('AUTHOR_ROLE_REQUIRED', 'An author role is required.'), origin); return; }
              if (contentType !== 'application/json') throw Error('OPENMONTAGE_GENERATION_REQUEST_INVALID');
              const key = idempotencyKey(request); const raw = await readJsonBody(request, Math.max(maxBodyBytes, 64 * 1024));
              if (!key || !isObject(raw) || Object.keys(raw).some(field => !['sceneManifest', 'prompt', 'mode', 'narrationText', 'narrationVoice'].includes(field)) || !raw.sceneManifest || typeof raw.prompt !== 'string' || !raw.prompt.trim() || raw.prompt.length > 4000 || (raw.mode !== undefined && !['LOCKED_INTERACTIVE', 'CINEMATIC'].includes(String(raw.mode))) || (raw.narrationText !== undefined && (typeof raw.narrationText !== 'string' || !raw.narrationText.trim() || raw.narrationText.length > 12_000)) || (raw.narrationVoice !== undefined && (typeof raw.narrationVoice !== 'string' || !raw.narrationVoice.trim() || raw.narrationVoice.length > 200))) throw Error('OPENMONTAGE_GENERATION_REQUEST_INVALID');
              writeJson(response, 202, await service.create(tenant, { sceneManifest: raw.sceneManifest, prompt: raw.prompt, mode: raw.mode as 'LOCKED_INTERACTIVE' | 'CINEMATIC' | undefined, narrationText: raw.narrationText as string | undefined, narrationVoice: raw.narrationVoice as string | undefined, idempotencyKey: key, requestHash: createHash('sha256').update(JSON.stringify(raw)).digest('hex') }), origin);
              return;
            }
            if (openMontageRoute.action === 'narration') {
              if (request.method !== 'GET') { writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use GET to load narration audio.'), origin); return; }
              if (!canUpload(principal) && !canReview(principal) && !canPublish(principal)) { writeJson(response, 403, errorBody('CONTENT_ROLE_REQUIRED', 'A content role is required.'), origin); return; }
              const content = await service.narration(tenant, openMontageRoute.id);
              if (!content) { writeJson(response, 404, errorBody('OPENMONTAGE_NARRATION_NOT_FOUND', 'The narration preview was not found.'), origin); return; }
              response.setHeader('Content-Type', content.contentType); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Content-Length', content.bytes.byteLength); if (origin) response.setHeader('Access-Control-Allow-Origin', origin); response.end(Buffer.from(content.bytes)); return;
            }
            if (openMontageRoute.action === 'preview') {
              if (request.method !== 'GET') { writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use GET to load a generation preview.'), origin); return; }
              if (!canUpload(principal) && !canReview(principal) && !canPublish(principal)) { writeJson(response, 403, errorBody('CONTENT_ROLE_REQUIRED', 'A content role is required.'), origin); return; }
              const content = await service.preview(tenant, openMontageRoute.id);
              if (!content) { writeJson(response, 404, errorBody('OPENMONTAGE_GENERATION_PREVIEW_NOT_FOUND', 'The generation preview was not found.'), origin); return; }
              response.setHeader('Content-Type', content.contentType); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Content-Length', content.bytes.byteLength); if (origin) response.setHeader('Access-Control-Allow-Origin', origin); response.end(Buffer.from(content.bytes)); return;
            }
            if (request.method !== 'GET') { writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use GET to load a generation.'), origin); return; }
            if (!canUpload(principal) && !canReview(principal) && !canPublish(principal)) { writeJson(response, 403, errorBody('CONTENT_ROLE_REQUIRED', 'A content role is required.'), origin); return; }
            const result = await service.get(tenant, openMontageRoute.id);
            writeJson(response, result ? 200 : 404, result ?? errorBody('OPENMONTAGE_GENERATION_NOT_FOUND', 'The generation was not found.'), origin);
            return;
          } catch (error) {
            const code = error instanceof Error ? error.message : 'OPENMONTAGE_GENERATION_FAILED';
            const notFound = ['OPENMONTAGE_GENERATION_NOT_FOUND', 'OPENMONTAGE_GENERATION_PREVIEW_NOT_FOUND', 'OPENMONTAGE_NARRATION_NOT_FOUND', 'OPENMONTAGE_BRIEF_NOT_FOUND', 'OPENMONTAGE_SOURCE_VIDEO_UNAVAILABLE', 'OPENMONTAGE_MODEL_UNAVAILABLE'].includes(code);
            const conflict = ['IDEMPOTENCY_KEY_REUSED', 'OPENMONTAGE_GENERATION_CONTENT_MISMATCH', 'OPENMONTAGE_PROMPT_HASH_MISMATCH'].includes(code);
            const invalid = ['OPENMONTAGE_GENERATION_REQUEST_INVALID', 'OPENMONTAGE_NARRATION_INVALID', 'IDEMPOTENCY_KEY_INVALID', 'SCENE_ID_INVALID', 'BRIEF_ID_INVALID'].includes(code);
            writeJson(response, notFound ? 404 : conflict ? 409 : invalid || error instanceof SyntaxError ? 422 : 500, errorBody(code, 'The OpenMontage generation could not be completed.'), origin);
          }
          return;
        }
        if (!options.openMontageSceneService) { writeJson(response, 503, errorBody('OPENMONTAGE_UNAVAILABLE', 'OpenMontage scene handoff is unavailable.'), origin); return; }
        const service = options.openMontageSceneService;
        const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
        try {
          if (openMontageRoute.collection === 'briefs') {
            if (request.method !== 'POST') { writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use POST to create an OpenMontage brief.'), origin); return; }
            if (!canUpload(principal)) { writeJson(response, 403, errorBody('AUTHOR_ROLE_REQUIRED', 'An author role is required.'), origin); return; }
            if (contentType !== 'application/json') throw Error('OPENMONTAGE_REQUEST_INVALID');
            const key = idempotencyKey(request); const raw = await readJsonBody(request, Math.max(maxBodyBytes, 64 * 1024));
            if (!key || !isObject(raw) || Object.keys(raw).some(field => !['sceneManifest', 'prompt', 'promptHash'].includes(field)) || !raw.sceneManifest || typeof raw.prompt !== 'string' || !raw.prompt.trim() || raw.prompt.length > 4000 || (raw.promptHash !== undefined && typeof raw.promptHash !== 'string')) throw Error('OPENMONTAGE_REQUEST_INVALID');
            writeJson(response, 201, await service.createBrief(tenant, { sceneManifest: raw.sceneManifest, prompt: raw.prompt, promptHash: raw.promptHash as string | undefined, idempotencyKey: key, requestHash: createHash('sha256').update(JSON.stringify(raw)).digest('hex') }), origin);
            return;
          }
          if (openMontageRoute.collection === 'artifacts' && openMontageRoute.id && openMontageRoute.action === 'approve') {
            if (request.method !== 'POST') { writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use POST to approve an OpenMontage render.'), origin); return; }
            if (!canReview(principal)) { writeJson(response, 403, errorBody('REVIEWER_ROLE_REQUIRED', 'A reviewer role is required.'), origin); return; }
            if (contentType !== 'application/json') throw Error('OPENMONTAGE_REQUEST_INVALID');
            const key = idempotencyKey(request); const raw = await readJsonBody(request, maxBodyBytes);
            if (!key || !isObject(raw) || Object.keys(raw).some(field => field !== 'reviewRef') || typeof raw.reviewRef !== 'string' || !raw.reviewRef.trim() || raw.reviewRef.length > 500) throw Error('OPENMONTAGE_REVIEW_INVALID');
            const reviewerId = principal.subject;
            writeJson(response, 200, await service.approveRender(tenant, { artifactId: openMontageRoute.id, reviewerId, reviewRef: raw.reviewRef, idempotencyKey: key, requestHash: createHash('sha256').update(JSON.stringify(raw)).digest('hex') }), origin);
            return;
          }
          if (openMontageRoute.collection === 'artifacts' && (openMontageRoute.id || request.method === 'POST')) {
            if (request.method === 'GET') {
              if (!openMontageRoute.id) { writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use an artifact id to load an OpenMontage render.'), origin); return; }
              const artifactId = openMontageRoute.id;
              const result = await service.getArtifact(tenant, artifactId);
              writeJson(response, result ? 200 : 404, result ?? errorBody('OPENMONTAGE_ARTIFACT_NOT_FOUND', 'The OpenMontage render artifact was not found.'), origin); return;
            }
            if (request.method !== 'POST') { writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use POST to ingest an OpenMontage render.'), origin); return; }
            if (!canUpload(principal)) { writeJson(response, 403, errorBody('AUTHOR_ROLE_REQUIRED', 'An author role is required.'), origin); return; }
            if (contentType !== 'application/json') throw Error('OPENMONTAGE_REQUEST_INVALID');
            const key = idempotencyKey(request); const raw = await readJsonBody(request, maxBodyBytes);
            if (!key || !isObject(raw) || Object.keys(raw).some(field => !['sceneId', 'briefId', 'video'].includes(field)) || typeof raw.sceneId !== 'string' || typeof raw.briefId !== 'string' || !isObject(raw.video)) throw Error('OPENMONTAGE_REQUEST_INVALID');
            const videoKeys = ['assetVersionId', 'sourceHash', 'contentType', 'width', 'height', 'frameRate', 'durationSeconds', 'byteLength'];
            const video = raw.video;
            if (Object.keys(video).some(field => !videoKeys.includes(field)) || typeof video.assetVersionId !== 'string' || typeof video.sourceHash !== 'string' || !['video/mp4', 'video/webm'].includes(String(video.contentType)) || ![video.width, video.height, video.frameRate, video.durationSeconds, video.byteLength].every(value => typeof value === 'number' && Number.isFinite(value))) throw Error('OPENMONTAGE_REQUEST_INVALID');
            writeJson(response, 201, await service.ingestRender(tenant, { sceneId: raw.sceneId, briefId: raw.briefId, video: video as any, idempotencyKey: key, requestHash: createHash('sha256').update(JSON.stringify(raw)).digest('hex') }), origin);
            return;
          }
          if (openMontageRoute.collection === 'scenes' && openMontageRoute.id && openMontageRoute.action === 'video') {
            if (request.method !== 'GET') { writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use GET to load the approved OpenMontage video.'), origin); return; }
            if (!canUpload(principal) && !canReview(principal) && !canPublish(principal)) { writeJson(response, 403, errorBody('CONTENT_ROLE_REQUIRED', 'A content role is required.'), origin); return; }
            const content = await service.video(tenant, openMontageRoute.id);
            if (!content) { writeJson(response, 404, errorBody('OPENMONTAGE_SCENE_NOT_FOUND', 'The approved OpenMontage scene was not found.'), origin); return; }
            response.setHeader('Content-Type', content.contentType); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Content-Length', content.bytes.byteLength); if (origin) response.setHeader('Access-Control-Allow-Origin', origin); response.end(Buffer.from(content.bytes)); return;
          }
          if (openMontageRoute.collection === 'scenes' && openMontageRoute.id) {
            if (request.method !== 'GET') { writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use GET to load an approved OpenMontage scene.'), origin); return; }
            if (!canUpload(principal) && !canReview(principal) && !canPublish(principal)) { writeJson(response, 403, errorBody('CONTENT_ROLE_REQUIRED', 'A content role is required.'), origin); return; }
            const result = await service.getApprovedScene(tenant, openMontageRoute.id);
            writeJson(response, result ? 200 : 404, result ?? errorBody('OPENMONTAGE_SCENE_NOT_FOUND', 'The approved OpenMontage scene was not found.'), origin);
            return;
          }
          if (openMontageRoute.collection === 'artifacts' && !openMontageRoute.id) {
            writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED', 'Use a render artifact resource.'), origin); return;
          }
          writeJson(response, 404, errorBody('NOT_FOUND', 'The OpenMontage resource was not found.'), origin);
        } catch (error) {
          const code = error instanceof Error ? error.message : 'OPENMONTAGE_OPERATION_FAILED';
          const notFound = ['OPENMONTAGE_BRIEF_NOT_FOUND', 'OPENMONTAGE_ARTIFACT_NOT_FOUND', 'OPENMONTAGE_SOURCE_VIDEO_UNAVAILABLE', 'OPENMONTAGE_MODEL_UNAVAILABLE'].includes(code);
          const conflict = ['IDEMPOTENCY_KEY_REUSED', 'OPENMONTAGE_PROMPT_HASH_MISMATCH', 'OPENMONTAGE_RENDER_ASSET_MISMATCH', 'OPENMONTAGE_RENDER_PROFILE_MISMATCH', 'OPENMONTAGE_ARTIFACT_ALREADY_APPROVED', 'OPENMONTAGE_RENDER_CONTENT_MISMATCH'].includes(code);
          const invalid = ['OPENMONTAGE_REQUEST_INVALID', 'OPENMONTAGE_REVIEW_INVALID', 'IDEMPOTENCY_KEY_INVALID', 'SCENE_ID_INVALID', 'BRIEF_ID_INVALID', 'ARTIFACT_ID_INVALID', 'REVIEWER_ID_INVALID', 'VIDEO_ASSET_VERSION_ID_INVALID', 'VIDEO_SOURCE_HASH_INVALID'].includes(code);
          writeJson(response, notFound ? 404 : conflict ? 409 : invalid || error instanceof SyntaxError ? 422 : 500, errorBody(code, 'The OpenMontage scene handoff could not be completed.'), origin);
        }
        return;
      }
      if(courseOfferingMatch){
        if(!['GET','POST'].includes(request.method??'')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET or POST.'),origin);return;}
        if(!options.courseOfferingStore){writeJson(response,503,errorBody('COURSE_OFFERING_UNAVAILABLE','Course availability settings are unavailable.'),origin);return;}
        try{
          const releaseId=decodeURIComponent(courseOfferingMatch[1]);
          if(request.method==='GET'){writeJson(response,200,await options.courseOfferingStore.get(tenant,releaseId),origin);return;}
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
          if(!isObject(body)||!key||body.confirmed!==true||Object.keys(body).some(field=>!['mode','audience','productScope','prerequisites','issuerStatement','intendedUse','accessibilityPath','estimatedMinutes','revision','reason','confirmed'].includes(field)))throw Error('COURSE_OFFERING_INVALID');
          writeJson(response,200,await options.courseOfferingStore.update(tenant,releaseId,{...body,idempotencyKey:key} as unknown as CourseOfferingInput),origin);
        }catch(error){
          const code=error instanceof Error?error.message:'';
          const status=code==='COURSE_OFFERING_ADMIN_REQUIRED'?403:code==='COURSE_OFFERING_NOT_FOUND'?404:['COURSE_OFFERING_CHANGED','COURSE_OFFERING_RELEASE_UNAVAILABLE','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='COURSE_OFFERING_INVALID'||error instanceof SyntaxError||error instanceof URIError?422:500;
          writeJson(response,status,errorBody(status===500?'COURSE_OFFERING_FAILED':code,'Course availability settings could not be read or saved.'),origin);
        }return;
      }
      if(isOrganizationProfile){
        if(!principal.roles.includes('organization_admin')){writeJson(response,403,errorBody('ORGANIZATION_PROFILE_ADMIN_REQUIRED','An organization administrator is required.'),origin);return;}
        if(!options.organizationProfileStore){writeJson(response,503,errorBody('ORGANIZATION_PROFILE_UNAVAILABLE','Organization settings are unavailable.'),origin);return;}
        if(!['GET','POST'].includes(request.method??'')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','This method is not supported.'),origin);return;}
        try{
          if(request.method==='GET'){writeJson(response,200,await options.organizationProfileStore.get(tenant),origin);return;}
          const body=await readJsonBody(request,options.maxBodyBytes??defaultMaxBodyBytes),key=request.headers['idempotency-key'];
          if(!isObject(body)||Object.keys(body).some(k=>!['name','description','website','revision','reason'].includes(k))||typeof body.name!=='string'||typeof body.description!=='string'||typeof body.website!=='string'||typeof body.revision!=='number'||typeof body.reason!=='string'||typeof key!=='string')throw Error('ORGANIZATION_PROFILE_INVALID');
          writeJson(response,200,await options.organizationProfileStore.update(tenant,{name:body.name,description:body.description,website:body.website,revision:body.revision,reason:body.reason,idempotencyKey:key}),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='ORGANIZATION_PROFILE_ADMIN_REQUIRED'?403:code==='ORGANIZATION_PROFILE_NOT_FOUND'?404:['ORGANIZATION_PROFILE_CHANGED','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='ORGANIZATION_PROFILE_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'ORGANIZATION_PROFILE_FAILED':code,status===409?'The organization changed. Reload before saving.':'Organization settings could not be completed.'),origin);}return;
      }

      if(isInvitation){
        response.setHeader('Cache-Control','no-store');
        if(!principal.roles.includes('organization_admin')){writeJson(response,403,errorBody('INVITATION_ADMIN_REQUIRED','An organization administrator is required.'),origin);return;}
        if(!options.invitationService){writeJson(response,503,errorBody('INVITATIONS_UNAVAILABLE','Invitations are unavailable.'),origin);return;}
        const collection=assessmentParts!.length===3;
        if(!(collection?['GET','POST']:['POST']).includes(request.method??'')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','This method is not supported.'),origin);return;}
        try{
          if(collection&&request.method==='GET'){writeJson(response,200,await options.invitationService.list(tenant,url.searchParams.get('after')??undefined),origin);return;}
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes);
          if(!isObject(body))throw Error('INVITATION_REQUEST_INVALID');
          if(collection){
            const key=idempotencyKey(request);
            if(Object.keys(body).some(field=>!['email','role'].includes(field))||typeof body.email!=='string'||typeof body.role!=='string'||!key)throw Error('INVITATION_REQUEST_INVALID');
            writeJson(response,200,await options.invitationService.create(tenant,{email:body.email,role:body.role,idempotencyKey:key}),origin);
          }else{
            if(Object.keys(body).some(field=>field!=='reason')||typeof body.reason!=='string')throw Error('INVITATION_REQUEST_INVALID');
            writeJson(response,200,await options.invitationService.revoke(tenant,decodeURIComponent(assessmentParts![3]),body.reason),origin);
          }
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='INVITATION_ADMIN_REQUIRED'?403:code==='IDEMPOTENCY_KEY_REUSED'||code==='INVITATION_UNAVAILABLE'?409:code==='INVITATION_KEY_UNAVAILABLE'?503:code==='INVITATION_REQUEST_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'INVITATION_OPERATION_FAILED':code,'The invitation operation could not be completed.'),origin);}return;
      }
      if(isMember){
        if(!principal.roles.some(role=>['organization_admin','operator'].includes(role))){writeJson(response,403,errorBody('MEMBER_ADMIN_REQUIRED','An organization administrator is required.'),origin);return;}
        const collection=assessmentParts!.length===3;
        if(request.method!==(collection?'GET':'POST')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','This method is not supported.'),origin);return;}
        if(!options.memberService){writeJson(response,503,errorBody('MEMBERS_UNAVAILABLE','Member administration is unavailable.'),origin);return;}
        try{
          if(collection){writeJson(response,200,await options.memberService.list(tenant,url.searchParams.get('after')??undefined,principal.roles.includes('operator')),origin);return;}
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
          if(assessmentParts![4]==='status'){
            if(!isObject(body)||Object.keys(body).some(k=>!['status','reason','revision'].includes(k))||typeof body.status!=='string'||typeof body.reason!=='string'||typeof body.revision!=='string'||!key)throw Error('MEMBER_REQUEST_INVALID');
            writeJson(response,200,await options.memberService.setStatus(tenant,decodeURIComponent(assessmentParts![3]),{status:body.status,reason:body.reason,revision:body.revision,idempotencyKey:key},principal.roles.includes('operator')),origin);return;
          }
          if(!isObject(body)||Object.keys(body).some(k=>!['roles','reason','revision'].includes(k))||!Array.isArray(body.roles)||body.roles.some(r=>typeof r!=='string')||typeof body.reason!=='string'||typeof body.revision!=='string'||!key)throw Error('MEMBER_REQUEST_INVALID');
          writeJson(response,200,await options.memberService.setRoles(tenant,decodeURIComponent(assessmentParts![3]),{roles:body.roles,reason:body.reason,revision:body.revision,idempotencyKey:key},principal.roles.includes('operator')),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='MEMBER_ADMIN_REQUIRED'?403:code==='MEMBER_NOT_FOUND'?404:['MEMBER_VERIFIED_ACCOUNT_REQUIRED','MEMBER_INACTIVE','MEMBER_CHANGED','LAST_ORGANIZATION_ADMIN','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='MEMBER_REQUEST_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'MEMBER_UPDATE_FAILED':code,code==='MEMBER_VERIFIED_ACCOUNT_REQUIRED'?'The member must create a personal profile and sign in with a verified email before reactivation.':code==='LAST_ORGANIZATION_ADMIN'?'Keep at least one active organization administrator.':status===409?'The member changed. Refresh before editing roles.':'Member administration could not be completed.'),origin);}return;
      }
      if(isCourseChangeJob){
        if(!principal.roles.includes('operator')){writeJson(response,403,errorBody('OPERATOR_REQUIRED','An operator must recover failed jobs.'),origin);return;}
        const collection=assessmentParts!.length===3;
        if(request.method!==(collection?'GET':'POST')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','This method is not supported.'),origin);return;}
        if(!options.courseChangeService){writeJson(response,503,errorBody('COURSE_CHANGE_UNAVAILABLE','Job recovery is unavailable.'),origin);return;}
        try{
          if(collection){writeJson(response,200,await options.courseChangeService.failedJobs(tenant,url.searchParams.get('after')??undefined),origin);return;}
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes),key=request.headers['idempotency-key'];
          if(!isObject(body)||Object.keys(body).some(k=>!['reason','retryToken'].includes(k))||typeof body.reason!=='string'||typeof body.retryToken!=='string'||typeof key!=='string')throw Error('COURSE_CHANGE_REQUEST_INVALID');
          writeJson(response,200,await options.courseChangeService.retry(tenant,decodeURIComponent(assessmentParts![3]),{reason:body.reason,retryToken:body.retryToken,idempotencyKey:key}),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='COURSE_CHANGE_JOB_NOT_FOUND'?404:['COURSE_CHANGE_JOB_CHANGED','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='COURSE_CHANGE_REQUEST_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'COURSE_CHANGE_FAILED':code,status===409?'The job changed. Refresh failed jobs before trying again.':'The recovery request could not be completed.'),origin);}return;
      }
      if(isCourseChange){
        if(!principal.roles.some(r=>['organization_admin','operator'].includes(r))){writeJson(response,403,errorBody('COURSE_CHANGE_ADMIN_REQUIRED','An administrator must review affected learners.'),origin);return;}
        if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET.'),origin);return;}
        if(!options.courseChangeService){writeJson(response,503,errorBody('COURSE_CHANGE_UNAVAILABLE','Impact preview is unavailable.'),origin);return;}
        try{writeJson(response,200,await options.courseChangeService.preview(tenant,decodeURIComponent(assessmentParts![3]),url.searchParams.get('after')??undefined),origin);}
        catch(error){const code=error instanceof Error?error.message:'';const status=code==='COURSE_CHANGE_NOT_FOUND'?404:code==='COURSE_CHANGE_REQUEST_INVALID'?422:500;writeJson(response,status,errorBody(status===500?'COURSE_CHANGE_FAILED':code,'Select a published successor release to view affected learners.'),origin);}return;
      }
      if(isNotification){
        const collection=assessmentParts!.length===3;
        if(request.method!==(collection?'GET':'POST')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','This method is not supported.'),origin);return;}
        if(!options.notificationService){writeJson(response,503,errorBody('NOTIFICATIONS_UNAVAILABLE','Notifications are unavailable.'),origin);return;}
        try{
          if(collection){writeJson(response,200,await options.notificationService.list(tenant,url.searchParams.get('after')??undefined),origin);return;}
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes);if(!isObject(body)||Object.keys(body).length)throw Error('NOTIFICATION_REQUEST_INVALID');
          writeJson(response,200,await options.notificationService.markRead(tenant,decodeURIComponent(assessmentParts![3])),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='NOTIFICATION_NOT_FOUND'?404:code==='NOTIFICATION_REQUEST_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'NOTIFICATIONS_FAILED':code,'The notification request could not be completed.'),origin);}return;
      }
      if(reviseCourseVersionId){
        if(!canUpload(principal)){writeJson(response,403,errorBody('AUTHOR_ROLE_REQUIRED','An author role is required.'),origin);return;}
        if(!options.courseReviewStore){writeJson(response,503,errorBody('COURSE_REVIEW_UNAVAILABLE','Courses are unavailable.'),origin);return;}
        if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
        try{
          const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
          if(!key||!isObject(body)||typeof body.reason!=='string'||Object.keys(body).some(k=>k!=='reason'))throw Error('COURSE_DRAFT_INVALID');
          writeJson(response,201,await options.courseReviewStore.createRevision({tenant,courseVersionId:reviseCourseVersionId,reason:body.reason,idempotencyKey:key}),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='COURSE_VERSION_NOT_FOUND'?404:['COURSE_REVISION_ALREADY_OPEN','COURSE_REVISION_SOURCE_STALE','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='COURSE_DRAFT_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'COURSE_REVISION_FAILED':code,'The new draft could not be created. Check the course library for an existing draft.'),origin);}return;
      }
      if(isAttemptInvalidation){
        if(!principal.roles.some(role=>['organization_admin','operator'].includes(role))){writeJson(response,403,errorBody('ATTEMPT_ADMIN_REQUIRED','An administrator must manage attempt invalidation and affected credentials.'),origin);return;}
        const collection=assessmentParts!.length===3;
        if(request.method!==(collection?'GET':'POST')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','This method is not supported.'),origin);return;}
        if(!options.attemptInvalidationService){writeJson(response,503,errorBody('ATTEMPTS_UNAVAILABLE','Attempt management is unavailable.'),origin);return;}
        try{
          if(collection){writeJson(response,200,await options.attemptInvalidationService.list(tenant,url.searchParams.get('learnerId')??'',url.searchParams.get('after')??undefined),origin);return;}
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request),kind=assessmentParts![3];
          if(!key||!['assessment','simulation'].includes(kind)||!isObject(body)||Object.keys(body).some(k=>!['reason','previewToken'].includes(k))||typeof body.reason!=='string'||typeof body.previewToken!=='string')throw Error('ATTEMPT_REQUEST_INVALID');
          writeJson(response,200,await options.attemptInvalidationService.invalidate(tenant,kind as 'assessment'|'simulation',decodeURIComponent(assessmentParts![4]),{reason:body.reason,previewToken:body.previewToken,idempotencyKey:key}),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='ATTEMPT_NOT_FOUND'?404:['ATTEMPT_PREVIEW_CHANGED','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='ATTEMPT_REQUEST_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'ATTEMPT_INVALIDATION_FAILED':code,'The attempt could not be invalidated. Refresh the impact preview and retry.'),origin);}return;
      }
      if(isAttemptReview){
        if(!principal.roles.some(role=>['organization_admin','operator','reviewer'].includes(role))){writeJson(response,403,errorBody('REVIEW_FORBIDDEN','An authorized reviewer is required.'),origin);return;}
        const collection=assessmentParts!.length===3;
        if(request.method!==(collection?'GET':'POST')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','This method is not supported.'),origin);return;}
        if(!options.attemptReviewService){writeJson(response,503,errorBody('REVIEW_UNAVAILABLE','Review is unavailable.'),origin);return;}
        try{
          if(collection){const mode=url.searchParams.get('mode')??'review';if(mode!=='review'&&mode!=='reset')throw Error('REVIEW_REQUEST_INVALID');writeJson(response,200,await options.attemptReviewService.list(tenant,url.searchParams.get('learnerId')??'',url.searchParams.get('after')??undefined,mode),origin);return;}
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
          if(!key||!isObject(body)||Object.keys(body).some(k=>!['reason','throughAttempt'].includes(k))||typeof body.reason!=='string'||typeof body.throughAttempt!=='number')throw Error('REVIEW_REQUEST_INVALID');
          writeJson(response,200,await options.attemptReviewService.resolve(tenant,decodeURIComponent(assessmentParts![3]),decodeURIComponent(assessmentParts![4]),{reason:body.reason,throughAttempt:body.throughAttempt,idempotencyKey:key,...(assessmentParts![5]==='reset'?{action:'reset' as const}:{})}),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='REVIEW_NOT_FOUND'?404:['REVIEW_CONFLICT','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='REVIEW_REQUEST_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'REVIEW_FAILED':code,'The review could not be completed. Refresh the review list and retry.'),origin);}return;
      }
      if(isCredentialCollection||isCredentialIssue||isCredentialLifecycle||isCredentialSharing){
        if((isCredentialCollection&&request.method!=='GET')||((isCredentialIssue||isCredentialLifecycle||isCredentialSharing)&&request.method!=='POST')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','This method is not supported.'),origin);return;}
        if(!options.credentialService){writeJson(response,503,errorBody('CREDENTIALS_UNAVAILABLE','Credentials are unavailable.'),origin);return;}
        try{
          const learnerId=url.searchParams.get('learnerId')??undefined;
          if((isCredentialLifecycle||learnerId!==undefined)&&!principal.roles.some(role=>['operator','organization_admin'].includes(role))){writeJson(response,403,errorBody('CREDENTIAL_ADMIN_REQUIRED','An organization administrator must manage credentials.'),origin);return;}
          if(isCredentialCollection){writeJson(response,200,await options.credentialService.list(tenant,url.searchParams.get('after')??undefined,learnerId),origin);return;}
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes);
          if(isCredentialSharing){
            const key=idempotencyKey(request);if(!key){writeJson(response,400,errorBody('IDEMPOTENCY_KEY_REQUIRED','An idempotency key is required.'),origin);return;}
            if(!isObject(body)||Object.keys(body).some(key=>!['enabled','revision'].includes(key))||typeof body.enabled!=='boolean'||typeof body.revision!=='number')throw new Error('CREDENTIAL_REQUEST_INVALID');
            writeJson(response,200,await options.credentialService.setSharing(tenant,decodeURIComponent(assessmentParts![3]),{enabled:body.enabled,revision:body.revision,idempotencyKey:key}),origin);return;
          }
          if(isCredentialLifecycle){
            const key=idempotencyKey(request);if(!key){writeJson(response,400,errorBody('IDEMPOTENCY_KEY_REQUIRED','An idempotency key is required.'),origin);return;}
            if(!isObject(body)||Object.keys(body).some(key=>!['reason','replacementId'].includes(key))||typeof body.reason!=='string'||(body.replacementId!==undefined&&typeof body.replacementId!=='string'))throw new Error('CREDENTIAL_REQUEST_INVALID');
            writeJson(response,200,await options.credentialService.changeStatus(tenant,decodeURIComponent(assessmentParts![3]),{action:assessmentParts![4] as 'revoke'|'supersede',reason:body.reason,replacementId:body.replacementId as string|undefined,idempotencyKey:key}),origin);return;
          }
          if(!isObject(body)||Object.keys(body).length)throw new Error('CREDENTIAL_REQUEST_INVALID');
          writeJson(response,200,await options.credentialService.issue(tenant,decodeURIComponent(assessmentParts![3])),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='CREDENTIAL_EMAIL_VERIFICATION_REQUIRED'?403:code==='CREDENTIAL_NOT_FOUND'?404:['CREDENTIAL_ISSUANCE_DISABLED','CREDENTIAL_RELEASE_SUPERSEDED','CREDENTIAL_CHANGE_NOT_EFFECTIVE','CREDENTIAL_CHANGE_INVALID','CREDENTIAL_SHARING_CONFLICT','CREDENTIAL_SHARING_NOT_ALLOWED','CREDENTIAL_REQUIREMENTS_NOT_MET','CREDENTIAL_ALREADY_REVOKED','CREDENTIAL_ALREADY_SUPERSEDED','CREDENTIAL_REPLACEMENT_INVALID','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='CREDENTIAL_REQUEST_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'CREDENTIAL_FAILED':code,code==='CREDENTIAL_EMAIL_VERIFICATION_REQUIRED'?'Create your personal profile and sign in with a verified email before receiving a credential.':code==='CREDENTIAL_REQUIREMENTS_NOT_MET'?'The published certification requirements have not been met.':code==='CREDENTIAL_ISSUANCE_DISABLED'?'This familiarization course does not issue credentials.':'The credential request could not be completed.'),origin);}
        return;
      }
      if(isLearnerSimulation) {
        if(request.method!=="POST"){writeJson(response,405,errorBody("METHOD_NOT_ALLOWED","Use POST to launch an activity."),origin);return;}
        if(!options.learnerSimulationService){writeJson(response,503,errorBody("SIMULATION_UNAVAILABLE","Simulation launch is unavailable."),origin);return;}
        try {
          const body=await readJsonBody(request,maxBodyBytes);
          if(!isObject(body)||Object.keys(body).length)throw new Error("SIMULATION_REQUEST_INVALID");
          writeJson(response,200,await options.learnerSimulationService.launch(tenant,decodeURIComponent(assessmentParts![3]),decodeURIComponent(assessmentParts![5])),origin);
        }catch(error){const code=error instanceof Error?error.message:"";const status=code==="SIMULATION_NOT_FOUND"?404:["STORY_ACTIVITY_UNAVAILABLE","SIMULATION_ATTEMPT_LIMIT","SIMULATION_COOLDOWN","SIMULATION_REVIEW_REQUIRED"].includes(code)?409:code==="SIMULATION_REQUEST_INVALID"?422:503;writeJson(response,status,errorBody(status===503?"SIMULATION_UNAVAILABLE":code,"The simulation could not be started."),origin);}
        return;
      }
      if(isApprovedMedia){
        if(!canUpload(principal)){writeJson(response,403,errorBody('AUTHOR_ROLE_REQUIRED','An author role is required.'),origin);return;}
        if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET.'),origin);return;}
        if(!options.mediaAssetService){writeJson(response,503,errorBody('MEDIA_UNAVAILABLE','Media is unavailable.'),origin);return;}
        try{
          if([...url.searchParams.keys()].some(k=>k!=='after')||url.searchParams.getAll('after').length>1)throw Error('MEDIA_REQUEST_INVALID');
          writeJson(response,200,await options.mediaAssetService.listApproved(tenant,url.searchParams.get('after')??undefined),origin);
        }catch(error){const invalid=error instanceof Error&&error.message==='MEDIA_REQUEST_INVALID';writeJson(response,invalid?422:503,errorBody(invalid?'MEDIA_REQUEST_INVALID':'MEDIA_UNAVAILABLE','Approved media could not be loaded.'),origin);}
        return;
      }
      if(isInspection){
        if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET.'),origin);return;}
        if(!options.enrollmentService?.inspect){writeJson(response,503,errorBody('EXPLORATION_UNAVAILABLE','Model inspection is unavailable.'),origin);return;}
        try{
          const enrollmentId=decodeURIComponent(assessmentParts![3]),activityId=decodeURIComponent(assessmentParts![5]);
          if(url.search||!jobIdPattern.test(enrollmentId)||!jobIdPattern.test(activityId)){writeJson(response,422,errorBody('EXPLORATION_REQUEST_INVALID','Use the enrolled activity address without query parameters.'),origin);return;}
          writeJson(response,200,await options.enrollmentService.inspect(tenant,enrollmentId,activityId),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='EXPLORATION_NOT_FOUND'?404:code==='STORY_ACTIVITY_UNAVAILABLE'?409:503;writeJson(response,status,errorBody(status===503?'EXPLORATION_UNAVAILABLE':code,'Model inspection could not be loaded.'),origin);}
        return;
      }
      if(isMedia){
        if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET.'),origin);return;}
        if(!options.mediaAssetService){writeJson(response,503,errorBody('MEDIA_UNAVAILABLE','Media is unavailable.'),origin);return;}
        try{
          const enrollmentId=decodeURIComponent(assessmentParts![3]),activityId=decodeURIComponent(assessmentParts![5]);
          const contentRequest=url.search==='?content=1';
          if(url.search&&!contentRequest||!jobIdPattern.test(enrollmentId)||!jobIdPattern.test(activityId)){writeJson(response,422,errorBody('MEDIA_REQUEST_INVALID','Use the enrollment activity media address without query parameters.'),origin);return;}
          const result=await options.mediaAssetService.get(tenant,enrollmentId,activityId,contentRequest);
          if(contentRequest){if(!result.bytes)throw Error('MEDIA_CONTENT_UNAVAILABLE');response.setHeader('Content-Type',result.contentType);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Length',result.bytes.byteLength);if(origin)response.setHeader('Access-Control-Allow-Origin',origin);response.end(Buffer.from(result.bytes));return;}
          writeJson(response,200,result,origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='MEDIA_NOT_FOUND'?404:code==='STORY_ACTIVITY_UNAVAILABLE'?409:503;writeJson(response,status,errorBody(status===503?'MEDIA_UNAVAILABLE':code,'Media could not be loaded.'),origin);}
        return;
      }
      if(isStory){
        const choosing=assessmentParts!.length===6,restarting=assessmentParts![5]==='restart';
        if(request.method!==(choosing?'POST':'GET')){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED',choosing?'Use POST.':'Use GET.'),origin);return;}
        if(!options.courseStoryStore){writeJson(response,503,errorBody('STORY_UNAVAILABLE','Story navigation is unavailable.'),origin);return;}
        try{
          const enrollmentId=decodeURIComponent(assessmentParts![3]);
          if(url.search||!jobIdPattern.test(enrollmentId))throw Error('STORY_REQUEST_INVALID');
          if(!choosing){writeJson(response,200,await options.courseStoryStore.get(tenant,enrollmentId),origin);return;}
          if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
          if(!key||!isObject(body)||Object.keys(body).some(k=>!(restarting?['revision','confirmed']:['revision','choiceId']).includes(k))||!Number.isSafeInteger(body.revision)||Number(body.revision)<1||(restarting?body.confirmed!==true:typeof body.choiceId!=='string'))throw Error('STORY_REQUEST_INVALID');
          writeJson(response,200,restarting?await options.courseStoryStore.restart(tenant,enrollmentId,{revision:Number(body.revision),requestId:key}):await options.courseStoryStore.choose(tenant,enrollmentId,{revision:Number(body.revision),choiceId:body.choiceId as string,requestId:key}),origin);
        }catch(error){
          const code=error instanceof Error?error.message:'STORY_FAILED';
          const status=code==='STORY_NOT_FOUND'?404:['STORY_REVISION_CONFLICT','STORY_BINDING_CHANGED','STORY_CHOICE_NOT_AVAILABLE','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='STORY_REQUEST_INVALID'||error instanceof SyntaxError?422:code==='STORY_CONFIGURATION_INVALID'?409:500;
          writeJson(response,status,errorBody(status===500?'STORY_FAILED':code,'Story navigation could not be completed. Refresh the current story before trying again.'),origin);
        }
        return;
      }
      if (isEnrollmentRoute) {
        if (!options.enrollmentService) { writeJson(response,503,errorBody("ENROLLMENTS_UNAVAILABLE","Enrollments are unavailable."),origin); return; }
        const detail = assessmentParts!.length === 4;
        const assignmentOptions = detail && assessmentParts![3] === "options";
        if ((isContentAcknowledgement && request.method!=="POST") || (request.method !== "GET" && !(request.method === "POST" && !detail))) { writeJson(response,405,errorBody("METHOD_NOT_ALLOWED","This method is not supported."),origin); return; }
        try {
          if(isContentAcknowledgement){
            if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
            const body=await readJsonBody(request,maxBodyBytes);
            if(!isObject(body)||Object.keys(body).length)throw new Error('ENROLLMENT_REQUEST_INVALID');
            writeJson(response,200,await options.enrollmentService.acknowledge(tenant,decodeURIComponent(assessmentParts![3]),decodeURIComponent(assessmentParts![5])),origin);return;
          }
          if (request.method === "GET") {
            if (assignmentOptions) {
              if (!principal.roles.some(role => ["operator","organization_admin"].includes(role))) { writeJson(response,403,errorBody("ENROLLMENT_ASSIGNMENT_FORBIDDEN","An organization administrator must manage course assignments."),origin); return; }
              const kind = url.searchParams.get("kind");
              if (kind !== "members" && kind !== "releases") throw new Error("ENROLLMENT_REQUEST_INVALID");
              writeJson(response,200,await options.enrollmentService.options(tenant,kind,url.searchParams.get("after") ?? undefined),origin); return;
            }
            const result = detail ? await options.enrollmentService.get(tenant,decodeURIComponent(assessmentParts![3])) : await options.enrollmentService.list(tenant,url.searchParams.get("after") ?? undefined);
            writeJson(response,200,result,origin); return;
          }
          if (!principal.roles.some(role => ["operator","organization_admin"].includes(role))) { writeJson(response,403,errorBody("ENROLLMENT_ASSIGNMENT_FORBIDDEN","An organization administrator must assign courses."),origin); return; }
          if (request.headers["content-type"]?.split(";",1)[0]?.trim().toLowerCase() !== "application/json") { writeJson(response,415,errorBody("UNSUPPORTED_MEDIA_TYPE","The request must use application/json."),origin); return; }
          const body = await readJsonBody(request,maxBodyBytes);
          if (!isObject(body) || Object.keys(body).some(key => !["learnerId","releaseId"].includes(key)) || typeof body.learnerId !== "string" || typeof body.releaseId !== "string") throw new Error("ENROLLMENT_REQUEST_INVALID");
          writeJson(response,201,await options.enrollmentService.assign(tenant,body.learnerId,body.releaseId),origin);
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          const status = code === "STORY_ACTIVITY_UNAVAILABLE" ? 409 : ["ENROLLMENT_NOT_FOUND","MEDIA_NOT_FOUND","EXPLORATION_NOT_FOUND"].includes(code) ? 404 : code === "ENROLLMENT_INACTIVE" ? 409 : ["ENROLLMENT_REQUEST_INVALID","ENROLLMENT_MEMBER_REQUIRED"].includes(code) || error instanceof SyntaxError ? 422 : 500;
          writeJson(response,status,errorBody(status === 500 ? "ENROLLMENT_FAILED" : code,"The enrollment request could not be completed."),origin);
        }
        return;
      }
      if (isAssessmentRoute) {
        if (!options.assessmentSessionService) { writeJson(response,503,errorBody("ASSESSMENTS_UNAVAILABLE","Assessments are unavailable."),origin); return; }
        const sessionId = assessmentParts![3] ? decodeURIComponent(assessmentParts![3]) : undefined;
        if (sessionId && !jobIdPattern.test(sessionId)) { writeJson(response,404,errorBody("ASSESSMENT_NOT_FOUND","Assessment not found."),origin); return; }
        const get = request.method === "GET" && assessmentParts!.length === 4;
        const start = request.method === "POST" && assessmentParts!.length === 3;
        const submit = request.method === "POST" && assessmentParts!.length === 5;
        if (!get && !start && !submit) { writeJson(response,405,errorBody("METHOD_NOT_ALLOWED","This method is not supported."),origin); return; }
        try {
          if (get) { writeJson(response,200,await options.assessmentSessionService.get(tenant,sessionId!),origin); return; }
          if (request.headers["content-type"]?.split(";",1)[0]?.trim().toLowerCase() !== "application/json") { writeJson(response,415,errorBody("UNSUPPORTED_MEDIA_TYPE","The request must use application/json."),origin); return; }
          const body = await readJsonBody(request,maxBodyBytes);
          if (!isObject(body)) throw new Error("ASSESSMENT_REQUEST_INVALID");
          if (start) {
            const key = idempotencyKey(request);
            if (!key) { writeJson(response,400,errorBody("IDEMPOTENCY_KEY_REQUIRED","An idempotency key is required."),origin); return; }
            if (Object.keys(body).some(key => !["enrollmentId","releaseId","activityId"].includes(key)) || ![body.enrollmentId,body.releaseId,body.activityId].every(value => typeof value === "string" && jobIdPattern.test(value))) throw new Error("ASSESSMENT_REQUEST_INVALID");
            writeJson(response,201,await options.assessmentSessionService.start(tenant,{ enrollmentId:body.enrollmentId as string,releaseId:body.releaseId as string,activityId:body.activityId as string,idempotencyKey:key }),origin); return;
          }
          if (Object.keys(body).some(key => key !== "answers") || !Array.isArray(body.answers)) throw new Error("ASSESSMENT_ANSWERS_INVALID");
          writeJson(response,200,await options.assessmentSessionService.submit(tenant,sessionId!,body.answers),origin);
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          const denied = ["ASSESSMENT_ACCESS_DENIED","ASSESSMENT_NOT_FOUND"].includes(code);
          const conflict = ["STORY_ACTIVITY_UNAVAILABLE","ASSESSMENT_REVIEW_REQUIRED","IDEMPOTENCY_KEY_REUSED","ASSESSMENT_ALREADY_ACTIVE","ASSESSMENT_ATTEMPT_LIMIT","ASSESSMENT_COOLDOWN","ASSESSMENT_RELEASE_CHANGED","ASSESSMENT_ALREADY_SUBMITTED","ASSESSMENT_NOT_ACTIVE"].includes(code);
          writeJson(response,denied ? 404 : conflict ? 409 : 422,errorBody(denied ? "ASSESSMENT_NOT_FOUND" : conflict ? code : "ASSESSMENT_REQUEST_INVALID",denied ? "Assessment not found." : "The assessment request could not be completed."),origin);
        }
        return;
      }
      if(reconstructionMatch){
        if(!canUpload(principal)&&!canReview(principal)){writeJson(response,403,errorBody('AUTHOR_ROLE_REQUIRED','A content role is required.'),origin);return;}
        const service=options.reconstructionService;
        if(!service){writeJson(response,request.method==='GET'&&!reconstructionMatch[1]?200:503,request.method==='GET'&&!reconstructionMatch[1]?{items:[],enabledModes:[]}:errorBody('RECONSTRUCTION_UNAVAILABLE','Reconstruction is not enabled.'),origin);return;}
        try{
          const id=reconstructionMatch[1]?decodeURIComponent(reconstructionMatch[1]):undefined,action=reconstructionMatch[2];
          if(action==='views'){if([...url.searchParams.keys()].some(key=>key!=='index')||url.searchParams.getAll('index').length!==1||!/^[0-7]$/.test(url.searchParams.get('index')??''))throw Error('RECONSTRUCTION_REQUEST_INVALID');}
          else if([...url.searchParams.keys()].some(key=>key!=='after')||url.searchParams.getAll('after').length>1||(url.searchParams.get('after')??'').length>300||action&&url.search)throw Error('RECONSTRUCTION_REQUEST_INVALID');
          if(request.method==='GET'&&!action){const result=id==='sources'?await service.sources(tenant,url.searchParams.get('after')??''):id?await service.get(tenant,id):await service.list(tenant,url.searchParams.get('after')??'');writeJson(response,result?200:404,result??errorBody('RECONSTRUCTION_UNAVAILABLE','Reconstruction unavailable.'),origin);return;}
          if(request.method==='POST'&&!id){
            if(!canUpload(principal)){writeJson(response,403,errorBody('AUTHOR_ROLE_REQUIRED','An author role is required.'),origin);return;}
            if(request.headers['content-type']?.split(';',1)[0]?.trim()!=='application/json'||url.search)throw Error('RECONSTRUCTION_REQUEST_INVALID');
            const body=await readJsonBody(request,32*1024),key=idempotencyKey(request);
            if(!key||!isObject(body)||Object.keys(body).some(key=>!['mode','sources'].includes(key)))throw Error('RECONSTRUCTION_REQUEST_INVALID');
            const result=await service.create(tenant,{mode:body.mode as any,sources:body.sources as any,idempotencyKey:key});writeJson(response,202,result,origin);return;
          }
          if(request.method==='GET'&&id&&action){const content=await service.artifact(tenant,id,action as 'candidate'|'quality'|'foreground'|'conditioning-image'|'views',action==='views'?Number(url.searchParams.get('index')):undefined);if(!content){writeJson(response,404,errorBody('RECONSTRUCTION_UNAVAILABLE','Candidate unavailable.'),origin);return;}
            response.setHeader('Content-Type',content.contentType);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Length',content.bytes.byteLength);if(origin)response.setHeader('Access-Control-Allow-Origin',origin);response.end(Buffer.from(content.bytes));return;
          }
          writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Unsupported reconstruction operation.'),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=['RECONSTRUCTION_SOURCE_UNAVAILABLE'].includes(code)?404:['IDEMPOTENCY_KEY_REUSED','RECONSTRUCTION_LIMIT_REACHED','RECONSTRUCTION_SOURCE_CHANGED','RECONSTRUCTION_ARTIFACT_INVALID','RECONSTRUCTION_CONTENT_MISMATCH'].includes(code)?409:code==='RECONSTRUCTION_MODE_UNAVAILABLE'?503:['RECONSTRUCTION_REQUEST_INVALID','RECONSTRUCTION_SOURCE_UNSUPPORTED'].includes(code)?422:500;writeJson(response,status,errorBody(status===500?'RECONSTRUCTION_OPERATION_FAILED':code,'The reconstruction operation could not be completed.'),origin);}
        return;
      }
      if(mediaReviewMatch){
        if(!canUpload(principal)&&!canReview(principal)){writeJson(response,403,errorBody('AUTHOR_ROLE_REQUIRED','A content role is required.'),origin);return;}
        const service=options.mediaReviewService;
        if(!service){writeJson(response,503,errorBody('MEDIA_IMPORT_UNAVAILABLE','Media review is unavailable.'),origin);return;}
        try{
          const id=mediaReviewMatch[1]?decodeURIComponent(mediaReviewMatch[1]):undefined,action=mediaReviewMatch[2];
          if(action==='rights'){
            const {handleAdminRights}=await import('./admin-rights.js');
            await handleAdminRights({request,response,tenant,id,service,readBody:()=>readJsonBody(request,maxBodyBytes),key:()=>idempotencyKey(request)});return;
          }
          if(request.method==='GET'&&!action){
            const result=id?await service.get(tenant,id):await service.list(tenant,url.searchParams.get('after')??'');
            writeJson(response,result?200:404,result??errorBody('MEDIA_UNAVAILABLE','Media unavailable.'),origin);return;
          }
          if(request.method==='GET'&&id&&(action==='content'||action==='frames')){
            if(action==='frames'&&([...url.searchParams.keys()].some(key=>key!=='index')||url.searchParams.getAll('index').length!==1||!/^(?:[0-9]|1[0-9]|2[0-3])$/.test(url.searchParams.get('index')??'')))throw Error('MEDIA_REVIEW_INVALID');
            const content=action==='frames'?await service.frame(tenant,id,Number(url.searchParams.get('index'))):await service.content(tenant,id);
            if(!content){writeJson(response,404,errorBody('MEDIA_UNAVAILABLE','Media unavailable.'),origin);return;}
            response.setHeader('Content-Type',content.contentType);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Length',content.bytes.byteLength);
            if(origin)response.setHeader('Access-Control-Allow-Origin',origin);
            response.end(Buffer.from(content.bytes));return;
          }
          if(request.method==='POST'&&id&&action==='review'){
            if(!canReview(principal)){writeJson(response,403,errorBody('REVIEWER_ROLE_REQUIRED','A reviewer role is required.'),origin);return;}
            if(request.headers['content-type']?.split(';',1)[0]?.trim()!=='application/json')throw Error('MEDIA_REVIEW_INVALID');
            const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
            if(!key||!isObject(body)||Object.keys(body).some(k=>!['sourceHash','decision','rationale','confirmed'].includes(k))||body.confirmed!==true||typeof body.sourceHash!=='string'||typeof body.rationale!=='string'||!['APPROVE','REJECT'].includes(String(body.decision)))throw Error('MEDIA_REVIEW_INVALID');
            writeJson(response,200,await service.review(tenant,id,{sourceHash:body.sourceHash,decision:body.decision as 'APPROVE'|'REJECT',rationale:body.rationale,idempotencyKey:key}),origin);return;
          }
          writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Unsupported media operation.'),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=['MEDIA_UNAVAILABLE','SOURCE_UNAVAILABLE'].includes(code)?404:['SOURCE_REVIEW_CONFLICT','MEDIA_CONTENT_MISMATCH','MEDIA_REPORT_INVALID'].includes(code)?409:['MEDIA_REVIEW_INVALID','SOURCE_REVIEW_INVALID'].includes(code)?422:500;writeJson(response,status,errorBody(status===500?'MEDIA_OPERATION_FAILED':code,'The media operation could not be completed.'),origin);}
        return;
      }
      if(modelImportMatch){
        if(!canUpload(principal)&&!canReview(principal)){writeJson(response,403,errorBody('AUTHOR_ROLE_REQUIRED','A content role is required.'),origin);return;}
        const service=options.modelImportService;
        if(!service){writeJson(response,503,errorBody('MODEL_IMPORT_UNAVAILABLE','Model review is unavailable.'),origin);return;}
        try{
          const id=modelImportMatch[1]?decodeURIComponent(modelImportMatch[1]):undefined,action=modelImportMatch[2];
          if(request.method==='GET'&&!action){
            const result=id?await service.get(tenant,id):await service.list(tenant,url.searchParams.get('after')??'');
            writeJson(response,result?200:404,result??errorBody('MODEL_UNAVAILABLE','Model unavailable.'),origin);return;
          }
          if(request.method==='GET'&&id&&action==='content'){
            const bytes=await service.content(tenant,id);
            if(!bytes){writeJson(response,404,errorBody('MODEL_UNAVAILABLE','Model unavailable.'),origin);return;}
            response.setHeader('Content-Type','model/gltf-binary');response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Length',bytes.byteLength);
            if(origin)response.setHeader('Access-Control-Allow-Origin',origin);
            response.end(Buffer.from(bytes));return;
          }
          if(request.method==='POST'&&id&&action==='configuration'){
            if(!canUpload(principal)){writeJson(response,403,errorBody('AUTHOR_ROLE_REQUIRED','An author role is required.'),origin);return;}
            if(request.headers['content-type']?.split(';',1)[0]?.trim()!=='application/json')throw Error('MODEL_CONFIGURATION_INVALID');
            const body=await readJsonBody(request,maxBodyBytes);
            if(!isObject(body)||Object.keys(body).some(k=>!['expectedRevision','components'].includes(k))||typeof body.expectedRevision!=='number')throw Error('MODEL_CONFIGURATION_INVALID');
            writeJson(response,200,await service.configure(tenant,id,{expectedRevision:body.expectedRevision,components:body.components}),origin);return;
          }
          if(request.method==='POST'&&id&&action==='review'){
            if(!canReview(principal)){writeJson(response,403,errorBody('REVIEWER_ROLE_REQUIRED','A reviewer role is required.'),origin);return;}
            if(request.headers['content-type']?.split(';',1)[0]?.trim()!=='application/json')throw Error('MODEL_REVIEW_INVALID');
            const body=await readJsonBody(request,maxBodyBytes),key=idempotencyKey(request);
            if(!key||!isObject(body)||Object.keys(body).some(k=>!['sourceHash','expectedRevision','decision','rationale','confirmed'].includes(k))||typeof body.expectedRevision!=='number'||body.confirmed!==true||typeof body.sourceHash!=='string'||typeof body.rationale!=='string'||!['APPROVE','REJECT'].includes(String(body.decision)))throw Error('MODEL_REVIEW_INVALID');
            writeJson(response,200,await service.review(tenant,id,{sourceHash:body.sourceHash,expectedRevision:body.expectedRevision,decision:body.decision as 'APPROVE'|'REJECT',rationale:body.rationale,idempotencyKey:key}),origin);return;
          }
          writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Unsupported model operation.'),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=code==='MODEL_UNAVAILABLE'?404:code==='MODEL_INDEPENDENT_REVIEW_REQUIRED'?403:['MODEL_REVIEW_CONFLICT','MODEL_NORMALIZATION_REQUIRED','MODEL_CONTENT_MISMATCH','RECONSTRUCTION_SOURCE_UNAVAILABLE','RECONSTRUCTION_SOURCE_CHANGED','RECONSTRUCTION_LINEAGE_INVALID'].includes(code)?409:['MODEL_REVIEW_INVALID','MODEL_CONFIGURATION_INVALID'].includes(code)?422:500;writeJson(response,status,errorBody(status===500?'MODEL_OPERATION_FAILED':code,code==='MODEL_INDEPENDENT_REVIEW_REQUIRED'?'A different reviewer must approve this imported model.':'The model operation could not be completed.'),origin);}
        return;
      }
      if (isSourceCollection || sourceDetailId) {
        if(sourceDetailId && request.method==='POST'){
          if(!canReview(principal)){writeJson(response,403,errorBody('REVIEWER_ROLE_REQUIRED','A reviewer role is required.'),origin);return;}
          if(!options.knowledgeStore?.reviewSource){writeJson(response,503,errorBody('SOURCE_REVIEW_UNAVAILABLE','Source review is unavailable.'),origin);return;}
          try{
            const key=idempotencyKey(request);
            if(request.headers['content-type']?.split(';',1)[0]?.trim()!=='application/json')throw Error('SOURCE_REVIEW_INVALID');
            const body=await readJsonBody(request,maxBodyBytes);
            if(!key||!isObject(body)||Object.keys(body).some(k=>!['sourceHash','decision','rationale','confirmed'].includes(k))||body.confirmed!==true||typeof body.sourceHash!=='string'||typeof body.rationale!=='string'||!['APPROVE','REJECT'].includes(String(body.decision)))throw Error('SOURCE_REVIEW_INVALID');
            writeJson(response,200,await options.knowledgeStore.reviewSource(tenant,sourceDetailId,{sourceHash:body.sourceHash,decision:body.decision as 'APPROVE'|'REJECT',rationale:body.rationale,idempotencyKey:key}),origin);
          }catch(error){const code=error instanceof Error?error.message:'';const status=code==='SOURCE_UNAVAILABLE'?404:code==='SOURCE_REVIEW_CONFLICT'?409:code==='SOURCE_REVIEW_INVALID'?422:500;writeJson(response,status,errorBody(status===500?'SOURCE_REVIEW_FAILED':code,'The source review could not be saved. Refresh the source and try again.'),origin);}
          return;
        }
        if (!canUpload(principal) && !canReview(principal) && !canPublish(principal)) { writeJson(response, 403, errorBody("AUTHOR_ROLE_REQUIRED", "A content management role is required."), origin); return; }
        if (request.method !== "GET") { writeJson(response, 405, errorBody("METHOD_NOT_ALLOWED", "This method is not supported."), origin); return; }
        if (!options.knowledgeStore) { writeJson(response, 503, errorBody("KNOWLEDGE_UNAVAILABLE", "Source documents are unavailable."), origin); return; }
        const after = url.searchParams.get("after") ?? undefined;
        if (after && !jobIdPattern.test(after)) { writeJson(response, 422, errorBody("CURSOR_INVALID", "The source cursor is invalid."), origin); return; }
        if (sourceDetailId) {
          if (!jobIdPattern.test(sourceDetailId)) { writeJson(response, 404, errorBody("SOURCE_NOT_FOUND", "The source is unavailable."), origin); return; }
          const source = await options.knowledgeStore.readSource(tenant, sourceDetailId, after);
          writeJson(response, source ? 200 : 404, source ?? errorBody("SOURCE_NOT_FOUND", "The source is unavailable."), origin); return;
        }
        writeJson(response, 200, await options.knowledgeStore.listSources(tenant, after), origin); return;
      }
      if (isCourseCollection) {
        if (!canUpload(principal) && !canReview(principal) && !canPublish(principal)) { writeJson(response, 403, errorBody("AUTHOR_ROLE_REQUIRED", "A content management role is required."), origin); return; }
        if (!options.courseReviewStore) { writeJson(response, 503, errorBody("COURSE_REVIEW_UNAVAILABLE", "Courses are unavailable."), origin); return; }
        if (request.method === "GET") {
          const after = url.searchParams.get("after") ?? undefined;
          if (after && !jobIdPattern.test(after)) { writeJson(response, 422, errorBody("CURSOR_INVALID", "The course cursor is invalid."), origin); return; }
          writeJson(response, 200, await options.courseReviewStore.listDrafts(tenant, after), origin); return;
        }
        if (request.method !== "POST") { writeJson(response, 405, errorBody("METHOD_NOT_ALLOWED", "This method is not supported."), origin); return; }
        if (!canUpload(principal)) { writeJson(response, 403, errorBody("AUTHOR_ROLE_REQUIRED", "An author role is required."), origin); return; }
        const key = idempotencyKey(request);
        if (!key) { writeJson(response, 400, errorBody("IDEMPOTENCY_KEY_REQUIRED", "An idempotency key is required."), origin); return; }
        if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") { writeJson(response, 415, errorBody("UNSUPPORTED_MEDIA_TYPE", "The request must use application/json."), origin); return; }
        try {
          const body = await readJsonBody(request, maxBodyBytes);
          if (!isObject(body) || typeof body.title !== "string" || Object.keys(body).some(field => field !== "title")) throw new Error("COURSE_DRAFT_INVALID");
          writeJson(response, 201, await options.courseReviewStore.createDraft({ tenant, title: body.title, idempotencyKey: key }), origin);
        } catch (error) {
          const conflict = error instanceof Error && error.message === "IDEMPOTENCY_KEY_REUSED";
          writeJson(response, conflict ? 409 : 422, errorBody(conflict ? "IDEMPOTENCY_KEY_REUSED" : "COURSE_DRAFT_INVALID", "The course could not be created."), origin);
        }
        return;
      }
      if (isModelAssetRoute) {
        if (!options.modelAssetService) {
          writeJson(response, 503, errorBody("MODEL_ASSETS_UNAVAILABLE", "Approved model delivery is not available."), origin);
          return;
        }
        const requestedVariant = url.searchParams.get("variant") ?? undefined;
        if (requestedVariant !== undefined && !/^[A-Za-z0-9._-]{1,64}$/.test(requestedVariant)) {
          writeJson(response, 422, errorBody("MODEL_VARIANT_INVALID", "The requested model variant is invalid."), origin);
          return;
        }
        const content=url.searchParams.get('content');
        if(content!==null){
          if(!['model','manifest'].includes(content)){writeJson(response,422,errorBody('MODEL_CONTENT_INVALID','Choose model or manifest content.'),origin);return;}
          if(!options.modelAssetService.getLearnerContent){writeJson(response,503,errorBody('MODEL_ASSETS_UNAVAILABLE','Private model delivery is unavailable.'),origin);return;}
          const result=await options.modelAssetService.getLearnerContent(tenant,{...modelAssetRequest!,variantId:requestedVariant,content:content as 'model'|'manifest'});
          if(!result){writeJson(response,404,errorBody('APPROVED_MODEL_NOT_FOUND','The model is unavailable.'),origin);return;}
          response.setHeader('Content-Type',result.contentType);response.setHeader('Content-Length',result.bytes.byteLength);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');if(origin)response.setHeader('Access-Control-Allow-Origin',origin);response.end(Buffer.from(result.bytes));return;
        }
        const asset = await options.modelAssetService.getLearnerModel(tenant, { ...modelAssetRequest!, variantId: requestedVariant });
        if (!asset) {
          writeJson(response, 404, errorBody("APPROVED_MODEL_NOT_FOUND", "The approved model is not bound to this release."), origin);
          return;
        }
        writeJson(response, 200, asset, origin, asset.cacheControl);
        return;
      }
      if (isModelSessionRoute) {
        if (!options.modelSessionService) {
          writeJson(response, 503, errorBody("MODEL_SESSION_UNAVAILABLE", "The model activity session is not available."), origin);
          return;
        }
        if (modelSessionDebriefId !== null) {
          if (url.search) { writeJson(response, 422, errorBody('VALIDATION_ERROR', 'Debrief does not accept query parameters.'), origin); return; }
          if (!options.modelSessionService.debrief) { writeJson(response, 503, errorBody('MODEL_DEBRIEF_UNAVAILABLE', 'The activity debrief is unavailable.'), origin); return; }
          const debrief = await options.modelSessionService.debrief(tenant, modelSessionDebriefId);
          writeJson(response, debrief ? 200 : 404, debrief ?? errorBody('MODEL_SESSION_NOT_FOUND', 'The model activity session was not found.'), origin);
          return;
        }
        if (modelSessionStart) {
          const key = idempotencyKey(request);
          if (!key) { writeJson(response, 400, errorBody("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required to start a session."), origin); return; }
          let body: unknown;
          try { body = await readJsonBody(request, maxBodyBytes); } catch { writeJson(response, 422, errorBody("INVALID_REQUEST_BODY", "The session start body is invalid."), origin); return; }
          if (!validModelSessionStartBody(body)) { writeJson(response, 422, errorBody("VALIDATION_ERROR", "A valid release-bound session start request is required."), origin); return; }
          try {
            const result = await options.modelSessionService.start(tenant, body, key);
            writeJson(response, 200, result, origin);
          } catch (error) {
            const code = error instanceof Error ? error.message : "MODEL_SESSION_START_FAILED";
            const status = ["IDEMPOTENCY_KEY_REUSED","STORY_ACTIVITY_UNAVAILABLE"].includes(code) ? 409 : ["MODEL_RELEASE_BINDING_NOT_FOUND", "SIMULATION_DEFINITION_NOT_PUBLISHED_OR_BOUND", "ENROLLMENT_NOT_ACTIVE_FOR_RELEASE", "ACTIVITY_NOT_IN_RELEASE", "POLICY_NOT_PUBLISHED_FOR_RELEASE", "SIMULATION_ATTEMPT_NOT_ACTIVE_OR_BOUND"].includes(code) ? 404 : code === "MODEL_SESSION_EXPIRY_INVALID" ? 422 : 422;
            writeJson(response, status, errorBody(code, status === 409 ? "The idempotency key was already used for a different session start." : "The approved release-bound model session could not be started."), origin);
          }
          return;
        }
        if (modelSessionActionId !== null) {
          const key = idempotencyKey(request);
          if (!key) { writeJson(response, 400, errorBody("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for an action."), origin); return; }
          let body: unknown;
          try { body = await readJsonBody(request, maxBodyBytes); } catch { writeJson(response, 422, errorBody("INVALID_REQUEST_BODY", "The action body is invalid."), origin); return; }
          if (!validModelActionBody(body)) { writeJson(response, 422, errorBody("VALIDATION_ERROR", "A valid semantic action is required."), origin); return; }
          const result = await options.modelSessionService.submit(tenant, modelSessionActionId, body as never, key);
          writeJson(response, 200, result, origin);
          return;
        }
        const releaseBindingId = url.searchParams.get("releaseBindingId");
        const modelVersionId = url.searchParams.get("modelVersionId");
        const nextSequence = Number(url.searchParams.get("nextSequence"));
        if (!releaseBindingId || !modelVersionId || !Number.isSafeInteger(nextSequence) || nextSequence < 1) { writeJson(response, 422, errorBody("VALIDATION_ERROR", "Release binding, model version, and next sequence are required."), origin); return; }
        const result = await options.modelSessionService.resume(tenant, modelSessionGetId!, { releaseBindingId, modelVersionId, nextSequence });
        if (!result) writeJson(response, 404, errorBody("MODEL_SESSION_NOT_FOUND", "The model activity session was not found."), origin);
        else writeJson(response, 200, result, origin);
        return;
      }
      if(modelPreviewId){
        if(!canUpload(principal)&&!canReview(principal)){writeJson(response,403,errorBody('CONTENT_ROLE_REQUIRED','An author or reviewer role is required.'),origin);return;}
        if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET.'),origin);return;}
        if(!options.modelAssetService?.getAuthorPreview){writeJson(response,503,errorBody('MODEL_PREVIEW_UNAVAILABLE','Model preview is unavailable.'),origin);return;}
        const revision=Number(url.searchParams.get('revision'));
        if(!Number.isSafeInteger(revision)||revision<1||url.searchParams.getAll('revision').length!==1||[...url.searchParams.keys()].some(k=>k!=='revision')){writeJson(response,422,errorBody('MODEL_PREVIEW_INVALID','Supply the saved draft revision.'),origin);return;}
        const preview=await options.modelAssetService.getAuthorPreview(tenant,{courseVersionId:modelPreviewId,revision});
        writeJson(response,preview?200:404,preview??errorBody('MODEL_PREVIEW_NOT_FOUND','Reload the draft and check that its bound model is approved.'),origin);return;
      }
      if(draftHistoryId){
        if(!canUpload(principal)){writeJson(response,403,errorBody('AUTHOR_ROLE_REQUIRED','An author role is required.'),origin);return;}
        const store=options.courseReviewStore;
        if(!store?.listDraftHistory||!store.restoreDraftHistory){writeJson(response,503,errorBody('COURSE_REVIEW_UNAVAILABLE','Draft history is unavailable.'),origin);return;}
        try{
          if(request.method==='GET'){
            if(url.searchParams.has('eventId')){
              if([...url.searchParams.keys()].some(key=>!['eventId','side'].includes(key))||url.searchParams.getAll('eventId').length!==1||url.searchParams.getAll('side').length!==1||!['before','after'].includes(url.searchParams.get('side')!))throw Error('COURSE_DRAFT_INVALID');
              if(!store.previewDraftHistory){writeJson(response,503,errorBody('COURSE_REVIEW_UNAVAILABLE','History comparison is unavailable.'),origin);return;}
              writeJson(response,200,await store.previewDraftHistory(tenant,draftHistoryId,url.searchParams.get('eventId')!,url.searchParams.get('side') as 'before'|'after'),origin);return;
            }
            const cursor=url.searchParams.get('beforeRevision');
            if([...url.searchParams.keys()].some(key=>key!=='beforeRevision')||url.searchParams.getAll('beforeRevision').length>1||(cursor!==null&&!/^[1-9][0-9]*$/.test(cursor)))throw Error('COURSE_DRAFT_INVALID');
            writeJson(response,200,await store.listDraftHistory(tenant,draftHistoryId,cursor===null?undefined:Number(cursor)),origin);return;
          }
          if(request.method!=='POST'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET or POST.'),origin);return;}
          if(url.search)throw Error('COURSE_DRAFT_INVALID');
          if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const key=idempotencyKey(request);if(!key){writeJson(response,400,errorBody('IDEMPOTENCY_KEY_REQUIRED','A request key is required.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes) as Record<string,unknown>;
          if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['revision','eventId','side','reason','confirmed'].includes(k))||body.confirmed!==true||!Number.isSafeInteger(body.revision)||typeof body.eventId!=='string'||!['before','after'].includes(String(body.side))||typeof body.reason!=='string')throw Error('COURSE_DRAFT_INVALID');
          writeJson(response,200,await store.restoreDraftHistory({tenant,courseVersionId:draftHistoryId,revision:body.revision as number,eventId:body.eventId,side:body.side as 'before'|'after',reason:body.reason,idempotencyKey:key}),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=['COURSE_VERSION_NOT_FOUND','DRAFT_HISTORY_NOT_FOUND'].includes(code)?404:['COURSE_VERSION_STALE','COURSE_VERSION_IMMUTABLE','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:code==='COURSE_DRAFT_INVALID'||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'DRAFT_HISTORY_FAILED':code,'Draft history could not be applied. Reload the saved draft and review the selected change.'),origin);}
        return;
      }
      if(isApprovedModels||createSimulationId||bindModelId||replaceModelId){
        if(!canUpload(principal)){writeJson(response,403,errorBody('AUTHOR_ROLE_REQUIRED','An author role is required.'),origin);return;}
        const store=options.courseReviewStore;
        if(!store?.listApprovedModels||!store.createSimulation||(bindModelId&&!store.bindModel)||(replaceModelId&&!store.replaceModel)){writeJson(response,503,errorBody('COURSE_REVIEW_UNAVAILABLE','Simulation creation is unavailable.'),origin);return;}
        try{
          if(isApprovedModels){
            if(request.method!=='GET'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use GET.'),origin);return;}
            if(url.searchParams.has('modelVersionId')){
              if([...url.searchParams.keys()].some(k=>k!=='modelVersionId')||url.searchParams.getAll('modelVersionId').length!==1)throw Error('COURSE_DRAFT_INVALID');
              if(!store.getApprovedModelComponents){writeJson(response,503,errorBody('COURSE_REVIEW_UNAVAILABLE','Model components are unavailable.'),origin);return;}
              writeJson(response,200,await store.getApprovedModelComponents(tenant,url.searchParams.get('modelVersionId')!),origin);return;
            }
            if([...url.searchParams.keys()].some(k=>k!=='after')||url.searchParams.getAll('after').length>1)throw Error('COURSE_DRAFT_INVALID');
            writeJson(response,200,await store.listApprovedModels(tenant,url.searchParams.get('after')??undefined),origin);return;
          }
          if(request.method!=='POST'){writeJson(response,405,errorBody('METHOD_NOT_ALLOWED','Use POST.'),origin);return;}
          if(url.search)throw Error('COURSE_DRAFT_INVALID');
          if(request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json'){writeJson(response,415,errorBody('UNSUPPORTED_MEDIA_TYPE','Use application/json.'),origin);return;}
          const key=idempotencyKey(request);if(!key){writeJson(response,400,errorBody('IDEMPOTENCY_KEY_REQUIRED','A request key is required.'),origin);return;}
          const body=await readJsonBody(request,maxBodyBytes) as Record<string,unknown>;
          if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['revision','modelVersionId','confirmed',...(replaceModelId?['componentMapping']:[])].includes(k))||body.confirmed!==true||!Number.isSafeInteger(body.revision)||typeof body.modelVersionId!=='string')throw Error('COURSE_DRAFT_INVALID');
          writeJson(response,201,await (replaceModelId?store.replaceModel!:bindModelId?store.bindModel!:store.createSimulation)({tenant,courseVersionId:(replaceModelId??bindModelId??createSimulationId)!,revision:body.revision as number,modelVersionId:body.modelVersionId,idempotencyKey:key,...(replaceModelId&&body.componentMapping!==undefined?{componentMapping:body.componentMapping as Array<{from:string;to:string|null}>}:{})}),origin);
        }catch(error){const code=error instanceof Error?error.message:'';const status=['COURSE_VERSION_NOT_FOUND','APPROVED_MODEL_NOT_FOUND'].includes(code)?404:['COURSE_VERSION_STALE','COURSE_VERSION_IMMUTABLE','SIMULATION_ALREADY_EXISTS','COURSE_MODEL_ALREADY_BOUND','COURSE_MODEL_NOT_BOUND','MODEL_COMPONENT_MAPPING_REQUIRED','MODEL_ACTIONS_INCOMPATIBLE','MODEL_COMPONENT_STILL_REFERENCED','IDEMPOTENCY_KEY_REUSED'].includes(code)?409:['COURSE_DRAFT_INVALID','MODEL_CURSOR_INVALID','MODEL_MANIFEST_INVALID','MODEL_COMPONENT_MAPPING_INVALID'].includes(code)||error instanceof SyntaxError?422:500;writeJson(response,status,errorBody(status===500?'SIMULATION_CREATION_FAILED':code,code==='MODEL_COMPONENT_STILL_REFERENCED'?'A removed component is still used by a procedure, fault or hotspot. Update those references before replacement.':code==='MODEL_COMPONENT_MAPPING_REQUIRED'?'The replacement needs matching stable component IDs. Review component mappings before replacing this model.':code==='MODEL_ACTIONS_INCOMPATIBLE'?'The replacement model cannot perform the authored transforms. Review the model limits and simulation actions.':'Model binding or simulation creation could not be completed. Reload the draft and check the approved model.'),origin);}
        return;
      }
      if (isReviewRoute) {
        if (!canUpload(principal) && !canReview(principal) && !canPublish(principal)) {
          writeJson(response, 403, errorBody("CONTENT_ROLE_REQUIRED", "A content management role is required."), origin); return;
        }
        if (!options.courseReviewStore) {
          writeJson(response, 503, errorBody("COURSE_REVIEW_UNAVAILABLE", "Course review is not available."), origin);
          return;
        }
        const courseVersionId = reviewCourseVersionId ?? publishCourseVersionId;
        if (!courseVersionId) {
          writeJson(response, 404, errorBody("NOT_FOUND", "The requested resource was not found."), origin);
          return;
        }
        if (request.method === "GET") {
          const snapshot = await options.courseReviewStore.get({ ...tenant, courseVersionId }, courseVersionId);
          if (!snapshot) writeJson(response, 404, errorBody("COURSE_VERSION_NOT_FOUND", "The course version was not found."), origin);
          else writeJson(response, 200, snapshot, origin);
          return;
        }
        if (request.method === "PUT") {
          if (!canUpload(principal)) { writeJson(response, 403, errorBody("AUTHOR_ROLE_REQUIRED", "An author role is required."), origin); return; }
          if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") { writeJson(response, 415, errorBody("UNSUPPORTED_MEDIA_TYPE", "The request must use application/json."), origin); return; }
          try {
            const body = await readJsonBody(request, maxBodyBytes) as { revision?: number; content?: Record<string, unknown> };
            if (!body || !Number.isSafeInteger(body.revision) || !body.content || Array.isArray(body.content) || typeof body.content !== "object") throw new Error("COURSE_DRAFT_INVALID");
            const saved = await options.courseReviewStore.saveDraft({ tenant, courseVersionId, revision: body.revision!, content: body.content });
            writeJson(response, saved ? 200 : 404, saved ?? errorBody("COURSE_VERSION_NOT_FOUND", "The course version was not found."), origin);
          } catch (error) {
            const code = error instanceof Error ? error.message : "COURSE_DRAFT_INVALID";
            const conflict = ["COURSE_VERSION_STALE", "COURSE_VERSION_IMMUTABLE"].includes(code);
            writeJson(response, conflict ? 409 : 422, errorBody(conflict ? code : "COURSE_DRAFT_INVALID", conflict ? "Reload the current course before saving." : "The draft could not be saved."), origin);
          }
          return;
        }
        if (request.method !== "POST") { writeJson(response, 405, errorBody("METHOD_NOT_ALLOWED", "This method is not supported."), origin); return; }
        const key = idempotencyKey(request);
        if (!key) {
          writeJson(response, 400, errorBody("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for this operation."), origin);
          return;
        }
        if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
          writeJson(response, 415, errorBody("UNSUPPORTED_MEDIA_TYPE", "The request must use application/json."), origin);
          return;
        }
        let bodyAndRequest: { body: unknown; hash: string };
        try { bodyAndRequest = await bodyAndHash(request, maxBodyBytes); } catch (error) {
          const code = error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? error.message : "INVALID_REQUEST_BODY";
          writeJson(response, 422, errorBody(code, "The request body is invalid."), origin);
          return;
        }
        try {
          if (publishCourseVersionId) {
            if (!canPublish(principal)) {
              writeJson(response, 403, errorBody("PUBLISHER_ROLE_REQUIRED", "The publisher role is required."), origin);
              return;
            }
            const release = await options.courseReviewStore.publish({ tenant: { ...tenant, courseVersionId }, courseVersionId, idempotencyKey: key, requestHash: bodyAndRequest.hash });
            if (!release) writeJson(response, 404, errorBody("COURSE_VERSION_NOT_FOUND", "The course version was not found."), origin);
            else writeJson(response, 200, release, origin);
            return;
          }
          if (!canReview(principal) || !validReviewBody(bodyAndRequest.body)) {
            writeJson(response, canReview(principal) ? 422 : 403, errorBody(canReview(principal) ? "VALIDATION_ERROR" : "REVIEWER_ROLE_REQUIRED", canReview(principal) ? "A valid review decision is required." : "The reviewer role is required."), origin);
            return;
          }
          const decision = await options.courseReviewStore.recordDecision({ tenant: { ...tenant, courseVersionId }, courseVersionId, ...bodyAndRequest.body, targetType: bodyAndRequest.body.targetType as ReviewTargetType, decision: bodyAndRequest.body.decision as ReviewDecision, idempotencyKey: key, requestHash: bodyAndRequest.hash });
          if (!decision) writeJson(response, 404, errorBody("COURSE_VERSION_NOT_FOUND", "The course version was not found."), origin);
          else writeJson(response, 201, decision, origin);
        } catch (error) {
          const code = error instanceof Error ? error.message : "COURSE_REVIEW_FAILED";
          const status = ["COURSE_VERSION_STALE", "COURSE_VERSION_IMMUTABLE", "COURSE_REVIEW_REQUIRED", "ROLE_SEPARATION_REQUIRED", "SOURCE_ARTIFACT_NOT_APPROVED", "COURSE_PUBLICATION_BLOCKED", "IDEMPOTENCY_KEY_REUSED"].includes(code) ? 409 : 422;
          writeJson(response, status, errorBody(code, "The course review operation could not be completed."), origin);
        }
        return;
      }
      if (isUploadRoute) {
        if (!canUpload(principal)) {
          writeJson(response, 403, errorBody('AUTHOR_ROLE_REQUIRED', 'An author role is required.'), origin); return;
        }
        if (!options.uploadSessionService) {
          writeJson(response, 503, errorBody("UPLOADS_UNAVAILABLE", "Uploads are not available."), origin);
          return;
        }
        if (uploadContentId !== null) {
          if (!options.uploadSessionService.uploadContent) {
            writeJson(response, 503, errorBody('UPLOADS_UNAVAILABLE', 'Uploads are not available.'), origin); return;
          }
          request.setTimeout(120_000, () => request.destroy());
          try {
            const accepted = await options.uploadSessionService.uploadContent(tenant, uploadContentId,
              request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() ?? '', request.iterator({destroyOnReturn:false}));
            request.socket?.setTimeout(0);
            request.resume();
            writeJson(response, accepted ? 200 : 404, accepted ? { uploaded: true } : errorBody('UPLOAD_SESSION_NOT_FOUND', 'The upload session was not found.'), origin);
          } catch (error) {
            request.socket?.setTimeout(0);
            request.resume();
            const invalid = error instanceof Error && error.message === 'UPLOAD_CONTENT_INVALID';
            writeJson(response, invalid ? 422 : 503, errorBody(invalid ? 'UPLOAD_CONTENT_INVALID' : 'UPLOAD_FAILED', 'The file could not be uploaded. Retry the upload.'), origin);
          }
          return;
        }
        if (uploadCreateOrganizationId !== null) {
          if (uploadCreateOrganizationId !== tenant.organizationId || !canUpload(principal)) {
            writeJson(response, 404, errorBody("NOT_FOUND", "The requested resource was not found."), origin);
            return;
          }
          if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
            writeJson(response, 415, errorBody("UNSUPPORTED_MEDIA_TYPE", "The request must use application/json."), origin);
            return;
          }
          let body: unknown;
          try {
            body = await readJsonBody(request, maxBodyBytes);
          } catch {
            writeJson(response, 422, errorBody("INVALID_REQUEST_BODY", "The request body is invalid."), origin);
            return;
          }
          if (!validUploadCreateBody(body)) {
            writeJson(response, 422, errorBody("VALIDATION_ERROR", "A valid upload description is required."), origin);
            return;
          }
          try {
            const result = await options.uploadSessionService.create(tenant, { ...body, actorId: principal.subject });
            writeJson(response, 201, {
              uploadSessionId: result.session.uploadSessionId,
              blobKey: result.session.blobKey,
              uploadUrl: result.uploadUrl,
              expiresAt: result.session.expiresAt,
              expiresInSeconds: result.expiresInSeconds,
              requiredContentType: result.session.contentType,
              maxBytes: result.session.sizeBytes
            }, origin);
          } catch (error) {
            const code = error instanceof Error && ["FILE_SIZE_INVALID", "CONTENT_TYPE_UNSUPPORTED", "SOURCE_TYPE_UNSUPPORTED", "SHA256_INVALID", "FILE_NAME_INVALID"].includes(error.message)
              ? error.message
              : "UPLOAD_SESSION_FAILED";
            writeJson(response, 422, errorBody(code, code === "UPLOAD_SESSION_FAILED" ? "The upload session could not be created." : "The upload request is invalid."), origin);
          }
          return;
        }
        const uploadSessionId = uploadCompleteId ?? uploadCancelId;
        if (!uploadSessionId) {
          writeJson(response, 404, errorBody("NOT_FOUND", "The requested resource was not found."), origin);
          return;
        }
        if (uploadCompleteId !== null) {
          if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
            writeJson(response, 415, errorBody("UNSUPPORTED_MEDIA_TYPE", "The request must use application/json."), origin);
            return;
          }
          let body: unknown;
          try { body = await readJsonBody(request, maxBodyBytes); } catch {
            writeJson(response, 422, errorBody("INVALID_REQUEST_BODY", "The request body is invalid."), origin);
            return;
          }
          if (!validUploadCompleteBody(body)) {
            writeJson(response, 422, errorBody("VALIDATION_ERROR", "A valid upload completion is required."), origin);
            return;
          }
          const result = await options.uploadSessionService.complete(tenant, uploadSessionId, body);
          if (!result) {
            writeJson(response, 422, errorBody("UPLOAD_VERIFICATION_FAILED", "The uploaded object could not be verified."), origin);
            return;
          }
          writeJson(response, 200, result, origin);
          return;
        }
        const cancelled = await options.uploadSessionService.cancel(tenant, uploadSessionId);
        writeJson(response, cancelled ? 204 : 404, cancelled ? null : errorBody("UPLOAD_SESSION_NOT_FOUND", "The upload session was not found."), origin);
        return;
      }
      if (isDraftRoute) {
        if (!options.draftService || !canUpload(principal)) {
          writeJson(response, 404, errorBody("NOT_FOUND", "The requested resource was not found."), origin);
          return;
        }
        if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
          writeJson(response, 415, errorBody("UNSUPPORTED_MEDIA_TYPE", "The request must use application/json."), origin);
          return;
        }
        let body: unknown;
        try { body = await readJsonBody(request, maxBodyBytes); } catch {
          writeJson(response, 422, errorBody("INVALID_REQUEST_BODY", "The request body is invalid."), origin);
          return;
        }
        if (!validDraftBody(body)) {
          writeJson(response, 422, errorBody("VALIDATION_ERROR", "Source artifact IDs are required."), origin);
          return;
        }
        try {
          const result = await options.draftService.generate({ ...tenant, courseVersionId: draftCourseVersionId }, body);
          writeJson(response, 200, result, origin);
        } catch (error) {
          const code = error instanceof Error && ["SOURCE_ARTIFACTS_REQUIRED", "SOURCE_KNOWLEDGE_NOT_FOUND"].includes(error.message) ? error.message : "AI_DRAFT_FAILED";
          writeJson(response, code === "SOURCE_KNOWLEDGE_NOT_FOUND" ? 404 : 422, errorBody(code, "The source-grounded draft could not be generated."), origin);
        }
        return;
      }
      if (!jobId) {
        writeJson(response, 404, errorBody("NOT_FOUND", "The requested resource was not found."), origin);
        return;
      }
      if (request.method === "GET") {
        const status = await options.statusService.get(tenant, jobId);
        if (!status) {
          writeJson(response, 404, errorBody("JOB_NOT_FOUND", "The job was not found."), origin);
          return;
        }
        writeJson(response, 200, status, origin);
        return;
      }

      if (!isOperator(principal)) {
        writeJson(response, 403, errorBody("OPERATOR_ROLE_REQUIRED", "The operator role is required."), origin);
        return;
      }
      const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        writeJson(response, 415, errorBody("UNSUPPORTED_MEDIA_TYPE", "The retry request must use application/json."), origin);
        return;
      }
      let body: unknown;
      try {
        body = await readJsonBody(request, maxBodyBytes);
      } catch (error) {
        const code = error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE"
          ? "REQUEST_BODY_TOO_LARGE"
          : "INVALID_REQUEST_BODY";
        writeJson(response, 422, errorBody(code, "The request body is invalid."), origin);
        return;
      }
      if (!validRetryBody(body)) {
        writeJson(response, 422, errorBody("VALIDATION_ERROR", "A retry reason between 1 and 500 characters is required."), origin);
        return;
      }
      const status = await options.statusService.retry(tenant, jobId, {
        actorId: principal.subject,
        reason: body.reason.trim()
      });
      if (!status) {
        writeJson(response, 404, errorBody("JOB_NOT_FOUND_OR_NOT_RETRYABLE", "The job was not found or is not eligible for retry."), origin);
        return;
      }
      writeJson(response, 200, status, origin);
    } catch {
      writeJson(response, 500, errorBody("INTERNAL_ERROR", "The request could not be completed."), origin);
    }
  });
}
