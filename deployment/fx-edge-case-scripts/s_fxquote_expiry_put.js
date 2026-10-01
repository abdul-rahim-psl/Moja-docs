/* §10 row 2 variant B: FX quote response delivered AFTER expirationDate.
 * Acting as the FXP, send PUT /fxQuotes/{ID} well past the quote's own
 * expiration and see whether quoting-service rejects it as expired. */
(async () => {
  const conversionRequestId = id(), conversionId = id(), determiningTransferId = id();
  const expiration = isoDate(15 * 1000); // expires in 15s
  console.log('conversionRequestId=' + conversionRequestId);
  console.log('expiration=' + expiration);

  const postHdrs = headers('fxQuotes', PAYER, FXP);
  const postIso = await TransformFacades.FSPIOP.fxQuotes.post({
    body: { conversionRequestId,
      conversionTerms: { conversionId, determiningTransferId, initiatingFsp: PAYER,
        counterPartyFsp: FXP, amountType: 'SEND',
        sourceAmount: { currency: SRC_CCY, amount: '100' },
        targetAmount: { currency: TGT_CCY }, expiration } },
    headers: postHdrs,
  });
  report('POST /fxQuotes', await send({ svc: 'quoting', method: 'POST', path: '/fxQuotes',
                                        headers: postHdrs, body: postIso.body }));

  console.log('\nwaiting 40s — well past the 15s expiration...');
  await sleep(40000);
  console.log('now = ' + isoDate() + '  (expired at ' + expiration + ')');

  // Act as the FXP: deliver the quote response late.
  const putHdrs = headers('fxQuotes', FXP, PAYER);
  const putIso = await TransformFacades.FSPIOP.fxQuotes.put({
    body: { conversionTerms: { conversionId, determiningTransferId, initiatingFsp: PAYER,
              counterPartyFsp: FXP, amountType: 'SEND',
              sourceAmount: { currency: SRC_CCY, amount: '100' },
              targetAmount: { currency: TGT_CCY, amount: '200' },
              expiration,
              charges: [] } },
    headers: putHdrs, params: { ID: conversionRequestId },
  });
  console.log('\n--- ISO PUT /fxQuotes body ---');
  console.log(JSON.stringify(putIso.body, null, 1));
  report('PUT /fxQuotes/' + conversionRequestId + ' (LATE — past expiration)',
         await send({ svc: 'quoting', method: 'PUT', path: '/fxQuotes/' + conversionRequestId,
                      headers: putHdrs, body: putIso.body }));
  console.log('\nCONVERSION_REQUEST_ID=' + conversionRequestId);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
