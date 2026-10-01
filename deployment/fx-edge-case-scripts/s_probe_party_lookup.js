/* Probe: real GET /parties/{Type}/{ID} against ALS, as payer e2e-sim1
 * looking up the already-registered payee party (MSISDN 9990002001 -> e2e-sim2, per §9.9). */
(async () => {
  const hdrs = {
    Accept: 'application/vnd.interoperability.iso20022.parties+json;version=2.0',
    'Content-Type': 'application/vnd.interoperability.iso20022.parties+json;version=2.0',
    Date: new Date().toUTCString(),
    'FSPIOP-Source': PAYER,
  };
  const res = await send({ svc: 'als', method: 'GET', path: '/parties/MSISDN/9990002001', headers: hdrs });
  report('GET /parties/MSISDN/9990002001', res);
  console.log('\nwaiting 10s for the async PUT callback...');
  await sleep(10000);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
