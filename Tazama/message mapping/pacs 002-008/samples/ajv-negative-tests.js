const Ajv=require('/home/abdul-rahim/tazama/tms-service/node_modules/ajv');const fs=require('fs');
const S='/home/abdul-rahim/tazama/tms-service/src/schemas/';const D=__dirname+'/';
const ajv=new Ajv({removeAdditional:'all',useDefaults:true,coerceTypes:'array',strictTuples:false,strict:false});
const v8=ajv.compile(JSON.parse(fs.readFileSync(S+'pacs.008.json')));
const v2=ajv.compile(JSON.parse(fs.readFileSync(S+'pacs.002.json')));
const base8=()=>JSON.parse(fs.readFileSync(D+'tazama_pacs008.json'));
const base2=()=>JSON.parse(fs.readFileSync(D+'tazama_pacs002.json'));
function t(name,p,v){const ok=v(p);console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)console.log('        ->',v.errors[0].instancePath,v.errors[0].message);return p;}
let p;
p=base8(); p.TenantId='cch-tenant-1'; t('pacs008 WITH TenantId (expect FAIL)',p,v8);
p=base8(); p.FIToFICstmrCdtTrf.GrpHdr.NbOfTxs='1'; p=t('pacs008 NbOfTxs as string "1"',p,v8); console.log('        NbOfTxs after ajv:',JSON.stringify(p.FIToFICstmrCdtTrf.GrpHdr.NbOfTxs));
p=base8(); p.FIToFICstmrCdtTrf.CdtTrfTxInf.IntrBkSttlmAmt.Amt.Amt='1'; p=t('pacs008 amount as string "1"',p,v8); console.log('        Amt after ajv:',JSON.stringify(p.FIToFICstmrCdtTrf.CdtTrfTxInf.IntrBkSttlmAmt.Amt.Amt));
p=base8(); p.FIToFICstmrCdtTrf.CdtTrfTxInf.VrfctnOfTerms={IlpV4PrepPacket:'DIIC0Q...'}; p=t('pacs008 with VrfctnOfTerms (FSD v1_1 shape)',p,v8); console.log('        VrfctnOfTerms survived?',('VrfctnOfTerms' in p.FIToFICstmrCdtTrf.CdtTrfTxInf));
p=base8(); delete p.FIToFICstmrCdtTrf.RgltryRptg; t('pacs008 without RgltryRptg (expect FAIL)',p,v8);
p=base2(); p.FIToFIPmtSts.TxInfAndSts.TxSts='COMMITTED'; t('pacs002 TxSts="COMMITTED" (raw Mojaloop)',p,v2);
p=base2(); delete p.FIToFIPmtSts.TxInfAndSts.ChrgsInf; t('pacs002 without ChrgsInf (expect FAIL)',p,v2);
p=base2(); p.FIToFIPmtSts.TxInfAndSts.ChrgsInf=[]; t('pacs002 ChrgsInf empty array',p,v2);
