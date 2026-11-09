targetScope = 'resourceGroup'
param location string = 'centralus'
param name string = 'mdt-personal-video'
param managedEnvironmentName string = 'mdt-personal-aca-private'
param identityName string = 'mdt-personal-video-id'
param keyVaultName string = 'mdtpersonalkv01'
param registryName string = 'mdtpersonalacr01'
param image string
@allowed(['draft','final'])
param backgroundDefaultProfile string = 'draft'
@allowed(['low','medium','high'])
param backgroundFinalQuality string = 'medium'
@allowed(['clinical','warm-learning','neutral-studio'])
param backgroundStyle string = 'clinical'
@allowed(['eye-level','seated','low-device'])
param backgroundCamera string = 'eye-level'
resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {name:managedEnvironmentName}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {name:identityName}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {name:registryName}
resource provider 'Microsoft.App/containerApps@2024-03-01' = {
 name:name
 location:location
 tags:{project:'medical-device-training',environment:'personal',component:'video-provider'}
 identity:{type:'UserAssigned',userAssignedIdentities:{'${identity.id}':{}}}
 properties:{
  managedEnvironmentId:managedEnvironment.id
  configuration:{
   activeRevisionsMode:'Single'
   ingress:{external:true,targetPort:8080,transport:'http',allowInsecure:false}
   registries:[{server:registry.properties.loginServer,identity:identity.id}]
   secrets:[
    {name:'image-key',keyVaultUrl:'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/azure-image-api-key',identity:identity.id}
    {name:'provider-key',keyVaultUrl:'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets/openmontage-provider-key',identity:identity.id}
   ]
  }
  template:{
   containers:[{
    name:'video-provider'
    image:image
    resources:{cpu:json('1.0'),memory:'2Gi'}
    env:[
     {name:'PORT',value:'8080'}
     {name:'AZURE_IMAGE_ENDPOINT',value:'https://mdtpersonalmedia01.openai.azure.com/'}
     {name:'AZURE_IMAGE_DEPLOYMENT',value:'training-background'}
     {name:'BACKGROUND_DEFAULT_PROFILE',value:backgroundDefaultProfile}
     {name:'BACKGROUND_FINAL_QUALITY',value:backgroundFinalQuality}
     {name:'BACKGROUND_STYLE',value:backgroundStyle}
     {name:'BACKGROUND_CAMERA',value:backgroundCamera}
     {name:'AZURE_IMAGE_API_KEY',secretRef:'image-key'}
     {name:'PROVIDER_API_KEY',secretRef:'provider-key'}
    ]
    probes:[
     {type:'Readiness',httpGet:{path:'/healthz',port:8080},periodSeconds:10,timeoutSeconds:3,failureThreshold:3}
     {type:'Liveness',httpGet:{path:'/healthz',port:8080},periodSeconds:30,timeoutSeconds:3,failureThreshold:3}
    ]
   }]
   scale:{minReplicas:0,maxReplicas:1,rules:[{name:'one-render',http:{metadata:{concurrentRequests:'1'}}}]}
  }
 }
}
output endpoint string = 'https://${provider.properties.configuration.ingress.fqdn}/generate'
