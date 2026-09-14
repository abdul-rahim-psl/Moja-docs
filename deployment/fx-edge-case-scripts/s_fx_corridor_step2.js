/* FX corridor happy path, step 2: real POST /fxTransfers (prepare, payer->FXP)
 * using the FXP's own real conversion condition from step 1, then real
 * POST /transfers (prepare, payer->payee) using the payee's own real ILP
 * packet+condition from step 1. No manual fulfilment crafting — testing
 * whether the sims' own SDKs auto-fulfil now that the backend is fixed. */
const DETERMINING_TRANSFER_ID = '01M2FJRCE84MZBSCPBPRJE9B0B';
const FX_CONDITION = 'mhpOEcRV4pQgZ4XOxWKERFgNxbk1ZBFje9Z9Kq06zQc';
const TRANSACTION_ID = '01M2FJRCH4FA0R3Q6F9GNHREWG';
const ILP_PACKET = 'DIICpgAAAAAAD0JAMjAyNjA5MTQwOTA4NDkwOTbwPRoISj0LkdqNuzUCVlJvoIWiAxMTTfZ0Bl8VFOXacQpnLm1vamFsb29wggJfZXlKaGJXOTFiblFpT25zaVlXMXZkVzUwSWpvaU1UQXdJaXdpWTNWeWNtVnVZM2tpT2lKWVdGZ2lmU3dpWlhod2FYSmhkR2x2YmlJNklqSXdNall0TURrdE1UUlVNRGs2TURnNk5Ea3VNRGsyV2lJc0luQmhlV1ZsSWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW1aemNFbGtJam9pWlRKbExYTnBiVElpTENKd1lYSjBlVWxrVkhsd1pTSTZJazFUU1ZORVRpSXNJbkJoY25SNVNXUmxiblJwWm1sbGNpSTZJams1T1RBd01ESXdNREVpZlgwc0luQmhlV1Z5SWpwN0luQmhjblI1U1dSSmJtWnZJanA3SW1aemNFbGtJam9pWlRKbExYTnBiVEVpTENKd1lYSjBlVWxrVkhsd1pTSTZJazFUU1ZORVRpSXNJbkJoY25SNVNXUmxiblJwWm1sbGNpSTZJams1T1RBd01ERXdNREVpZlgwc0luRjFiM1JsU1dRaU9pSXdNVTB5UmtwU1EwZ3pVbFkyVURGVE1GQldSVFJOVUZnNVJDSXNJblJ5WVc1ellXTjBhVzl1U1dRaU9pSXdNVTB5UmtwU1EwZzBSa0V3VWpOUk5rWTVSMDVJVWtWWFJ5SXNJblJ5WVc1ellXTjBhVzl1Vkhsd1pTSTZleUpwYm1sMGFXRjBiM0lpT2lKUVFWbEZVaUlzSW1sdWFYUnBZWFJ2Y2xSNWNHVWlPaUpDVlZOSlRrVlRVeUlzSW5OalpXNWhjbWx2SWpvaVZGSkJUbE5HUlZJaWZYMA';
const TRANSFER_CONDITION = '8D0aCEo9C5Hajbs1AlZSb6CFogMTE032dAZfFRTl2nE';

(async () => {
  // --- fxTransfers prepare: payer -> FXP ---
  const commitRequestId = id();
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

  // --- transfers prepare: payer -> payee, using payee's OWN real ILP packet ---
  const tHdrs = headers('transfers', PAYER, PAYEE);
  const tIso = await TransformFacades.FSPIOP.transfers.post({
    body: {
      transferId: TRANSACTION_ID, payerFsp: PAYER, payeeFsp: PAYEE,
      amount: { currency: SRC_CCY, amount: '100' },
      ilpPacket: ILP_PACKET, condition: TRANSFER_CONDITION,
      expiration: isoDate(5 * 60 * 1000),
    },
    headers: tHdrs,
  });
  report('POST /transfers (transferId=' + TRANSACTION_ID + ')',
         await send({ svc: 'mlapi', method: 'POST', path: '/transfers', headers: tHdrs, body: tIso.body }));

  console.log('\nwaiting 10s for payee auto-fulfil...');
  await sleep(10000);

  await positions('final positions');

  console.log('\nCOMMIT_REQUEST_ID=' + commitRequestId);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
