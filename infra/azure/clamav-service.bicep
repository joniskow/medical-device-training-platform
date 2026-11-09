targetScope = 'resourceGroup'
param location string = resourceGroup().location
param name string
param managedEnvironmentName string
param scannerIdentityName string
param containerRegistryName string
@description('Immutable digest of Dockerfile.scanner built from an approved supported official ClamAV release.')
param image string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {name:managedEnvironmentName}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {name:containerRegistryName}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {name:scannerIdentityName,location:location}
resource imageReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name:guid(identity.id,registry.id,'scanner-pull')
  scope:registry
  properties:{roleDefinitionId:subscriptionResourceId('Microsoft.Authorization/roleDefinitions','7f951dda-4ed3-4680-a7ca-43fe172d538d'),principalId:identity.properties.principalId,principalType:'ServicePrincipal'}
}
resource scanner 'Microsoft.App/containerApps@2024-03-01' = {
  name:name
  location:location
  dependsOn:[imageReader]
  identity:{type:'UserAssigned',userAssignedIdentities:{'${identity.id}':{}}}
  properties:{
    managedEnvironmentId:environment.id
    configuration:{
      activeRevisionsMode:'Single'
      ingress:{external:false,targetPort:3310,exposedPort:3310,transport:'tcp'}
      registries:[{server:registry.properties.loginServer,identity:identity.id}]
    }
    template:{
      containers:[{
        name:'scanner'
        image:image
        resources:{cpu:json('2.0'),memory:'4Gi'}
        env:[{name:'CLAMAV_NO_FRESHCLAMD',value:'false'},{name:'FRESHCLAM_CHECKS',value:'24'},{name:'CLAMD_STARTUP_TIMEOUT',value:'600'}]
        probes:[
          {type:'Startup',tcpSocket:{port:3310},initialDelaySeconds:10,periodSeconds:10,timeoutSeconds:3,failureThreshold:60}
          {type:'Readiness',tcpSocket:{port:3310},periodSeconds:10,timeoutSeconds:3,failureThreshold:2}
          {type:'Liveness',tcpSocket:{port:3310},periodSeconds:30,timeoutSeconds:3,failureThreshold:3}
        ]
      }]
      scale:{minReplicas:1,maxReplicas:1}
    }
  }
}
output clamavHost string = scanner.name
output clamavPort int = 3310
