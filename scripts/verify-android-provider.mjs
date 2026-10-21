import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const requireCondition=(condition,message)=>{if(!condition)throw Error(message);};
const clean=xml=>String(xml).replace(/<!--[\s\S]*?-->/g,'');
const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/gs)].map(match=>[match[1],match[3]]));
const openingTag=node=>node.slice(0,node.indexOf('>')+1);
const nodes=(xml,name)=>[...xml.matchAll(new RegExp('<'+name+'\\b[^>]*?(?:/\\s*>|>[\\s\\S]*?</'+name+'\\s*>)','g'))].map(match=>match[0]);

function verifyPathsResource(reference,resourcesDump,appId){
  const symbolic=['@xml/qatfah_wa_paths','@'+appId+':xml/qatfah_wa_paths'].includes(reference);
  let resourceId=null;
  const hex=String(reference).match(/^@(?:ref\/)?(?:0x)?([0-9a-f]{8})$/i);
  const decimal=String(reference).match(/^@(\d{9,10})$/);
  if(hex)resourceId=Number.parseInt(hex[1],16);
  else if(decimal)resourceId=Number.parseInt(decimal[1],10);
  requireCondition(symbolic||resourceId!==null,'Attachment provider must bind @xml/qatfah_wa_paths');
  if(!resourcesDump){
    requireCondition(symbolic,'Numeric metadata requires the final APK resources dump');
    return;
  }
  // aapt2 dump resources prints a package header, followed by each resource ID,
  // type/name and its (file) value. Match all three before accepting an ID.
  const matches=[];
  let packageName='',entry=null;
  for(const line of String(resourcesDump).split(/\r?\n/)){
    const packageLine=line.match(/^\s*Package name=(\S+)(?:\s|$)/);
    if(packageLine){packageName=packageLine[1];entry=null;continue;}
    const resourceLine=line.match(/^\s*resource\s+(0x[0-9a-f]{8})\s+(\S+)/i);
    if(resourceLine){
      entry=null;
      if(packageName===appId&&['xml/qatfah_wa_paths',appId+':xml/qatfah_wa_paths'].includes(resourceLine[2])){
        entry={id:Number.parseInt(resourceLine[1],16),files:[]};matches.push(entry);
      }
      continue;
    }
    if(/^\s*type\s/.test(line)){entry=null;continue;}
    if(entry){
      const file=line.match(/\(file\)\s+(\S+)/);
      if(file)entry.files.push(file[1]);
    }
  }
  requireCondition(matches.length===1,'Final APK must have one xml/qatfah_wa_paths resource in the application package');
  const match=matches[0];
  requireCondition(symbolic||match.id===resourceId,'Attachment metadata resource ID does not resolve to xml/qatfah_wa_paths');
  requireCondition(match.files.length>0&&match.files.every(file=>file==='res/xml/qatfah_wa_paths.xml'),'Attachment resource must resolve only to res/xml/qatfah_wa_paths.xml');
}

/** Verify decoded APK XML, after Android's actual manifest/resource merge. */
export function verifyAndroidProvider(manifestXml,pathsXml,expectedAppId='com.qatfah.accounting',resourcesDump=''){
  const manifest=clean(manifestXml),paths=clean(pathsXml);
  const appId=attributes(manifest.match(/<manifest\b[^>]*>/)?.[0]||'').package;
  requireCondition(appId===expectedAppId,'Unexpected APK package: '+(appId||'missing'));
  const providers=nodes(manifest,'provider').map(node=>({node,attrs:attributes(openingTag(node))}));
  const authority=appId+'.waattachments';
  const providerName='com.qatfah.accounting.QatfahAttachmentProvider';
  const ours=providers.filter(({attrs})=>attrs['android:authorities']?.split(';').includes(authority)||attrs['android:name']===providerName||attrs['android:name']==='.QatfahAttachmentProvider');
  requireCondition(ours.length===1,'Expected exactly one WhatsApp attachment provider');
  const {node,attrs}=ours[0];
  requireCondition(attrs['android:name']===providerName||attrs['android:name']==='.QatfahAttachmentProvider','Attachment provider must have its own class identity');
  requireCondition(attrs['android:authorities']===authority,'Attachment provider authority does not match native getUriForFile');
  requireCondition(attrs['android:exported']==='false','Attachment provider must not be exported');
  requireCondition(attrs['android:grantUriPermissions']==='true','Attachment provider must grant temporary URI permissions');
  const metadata=nodes(node,'meta-data').map(value=>attributes(openingTag(value))).filter(value=>value['android:name']==='android.support.FILE_PROVIDER_PATHS');
  requireCondition(metadata.length===1,'Attachment provider is missing unique paths metadata');
  verifyPathsResource(metadata[0]['android:resource'],resourcesDump,appId);
  const capacitor=providers.filter(({attrs:value})=>value['android:authorities']===appId+'.fileprovider');
  requireCondition(capacitor.length===1&&capacitor[0].attrs['android:name']==='androidx.core.content.FileProvider','Capacitor FileProvider must remain registered separately');
  requireCondition(capacitor[0].attrs['android:exported']==='false'&&capacitor[0].attrs['android:grantUriPermissions']==='true','Capacitor FileProvider permissions changed');
  const pathNodes=[...paths.matchAll(/<([\w-]+)\b[^>]*>/g)];
  requireCondition(pathNodes.length===2&&pathNodes[0][1]==='paths'&&pathNodes[1][1]==='cache-path','Attachment provider must expose only one cache directory');
  const scoped=attributes(pathNodes[1][0]);
  requireCondition(scoped.name==='wa-attachments'&&scoped.path==='wa-attachments/','Attachment path must be limited to cache/wa-attachments/');
  return {appId,authority,provider:providerName,path:'cache/wa-attachments/'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [manifest,paths,appId,resources]=process.argv.slice(2);
  if(!manifest||!paths)throw Error('Use: node scripts/verify-android-provider.mjs decoded-manifest.xml decoded-paths.xml [applicationId] [resources-dump.txt]');
  console.log(JSON.stringify(verifyAndroidProvider(fs.readFileSync(manifest,'utf8'),fs.readFileSync(paths,'utf8'),appId,resources?fs.readFileSync(resources,'utf8'):'')));
}
