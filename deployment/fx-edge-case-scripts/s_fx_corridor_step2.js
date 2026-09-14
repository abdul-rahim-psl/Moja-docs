/* FX corridor happy path, step 2 (proven fix): commitRequestId on the
 * fxTransfers prepare MUST equal the original fxQuote's conversionId — the
 * FXP SDK's InboundTransfersModel.postFxTransfers() looks up its cached
 * fxState via loadFxState(body.commitRequestId), keyed on conversionId
 * (see its own "todo: assume commitRequestId ... should be same as
 * conversionTerms.conversionId" comment). A fresh random commitRequestId
 * misses that cache -> "2001 Internal server error" (confirmed earlier). */
const CONVERSION_ID = '01M2FKW5Y1WN0RY4XYR02WKT84';
const DETERMINING_TRANSFER_ID = '01M2FKW5Y2ND3SP5JZ8W3802ZQ';
const FX_CONDITION = 'gPnwcHM6CnbYXAp78GICDd5-YqOEKYFZJVIM6L68FDM';

(async () => {
  const commitRequestId = CONVERSION_ID;
  const fxExpiration = isoDate(5 * 60 * 1000);
  const fxtHdrs = headers('fxTransfers', PAYER, FXP);
  const fxtIso = await TransformFacades.FSPIOP.fxTransfers.post({
    body: {
      commitRequestId, determiningTransferId: DETERMINING_TRANSFER_ID,
      initiatingFsp: PAYER, counterPartyFsp: FXP, amountType: 'SEND',
      sourceAmount: { currency: SRC_CCY, amount: '100' },
      targetAmount: { currency: TGT_CCY, amount: '200' },
      condition: FX_CONDITION, expiration: fxExpiration,
    },
    headers: fxtHdrs,
  });
  report('POST /fxTransfers (commitRequestId=' + commitRequestId + ')',
         await send({ svc: 'mlapi', method: 'POST', path: '/fxTransfers', headers: fxtHdrs, body: fxtIso.body }));

  console.log('\nwaiting 10s for FXP auto-fulfil...');
  await sleep(10000);
  await positions('positions after fxTransfer');
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
