import QRCode from 'qrcode';

export async function renderVerificationQr(canvas:HTMLCanvasElement,link:string):Promise<void>{
  const url=new URL(link);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))
    ||url.pathname!=='/verify'||url.hash||url.username||url.password||[...url.searchParams.keys()].length!==1
    ||!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('credential')??''))throw Error('Invalid public verification URL');
  await QRCode.toCanvas(canvas,url.href,{errorCorrectionLevel:'M',margin:4,width:256,color:{dark:'#000000',light:'#ffffff'}});
}
