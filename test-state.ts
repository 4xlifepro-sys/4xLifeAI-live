(async () => {
  const res = await fetch('http://localhost:3000/api/state');
  const text = await res.text();
  console.log(text);
})();
