/* §10 row 4: transfer timeout — prepare, never fulfil, let the timeout handler
 * sweep it. HANDLERS.TIMEOUT.TIMEXP is a 15-second cron, so a 30s expiry is
 * swept within ~45s. */
(async () => {
  const t = await prepareTransfer({ expiryMs: 30 * 1000, label: 'prepare (expires in 30s, never fulfilled)' });
  await sleep(5000);
  await positions('after prepare (payer reserved +10)');

  console.log('\nwaiting 75s for the timeout handler to sweep...');
  await sleep(75000);

  await positions('after timeout sweep (expect reservation released)');
  console.log('\nTRANSFER_ID=' + t.transferId);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
