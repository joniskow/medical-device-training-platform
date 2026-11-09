targetScope = 'resourceGroup'
param location string = resourceGroup().location
param environmentName string
param managedEnvironmentName string
param containerRegistryName string
param probeImage string
param apiReadinessUrl string
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {name:managedEnvironmentName}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {name:containerRegistryName}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {name:'mdt-${environmentName}-probe-id',location:location}
resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name:guid(registry.id,identity.id,'probe-pull')
  scope:registry
  properties:{roleDefinitionId:subscriptionResourceId('Microsoft.Authorization/roleDefinitions','7f951dda-4ed3-4680-a7ca-43fe172d538d'),principalId:identity.properties.principalId,principalType:'ServicePrincipal'}
}
resource probe 'Microsoft.App/jobs@2024-03-01' = {
  name:'mdt-${environmentName}-api-probe'
  location:location
  dependsOn:[pull]
  identity:{type:'UserAssigned',userAssignedIdentities:{'${identity.id}':{}}}
  properties:{
    environmentId:environment.id
    configuration:{triggerType:'Schedule',replicaTimeout:20,replicaRetryLimit:0,scheduleTriggerConfig:{cronExpression:'*/5 * * * *',parallelism:1,replicaCompletionCount:1},registries:[{server:registry.properties.loginServer,identity:identity.id}]}
    template:{containers:[{
      name:'api-probe'
      image:probeImage
      command:['node','-e']
      args:['fetch(process.env.API_READINESS_URL,{signal:AbortSignal.timeout(10000),redirect:"error"}).then(r=>{console.log(JSON.stringify({event:"api_probe",service:"probe",status:r.status,ready:r.status===200}));process.exitCode=r.status===200?0:1;}).catch(()=>{console.log(JSON.stringify({event:"api_probe",service:"probe",status:0,ready:false}));process.exitCode=1;})']
      env:[{name:'API_READINESS_URL',value:apiReadinessUrl}]
      resources:{cpu:json('0.25'),memory:'0.5Gi'}
    }]}
  }
}
