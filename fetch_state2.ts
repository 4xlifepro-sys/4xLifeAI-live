async function fetchState() {
  try {
    const res2 = await fetch("https://ais-dev-b7rm5laubrg2jzlx6maflg-906505016983.europe-west2.run.app/api/state");
    const state = await res2.json();
    console.log("STATE REJECTIONS:");
    console.log(JSON.stringify(state.rejectionStats, null, 2));
    console.log("SIGNALS TODAY COUNT:", state.signalsTodayCount);
    console.log("ACTIVE SIGNALS COUNT:", state.activeSignalsCount);
    console.log("TOTAL SCANS (CYCLES):", state.stats.scanCycles);
    console.log("LATEST SIGNAL:", state.latestSignal?.pair, state.latestSignal?.timestamp);
  } catch (e) {
    console.error(e);
  }
}
fetchState();
