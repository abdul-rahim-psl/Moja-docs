/* Probe: does e2e-sim-fxp1's own SDK+backend now auto-respond to a real
 * fxQuote request, now that the shared TTK backend's rules/spec files are
 * fixed? We only send the request — we do NOT manually craft the PUT
 * callback ourselves (unlike s_fxquote_expiry_put.js). If the automated
 * path works, quoting-service should receive a real PUT /fxQuotes/{ID}
 * from e2e-sim-fxp1's SDK within a few seconds, visible on topic-event-audit. */
(async () => {
  const conversionRequestId = id(), conversionId = id(), determiningTransferId = id();
  const expiration = isoDate(5 * 60 * 1000); // 5 min out — not testing expiry here
  console.log('conversionRequestId=' + conversionRequestId);

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

  console.log('\nwaiting 15s for a possible automatic PUT /fxQuotes callback from e2e-sim-fxp1...');
  await sleep(15000);
  console.log('CONVERSION_REQUEST_ID=' + conversionRequestId);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
