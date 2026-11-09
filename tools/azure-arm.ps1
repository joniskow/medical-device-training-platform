$ErrorActionPreference='Stop'
$script:AzureArmToken=(& az account get-access-token --resource https://management.azure.com/ --query accessToken --output tsv)
if($LASTEXITCODE -ne 0 -or -not $script:AzureArmToken){throw 'AZURE_AUTHENTICATION_REQUIRED'}
function Invoke-AzureArm([string]$Method,[string]$Path,$Body=$null){
 $uri='https://management.azure.com'+$Path
 $parameters=@{Uri=$uri;Method=$Method;Headers=@{Authorization="Bearer $script:AzureArmToken"};ContentType='application/json';TimeoutSec=60;UseBasicParsing=$true}
 if($null -ne $Body){$parameters.ContentType='application/json';$parameters.Body=$Body | ConvertTo-Json -Depth 60 -Compress}
 for($attempt=0;$attempt -lt 3;$attempt++){
  try{return Invoke-RestMethod @parameters}catch{
   if($Method -ne 'GET' -or $attempt -eq 2){
    $status=if($_.Exception.Response){[int]$_.Exception.Response.StatusCode}else{0}
    $code='UNKNOWN'
    try{$failure=$_.ErrorDetails.Message|ConvertFrom-Json;$candidate=if($failure.error){$failure.error.code}else{$failure.code};if($candidate -match '^[A-Za-z0-9_.-]{1,100}$'){$code=$candidate}}catch{}
    throw "AZURE_ARM_REQUEST_FAILED:$Method`:HTTP_$status`:$code"
   }
   Start-Sleep -Seconds 2
  }
 }
}
