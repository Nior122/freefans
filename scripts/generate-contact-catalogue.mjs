#!/usr/bin/env node
/** Generate the non-sensitive profile catalogue used by the Telegram bot. */
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR, readProfiles } from './lib/site.mjs';
const file=path.join(PUBLIC_DIR,'contact-catalogue.json');
const profiles=readProfiles().filter(p=>p.isVisible&&/^[A-Za-z0-9._-]{1,50}$/.test(p.id)).reduce((out,p)=>{if(!out.some(x=>x.id===p.id))out.push({id:p.id,name:String(p.name||p.id).slice(0,120)});return out},[]);
fs.mkdirSync(PUBLIC_DIR,{recursive:true});
fs.writeFileSync(file,JSON.stringify({version:1,generatedAt:new Date().toISOString(),profiles},null,2)+'\n','utf8');
console.log(`[contact-catalogue] Wrote ${profiles.length} visible profiles`);
