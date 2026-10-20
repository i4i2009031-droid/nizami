import { writeFile } from 'node:fs/promises';
const app=process.argv[2];
if(!['client','admin'].includes(app))throw new Error('Use client or admin');
const client=app==='client';
const config={
  appId: client?'com.qatfah.accounting':'com.qatfah.admin',
  appName: client?'قطفة':'قطفة للإدارة',
  webDir: 'dist/'+app,
  bundledWebRuntime:false,
  plugins: {
    SplashScreen:{launchShowDuration:900,backgroundColor:'#F8FAFC',androidScaleType:'CENTER_CROP'},
    StatusBar:{style:'LIGHT',backgroundColor:'#F8FAFC'}
  }
};
await writeFile('capacitor.config.json',JSON.stringify(config,null,2));
