targetScope = 'resourceGroup'

param location string = resourceGroup().location
param jobName string
param managedEnvironmentName string
param migrationIdentityName string
param keyVaultName string
param containerRegistryName string
@description('Tested worker image immutable digest; contains /app/tools/migrate-database.mjs and /app/dist/postgres-bootstrap.js.')
param image string
param postgresHost string
param postgresAdminLogin string = 'mdtadmin'

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {name:managedEnvironmentName}
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {name:keyVaultName}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {name:containerRegistryName}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {name:migrationIdentityName,location:location}
var secretNames = ['postgres-admin-password','postgres-runtime-password','postgres-outbox-password']
resource secrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = [for secretName in secretNames: {parent:vault,name:secretName}]
resource secretReaders 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (secretName,i) in secretNames: {
  name:guid(identity.id,vault.id,secretName,'migration-reader')
  scope:secrets[i]
  properties:{roleDefinitionId:subscriptionResourceId('Microsoft.Authorization/roleDefinitions','4633458b-17de-408a-b874-0445c86b69e6'),principalId:identity.properties.principalId,principalType:'ServicePrincipal'}
}]
resource registryReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name:guid(identity.id,registry.id,'migration-image-reader')
  scope:registry
  properties:{roleDefinitionId:subscriptionResourceId('Microsoft.Authorization/roleDefinitions','7f951dda-4ed3-4680-a7ca-43fe172d538d'),principalId:identity.properties.principalId,principalType:'ServicePrincipal'}
}
resource migration 'Microsoft.App/jobs@2024-03-01' = {
  name:jobName
  location:location
  identity:{type:'UserAssigned',userAssignedIdentities:{'${identity.id}':{}}}
  dependsOn:[secretReaders,registryReader]
  properties:{
    environmentId:environment.id
    configuration:{
      triggerType:'Manual'
      replicaTimeout:900
      replicaRetryLimit:0
      manualTriggerConfig:{parallelism:1,replicaCompletionCount:1}
      registries:[{server:registry.properties.loginServer,identity:identity.id}]
      secrets:[for secretName in secretNames:{name:secretName,keyVaultUrl:'${vault.properties.vaultUri}secrets/${secretName}',identity:identity.id}]
    }
    template:{containers:[{
      name:'database-migration'
      image:image
      command:['node','tools/migrate-database.mjs']
      resources:{cpu:json('0.5'),memory:'1Gi'}
      env:[
        {name:'AZURE_CLIENT_ID',value:identity.properties.clientId}
        {name:'POSTGRES_HOST',value:postgresHost}
        {name:'POSTGRES_DATABASE',value:'medical_device'}
        {name:'MIGRATION_CONFIRM_DATABASE',value:'medical_device'}
        {name:'POSTGRES_ADMIN_LOGIN',value:postgresAdminLogin}
        {name:'POSTGRES_RUNTIME_LOGIN',value:'medical_device_runtime'}
        {name:'POSTGRES_ADMIN_PASSWORD',secretRef:'postgres-admin-password'}
        {name:'POSTGRES_RUNTIME_PASSWORD',secretRef:'postgres-runtime-password'}
        {name:'POSTGRES_OUTBOX_PASSWORD',secretRef:'postgres-outbox-password'}
      ]
    }]}
  }
}
output migrationJobName string = migration.name
