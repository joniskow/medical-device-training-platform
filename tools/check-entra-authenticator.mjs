import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createEntraRequestAuthenticator } from "../apps/api/dist/entra-authenticator.js";

const tenantId = "7d46aa07-85c8-4b7a-81d3-320765424537";
const issuer = "https://login.example.test/tenant/v2.0";
const audience = "api://medical-device-training";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" });
const now = Math.floor(Date.now() / 1000);

function base64Url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

function makeToken(overrides = {}) {
  const header = { alg: "RS256", typ: "JWT", kid: "key-1" };
  const claims = {
    iss: issuer,
    aud: audience,
    tid: tenantId,
    oid: "user-1",
    roles: ["operator"],
    nbf: now - 10,
    exp: now + 300,
    ...overrides
  };
  const encoded = `${base64Url(header)}.${base64Url(claims)}`;
  return `${encoded}.${sign("RSA-SHA256", Buffer.from(encoded), privateKey).toString("base64url")}`;
}

const authenticator = createEntraRequestAuthenticator({
  tenantId,
  audience,
  openIdConfigurationUrl: "https://login.example.test/.well-known/openid-configuration",
  fetchImpl: async (url) => {
    if (url.includes("openid-configuration")) return new Response(JSON.stringify({ issuer, jwks_uri: "https://login.example.test/keys" }), { status: 200 });
    return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "key-1", alg: "RS256", use: "sig" }] }), { status: 200 });
  }
});

const valid = await authenticator.authenticate({ headers: { authorization: `Bearer ${makeToken()}` } });
assert.deepEqual(valid, { subject: "user-1", issuer, identityTenant:tenantId, roles: ["operator"] });

const wrongAudience = await authenticator.authenticate({ headers: { authorization: `Bearer ${makeToken({ aud: "wrong-audience" })}` } });
assert.equal(wrongAudience, null);

const missingOrganizationClaim = await authenticator.authenticate({ headers: { authorization: `Bearer ${makeToken({ organization_id: "" })}` } });
assert.deepEqual(missingOrganizationClaim, { subject: "user-1", issuer, identityTenant:tenantId, roles: ["operator"] });

const tampered = `${makeToken()}.tampered`;
assert.equal(await authenticator.authenticate({ headers: { authorization: `Bearer ${tampered}` } }), null);

const identity=claims=>authenticator.authenticate({headers:{authorization:`Bearer ${makeToken(claims)}`}});
assert.equal((await identity({email:' Candidate@Example.test ',email_verified:true})).verifiedEmail,'candidate@example.test');
assert.equal((await identity({email:'candidate@example.test',email_verified:true})).verificationExpiresAt,new Date((now+300)*1000).toISOString());
assert.equal((await identity({email:'candidate@example.test',email_verified:false})).verificationExpiresAt,undefined);
for(const email_verified of [undefined,false,'true',1,null])assert.equal((await identity({email:'candidate@example.test',email_verified})).verifiedEmail,undefined);
for(const email of [undefined,[],{},'invalid','a b@example.test','x'.repeat(255)+'@example.test'])assert.equal((await identity({email,email_verified:true})).verifiedEmail,undefined);
assert.equal((await identity({preferred_username:'candidate@example.test',upn:'candidate@example.test',email_verified:true})).verifiedEmail,undefined);
assert.equal(await identity({email:'candidate@example.test',email_verified:true,aud:'wrong'}),null);

console.log("Entra authenticator passed: issuer, audience, tenant, optional organization claim, role extraction, and signature validation.");
