async function fetchState() {
  try {
    const res = await fetch("https://ais-dev-b7rm5laubrg2jzlx6maflg-906505016983.europe-west2.run.app/api/health");
    console.log("HEALTH:");
    console.log(await res.text());
    
    const res2 = await fetch("https://ais-dev-b7rm5laubrg2jzlx6maflg-906505016983.europe-west2.run.app/api/state");
    const state = await res2.json();
    console.log("STATE STATS:");
    console.log(JSON.stringify(state.stats, null, 2));
    console.log("REJECTIONS:");
    console.log(JSON.stringify(state.rejectionStats, null, 2));
    console.log("SIGNALS TODAY:", state.signalsTodayCount);
    
    // Also check for signal_audit_log locally if it has it in memory? It fetches from DB.
  } catch (e) {
    console.error(e);
  }
}
fetchState();
