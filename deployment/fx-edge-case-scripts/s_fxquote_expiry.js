/* Scenario: FX quote expiry (§10 row 2), variant A — expiration already in the past
 * at the moment quoting-service receives the POST. */
(async () => {
  const conversionRequestId = id();
  const conversionId = id();
  const determiningTransferId = id();
  const expiration = isoDate(-60 * 1000); // 60s in the PAST

  console.log('conversionRequestId=' + conversionRequestId);
  console.log('conversionId=' + conversionId);
  console.log('determiningTransferId=' + determiningTransferId);
  console.log('expiration=' + expiration + '  (now=' + isoDate() + ')');

  const fspiopBody = {
    conversionRequestId,
    conversionTerms: {
      conversionId,
      determiningTransferId,
      initiatingFsp: PAYER,
      counterPartyFsp: FXP,
      amountType: 'SEND',
      sourceAmount: { currency: SRC_CCY, amount: '100' },
      targetAmount: { currency: TGT_CCY },
      expiration,
    },
  };

  const hdrs = headers('fxQuotes', PAYER, FXP);
  const iso = await TransformFacades.FSPIOP.fxQuotes.post({ body: fspiopBody, headers: hdrs });
  console.log('\n--- ISO20022 body sent ---');
  console.log(JSON.stringify(iso.body, null, 1));

  const res = await send({ svc: 'quoting', method: 'POST', path: '/fxQuotes', headers: hdrs, body: iso.body });
  report('POST /fxQuotes (expired expiration)', res);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
