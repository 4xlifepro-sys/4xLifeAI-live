const fetchUrl = async () => {
  try {
    const res = await fetch("https://crteqgjuggyvxxhckm.supabase.co/rest/v1/auth/v1/token?grant_type=password", { method: 'POST' });
    console.log(res.status, await res.text());
  } catch (e: any) {
    console.log(e.message);
  }
}
fetchUrl();
