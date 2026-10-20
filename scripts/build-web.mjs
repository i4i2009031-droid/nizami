import { mkdir, rm, cp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const target = process.argv[2];
for (const app of (target ? [target] : ['client', 'admin'])) {
 if (!['client','admin'].includes(app)) throw new Error('Unknown app');
 const src=resolve('apps',app), dest=resolve('dist',app);
 await rm(dest,{recursive:true,force:true}); await mkdir(dest,{recursive:true}); await cp(src,dest,{recursive:true,force:true});
 const cfg = {apiBase:process.env.QATFAH_API_BASE || ''};
 await writeFile(resolve(dest,'config.json'),JSON.stringify(cfg));
 console.log('Built',app,dest);
}
