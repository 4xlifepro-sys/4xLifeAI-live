const fetchUrl = async () => {
  try {
    const res = await fetch("https://ais-dev-b7rm5laubrg2jzlx6maflg-906505016983.europe-west2.run.app/crteqgjuggy.supabase.co/auth/v1/token");
    console.log(res.status, await res.text());
  } catch (e: any) {
    console.log(e.message);
  }
}
fetchUrl();
