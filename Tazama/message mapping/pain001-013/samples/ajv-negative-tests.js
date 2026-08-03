const Ajv=require('/home/abdul-rahim/tazama/tms-service/node_modules/ajv');const fs=require('fs');
const S='/home/abdul-rahim/tazama/tms-service/src/schemas/';const D=__dirname+'/';
const ajv=new Ajv({removeAdditional:'all',useDefaults:true,coerceTypes:'array',strictTuples:false,strict:false});
const v1=ajv.compile(JSON.parse(fs.readFileSync(S+'pain.001.json')));
const v13=ajv.compile(JSON.parse(fs.readFileSync(S+'pain.013.json')));
const b1=()=>JSON.parse(fs.readFileSync(D+'tazama_pain001.json'));
const b13=()=>JSON.parse(fs.readFileSync(D+'tazama_pain013.json'));
function t(name,p,v){const ok=v(p);console.log(`${ok?'PASS':'FAIL'}  ${name}`);if(!ok)console.log('        ->',v.errors[0].instancePath,v.errors[0].message);return p;}
let p;
p=b1(); p.TenantId='cch-tenant-1'; t('pain001 WITH TenantId (expect FAIL)',p,v1);
p=b1(); delete p.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.SplmtryData; t('pain001 without CdtTrfTxInf.SplmtryData (expect FAIL)',p,v1);
p=b1(); delete p.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.Amt.EqvtAmt; t('pain001 without EqvtAmt (expect FAIL)',p,v1);
p=b1(); p.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.PmtId.InstrId='01K7EV9X2K4F8J90ZWMRHDNCZN'; p=t('pain001 with PmtId.InstrId (not in schema)',p,v1);
  console.log('        InstrId survived?',('InstrId' in p.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf.PmtId));
p=b13(); delete p.CdtrPmtActvtnReq.PmtInf.XpryDt; t('pain013 without XpryDt (expect FAIL)',p,v13);
p=b13(); p.CdtrPmtActvtnReq.PmtInf.CdtTrfTxInf.Amt.EqvtAmt.XchgRateInf={UnitCcy:'MWK',XchgRate:60};
  p=t('pain013 with XchgRateInf (not in pain.013 schema)',p,v13);
  console.log('        XchgRateInf survived?',('XchgRateInf' in p.CdtrPmtActvtnReq.PmtInf.CdtTrfTxInf.Amt.EqvtAmt));
p=b13(); delete p.CdtrPmtActvtnReq.PmtInf.CdtTrfTxInf.SplmtryData.Envlp.Doc.PyeeRcvAmt; t('pain013 without PyeeRcvAmt (expect FAIL)',p,v13);
