const fetchUrl = async () => {
  try {
    const url = "crteqgjuggyvxxhckm.supabase.co/rest/v1/plans?select=*";
    const res = await fetch(url);
    console.log(res.status);
  } catch (e: any) {
    console.log("no scheme:", e.message);
  }
}
fetchUrl();
