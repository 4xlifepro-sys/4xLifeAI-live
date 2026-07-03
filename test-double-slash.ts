const fetchUrl = async () => {
  try {
    const res = await fetch("https://supabase.com//rest/v1/plans");
    console.log(res.status, await res.text());
  } catch (e: any) {
    console.log(e.message);
  }
}
fetchUrl();
