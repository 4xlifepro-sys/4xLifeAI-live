const test = async () => {
  const urls = [
    '"https://crteqgjuggy.supabase.co"/rest/v1/plans',
    'https://crteqgjuggy.supabase.co /rest/v1/plans',
    'https://crteqgjuggy.supabase.co/rest/v1/ plans',
    'https://crteqgjuggy.supabase.co/rest/v1/plans ',
    'https:// crteqgjuggy.supabase.co',
    'https://crteqgjuggy.supabase.co\n/rest/v1/plans'
  ];
  for (const u of urls) {
    try {
      await fetch(u);
    } catch(e: any) {
      console.log(u, '=>', e.message);
    }
  }
}
test();
