import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { TenantContext } from "@medical-device/contracts";

type RecordValue = Record<string, any>;
/** Materialize release-owned runtime records; author identifiers remain in the reviewed content. */
export async function publishSimulationRuntime(client: PoolClient, tenant: TenantContext, courseVersionId: string, releaseId: string, content: RecordValue): Promise<RecordValue> {
  if (!content.simulation?.definition) return content;
  const id = (kind: string, value: string) => `${kind}:${createHash("sha256").update(JSON.stringify([tenant.organizationId,releaseId,value])).digest("hex")}`;
  const simulationId=id("simulation",content.simulation.simulationDefinitionId);
  const policyId=id("policy",content.policy.policyId);
  const definition={...content.simulation.definition,simulationDefinitionId:simulationId};
  await client.query(`INSERT INTO simulation_definitions(simulation_definition_id,organization_id,version,definition,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4::jsonb,'PUBLISHED',$5,now(),now())`,[simulationId,tenant.organizationId,definition.version,JSON.stringify(definition),tenant.actorId]);
  await client.query(`INSERT INTO certification_policies(policy_id,organization_id,course_version_id,version,policy,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,'PUBLISHED',now(),now())`,[policyId,tenant.organizationId,courseVersionId,content.policy.version,JSON.stringify({...content.policy,policyId})]);
  const bindings: RecordValue[]=[];
  const seen=new Set<string>();
  const modules=[];
  for (const [mi,module] of content.modules.entries()) {
    const moduleId=id("module",String(mi));
    const activities=[];
    for (const [ai,activity] of module.activities.entries()) {
      const runtimeActivityId=id("activity",`${mi}:${ai}`);
      const activityId=activity.activityId || runtimeActivityId;
      if (typeof activityId!=="string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(activityId) || seen.has(activityId)) throw new Error("RELEASE_ACTIVITY_ID_INVALID");
      seen.add(activityId);
      const simulationActivity=["simulation","simulation_outcome","fault_troubleshooting","guided_procedure","manipulation","assembly"].includes(activity.type);
      if (simulationActivity && activity.simulationDefinitionId && activity.simulationDefinitionId!==content.simulation.simulationDefinitionId) throw new Error("RELEASE_SIMULATION_BINDING_INVALID");
      const projected={...activity,activityId};activities.push(projected);
      bindings.push({activityId,runtimeActivityId,...(simulationActivity ? {simulationDefinitionId:simulationId,policyId} : {})});
    }
    const projectedModule={...module,moduleId:module.moduleId || moduleId,activities};modules.push(projectedModule);
    await client.query(`INSERT INTO modules(module_id,organization_id,course_version_id,position,content,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,now(),now())`,[moduleId,tenant.organizationId,courseVersionId,mi,JSON.stringify(projectedModule)]);
    for (const [ai,activity] of activities.entries()) {
      const binding=bindings.find(item=>item.activityId===activity.activityId)!;
      await client.query(`INSERT INTO activities(activity_id,organization_id,module_id,activity_type,position,content,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,now(),now())`,[binding.runtimeActivityId,tenant.organizationId,moduleId,activity.type.toUpperCase(),ai,JSON.stringify({...activity,...(binding.simulationDefinitionId?{simulationDefinitionId:binding.simulationDefinitionId}:{})})]);
    }
  }
  return {...content,modules,runtimeBindings:{schemaVersion:"course-runtime.v1",simulationDefinitionId:simulationId,policyId,activities:bindings}};
}
