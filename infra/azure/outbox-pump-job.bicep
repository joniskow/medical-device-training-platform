targetScope = 'resourceGroup'
param image string
resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {name:'mdt-personal-aca-private'}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {name:'mdt-personal-worker-id'}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {name:'mdtpersonalacr01'}
resource pump 'Microsoft.App/jobs@2024-03-01' = {
 name:'mdt-personal-outbox-pump'
 location:'centralus'
 tags:{project:'medical-device-training',environment:'personal',component:'outbox-pump'}
 identity:{type:'UserAssigned',userAssignedIdentities:{'${identity.id}':{}}}
 properties:{
  environmentId:managedEnvironment.id
  configuration:{
   triggerType:'Schedule'
   replicaTimeout:55
   replicaRetryLimit:0
   scheduleTriggerConfig:{cronExpression:'* * * * *',parallelism:1,replicaCompletionCount:1}
   registries:[{server:registry.properties.loginServer,identity:identity.id}]
   secrets:[
    {name:'outbox-password',keyVaultUrl:'https://mdtpersonalkv01${environment().suffixes.keyvaultDns}/secrets/postgres-outbox-password',identity:identity.id}
    {name:'signing-secret',keyVaultUrl:'https://mdtpersonalkv01${environment().suffixes.keyvaultDns}/secrets/service-bus-signing-secret',identity:identity.id}
   ]
  }
  template:{containers:[{
   name:'outbox-pump'
   image:image
   resources:{cpu:json('0.25'),memory:'0.5Gi'}
   command:['node','--input-type=module','-e']
   args:[loadTextContent('../../tools/azure-outbox-pump.mjs')]
   env:[
    {name:'AZURE_CLIENT_ID',value:identity.properties.clientId}
    {name:'POSTGRES_OUTBOX_PASSWORD',secretRef:'outbox-password'}
    {name:'SERVICE_BUS_SIGNING_SECRET',secretRef:'signing-secret'}
   ]
  }]}
 }
}
