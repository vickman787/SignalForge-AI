async function test() {
  const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,dogecoin&vs_currencies=usd");
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
test();
