targetScope = 'resourceGroup'
param location string = 'centralus'
param name string = 'mdt-personal-learning-smoke'
param image string
resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {name:'mdt-personal-aca-private'}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {name:'mdt-personal-worker-id'}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {name:'mdtpersonalacr01'}
var vault='https://mdtpersonalkv01${environment().suffixes.keyvaultDns}/secrets/'
var secretMap=[
 {name:'runtime-password',vaultName:'postgres-runtime-password',variable:'POSTGRES_RUNTIME_PASSWORD'}
 {name:'embedding-key',vaultName:'azure-embedding-api-key',variable:'AZURE_EMBEDDING_API_KEY'}
 {name:'speech-key',vaultName:'azure-speech-key',variable:'AZURE_SPEECH_API_KEY'}
 {name:'provider-key',vaultName:'openmontage-provider-key',variable:'OPENMONTAGE_PROVIDER_API_KEY'}
]
var secretEnvironment=[for item in secretMap:{name:item.variable,secretRef:item.name}]
resource smoke 'Microsoft.App/jobs@2024-03-01' = {
 name:name
 location:location
 identity:{type:'UserAssigned',userAssignedIdentities:{'${identity.id}':{}}}
 properties:{
  environmentId:managedEnvironment.id
  configuration:{
   triggerType:'Manual'
   replicaTimeout:600
   replicaRetryLimit:0
   manualTriggerConfig:{parallelism:1,replicaCompletionCount:1}
   registries:[{server:registry.properties.loginServer,identity:identity.id}]
   secrets:[for item in secretMap:{name:item.name,keyVaultUrl:'${vault}${item.vaultName}',identity:identity.id}]
  }
  template:{containers:[{
   name:'smoke'
   image:image
   resources:{cpu:json('1.0'),memory:'2Gi'}
   command:['node','--input-type=module','-e']
   args:[loadTextContent('../../tools/smoke-azure-learning-services.mjs')]
   env:concat(secretEnvironment,[
    {name:'APP_ENV',value:'staging'}
    {name:'AZURE_CLIENT_ID',value:identity.properties.clientId}
    {name:'RETRIEVAL_MODE',value:'hybrid'}
    {name:'AZURE_EMBEDDING_ENDPOINT',value:'https://mdtpersonalai01.openai.azure.com/'}
    {name:'AZURE_EMBEDDING_DEPLOYMENT',value:'training-embedding'}
    {name:'AZURE_EMBEDDING_MODEL',value:'text-embedding-3-small'}
    {name:'AZURE_SPEECH_MODE',value:'http'}
    {name:'AZURE_SPEECH_ENDPOINT',value:'https://centralus.tts.speech.microsoft.com/cognitiveservices/v1'}
    {name:'OPENMONTAGE_PROVIDER_MODE',value:'http'}
    {name:'OPENMONTAGE_PROVIDER_URL',value:'https://mdt-personal-video.bluebeach-5048303a.centralus.azurecontainerapps.io/generate'}
   ])
  }]}
 }
}
