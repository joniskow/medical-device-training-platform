$ErrorActionPreference='Stop'
$root=Join-Path $PSScriptRoot '../output/deployment/learning-20261107-212245'
$subscription='e30f800a-473e-4040-9622-6ea38413c991'
$group='rg-medical-device-personal'
$identityBase="/subscriptions/$subscription/resourceGroups/$group/providers/Microsoft.ManagedIdentity/userAssignedIdentities"
$suffix='learning-'+(Get-Date).ToUniversalTime().ToString('MMddHHmmss')
function Set-Environment($container,[hashtable]$values){
 $map=@{};foreach($item in $container.env){$map[$item.name]=$item}
 foreach($name in $values.Keys){$map[$name]=[pscustomobject]@{name=$name;value=[string]$values[$name]}}
 $container.env=@($map.Values | Sort-Object name)
}
function Add-Secret($configuration,$container,[string]$name,[string]$environmentName,[string]$vaultName,[string]$identity){
 $configuration.secrets=@($configuration.secrets | Where-Object name -ne $name)+[pscustomobject]@{name=$name;keyVaultUrl="https://mdtpersonalkv01.vault.azure.net/secrets/$vaultName";identity=$identity}
 $container.env=@($container.env | Where-Object name -ne $environmentName)+[pscustomobject]@{name=$environmentName;secretRef=$name}
}
foreach($kind in @('api','worker')){
 $app=az containerapp show -g $group -n "mdt-personal-$kind" -o json | ConvertFrom-Json
 if($LASTEXITCODE -ne 0){throw 'APP_CONFIGURATION_UNAVAILABLE'}
 foreach($secret in $app.properties.configuration.secrets){if($secret.value){throw 'INLINE_SECRET_CANNOT_BE_SNAPSHOTTED'}}
 foreach($container in $app.properties.template.containers){foreach($item in $container.env){if($item.name -match '(PASSWORD|API_KEY|SECRET|TOKEN_KEYS)' -and $item.value){throw 'INLINE_SECRET_CANNOT_BE_SNAPSHOTTED'}}}
 $configuration=$app.properties.configuration
 if($configuration.ingress){$configuration.ingress.PSObject.Properties.Remove('fqdn')}
 $payload=[pscustomobject]@{name=$app.name;location=$app.location;identity=$app.identity;tags=$app.tags;properties=[pscustomobject]@{managedEnvironmentId=$app.properties.environmentId;configuration=$configuration;template=$app.properties.template}}
 $payload | ConvertTo-Json -Depth 45 | Set-Content (Join-Path $root "$kind-rollback.json")
 $container=$payload.properties.template.containers | Where-Object name -eq $kind
 $payload.properties.template | Add-Member -NotePropertyName revisionSuffix -NotePropertyValue $suffix -Force
 $identity="$identityBase/mdt-personal-$kind-id"
 Set-Environment $container @{
  APP_ENV='staging';AUDIT_LOGGING_ENABLED='true';RETRIEVAL_MODE='hybrid';AZURE_EMBEDDING_ENDPOINT='https://mdtpersonalai01.openai.azure.com/';AZURE_EMBEDDING_DEPLOYMENT='training-embedding';AZURE_EMBEDDING_MODEL='text-embedding-3-small';EMBEDDING_MAX_RUN_COST_CENTS='10'
 }
 Add-Secret $configuration $container 'operational-key' 'OPERATIONAL_KEY_SECRET' 'operational-key-secret' $identity
 Add-Secret $configuration $container 'embedding-key' 'AZURE_EMBEDDING_API_KEY' 'azure-embedding-api-key' $identity
 if($kind -eq 'api'){
  Add-Secret $configuration $container 'azure-openai-key' 'AZURE_OPENAI_API_KEY' 'azure-embedding-api-key' $identity
  $container.image='mdtpersonalacr01.azurecr.io/api@sha256:56c37d504ccaf3ebbd7e3c095d73b54a14a4f9453d18ba5fa91f10a82896486e'
  Set-Environment $container @{AI_PROMPT_VERSION='learning-modules.v2';AI_MAX_OUTPUT_TOKENS='4000';AI_MAX_RUN_COST_CENTS='100'}
  $payload.properties.template.scale.minReplicas=0;$payload.properties.template.scale.maxReplicas=1
 }else{
  $container.image='mdtpersonalacr01.azurecr.io/worker@sha256:0e88f018ba5ee7ddc11f3b08b8a54b5673ef1ac0179101de0e869cc207c5dc73'
  $container.resources=[pscustomobject]@{cpu=2.0;memory='4Gi'}
  Set-Environment $container @{RUN_DATABASE_MIGRATIONS='false';SEED_PILOT_MEMBERSHIP='false';ASSET_SCANNER_MODE='clamav';CLAMAV_HOST='127.0.0.1';CLAMAV_PORT='3310';OPENMONTAGE_PROVIDER_MODE='http';OPENMONTAGE_PROVIDER_URL='https://mdt-personal-video.bluebeach-5048303a.centralus.azurecontainerapps.io/generate';AZURE_SPEECH_MODE='http';AZURE_SPEECH_ENDPOINT='https://centralus.tts.speech.microsoft.com/cognitiveservices/v1';WORKER_MAX_CONCURRENT_CALLS='1';ASSET_MAX_RUN_COST_CENTS='100';RECONSTRUCTION_MAX_RUN_COST_CENTS='500';VIDEO_MAX_RUN_COST_CENTS='100';LESSON_MAX_RUN_COST_CENTS='100';RECONSTRUCTION_SINGLE_IMAGE_ENABLED='false';PHOTOGRAMMETRY_FFMPEG='/usr/bin/ffmpeg';PHOTOGRAMMETRY_FFPROBE='/usr/bin/ffprobe'}
  $container.env=@($container.env | Where-Object name -notin @('POSTGRES_ADMIN_PASSWORD','POSTGRES_ADMIN_LOGIN','PILOT_SUBJECT','PILOT_ORGANIZATION_ID'))
  Add-Secret $configuration $container 'speech-key' 'AZURE_SPEECH_API_KEY' 'azure-speech-key' $identity
  Add-Secret $configuration $container 'video-provider-key' 'OPENMONTAGE_PROVIDER_API_KEY' 'openmontage-provider-key' $identity
  $wait=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'azure-worker-start.mjs'))
  $container | Add-Member -NotePropertyName command -NotePropertyValue @('node','--input-type=module','-e') -Force
  $container | Add-Member -NotePropertyName args -NotePropertyValue @($wait) -Force
  $scanner=[pscustomobject]@{name='scanner';image='mdtpersonalacr01.azurecr.io/scanner@sha256:10f72f0e9304ffaa458d0fa6d595af25b750fde9d19736c12d6c725578373daf';resources=@{cpu=1.0;memory='2Gi'};env=@(@{name='CLAMAV_NO_FRESHCLAMD';value='false'},@{name='CLAMAV_NO_MILTERD';value='true'});probes=@(@{type='Startup';tcpSocket=@{port=3310};initialDelaySeconds=10;periodSeconds=10;timeoutSeconds=3;failureThreshold=60},@{type='Readiness';tcpSocket=@{port=3310};periodSeconds=10;timeoutSeconds=3;failureThreshold=3})}
  $payload.properties.template.containers=@($container,$scanner)
  $payload.properties.template.scale=[pscustomobject]@{minReplicas=0;maxReplicas=1;cooldownPeriod=60;pollingInterval=30;rules=@(@{name='idle-maintenance';custom=@{type='cron';metadata=@{timezone='Etc/UTC';start='0 * * * *';end='2 * * * *';desiredReplicas='1'}}},@{name='queued-work';custom=@{type='azure-servicebus';metadata=@{namespace='mdt-personal-sb-01';queueName='asset-processing';messageCount='1'};identity=$identity}})}
 }
 $payload | ConvertTo-Json -Depth 45 | Set-Content (Join-Path $root "$kind-candidate.json")
 Write-Output "$kind candidate prepared; no credential values written."
}
