// Run with the deployed app's DATABASE_URL. Creates and removes only its own QA profiles.
async function smoke() {
  const {default:assert}=await import('node:assert/strict');
  const {randomUUID,createHash}=await import('node:crypto');
  const {PostgresStore}=await import(process.cwd()+'/server/database.mjs');
  const {emptyState}=await import(process.cwd()+'/src/model.ts');
  const owners=[0,1].map(()=>createHash('sha256').update(randomUUID()).digest('hex'));
  const db=new PostgresStore(process.env.DATABASE_URL);
  try {
    for(const owner of owners)await db.get(owner,emptyState());
    const id=randomUUID(),context={asOf:new Date().toISOString(),weeklyQuestions:0};
    assert.equal((await db.reserveAssistant(owners[0],id,'QA storage check',context)).kind,'reserved');
    assert.equal((await db.reserveAssistant(owners[0],randomUUID(),'Concurrent question',context)).kind,'busy');
    await db.completeAssistant(owners[0],id,'QA saved answer — no LLM call.');
    const replay=await db.reserveAssistant(owners[0],id,'QA storage check',context);
    assert.equal(replay.kind,'completed');assert.equal(replay.answer,'QA saved answer — no LLM call.');
    assert.equal((await db.reserveAssistant(owners[0],id,'Changed question',context)).kind,'mismatch');
    assert.equal((await db.assistantHistory(owners[0])).length,1);assert.equal((await db.assistantHistory(owners[1])).length,0);
    const failedId=randomUUID();
    assert.equal((await db.reserveAssistant(owners[0],failedId,'Retry after provider failure',context)).kind,'reserved');
    await db.failAssistant(owners[0],failedId);
    assert.equal((await db.reserveAssistant(owners[0],failedId,'Retry after provider failure',context)).kind,'reserved');
    await db.failAssistant(owners[0],failedId);
    // A completed request plus 29 failed calls consumes the 30-request profile allowance.
    for(let n=0;n<27;n++){
      const next=randomUUID();assert.equal((await db.reserveAssistant(owners[0],next,'QA limit check',context)).kind,'reserved');await db.failAssistant(owners[0],next);
    }
    assert.equal((await db.reserveAssistant(owners[0],randomUUID(),'Over allowance',context)).kind,'limit');
    assert.equal((await db.assistantHistory(owners[0])).length,1);
    const reconnect=new PostgresStore(process.env.DATABASE_URL);
    try{assert.equal((await reconnect.assistantHistory(owners[0]))[0].answer,'QA saved answer — no LLM call.');}finally{await reconnect.close();}
    console.log('PostgreSQL assistant smoke passed: persistence, isolation, idempotency, concurrent request exclusion, failure retry, and daily limits. No LLM calls.');
  } finally {
    for(const owner of owners)await db.pool.query('DELETE FROM waypoint_progress WHERE owner_hash=$1',[owner]);
    await db.close();
  }
}
smoke().catch(()=>{console.error('PostgreSQL assistant smoke failed.');process.exitCode=1;});
