/** Restore PNG source assets from text (base64) in this repository. */
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const items=[['client-logo','apps/client/assets/logo.png'],['client-192','apps/client/assets/icon-192.png'],['client-512','apps/client/assets/icon-512.png'],['admin-192','apps/admin/assets/icon-192.png'],['admin-512','apps/admin/assets/icon-512.png']];
for(const [id,file] of items){const b64=(await readFile(resolve('assets/encoded/'+id+'.b64'),'utf8')).trim();await mkdir(dirname(file),{recursive:true});await writeFile(file,Buffer.from(b64,'base64'));console.log('Restored',file)}
await copyFile('apps/client/assets/logo.png','apps/admin/assets/logo.png');
