import google from "googlethis";

async function test() {
  try {
    const searchResults = await google.search("Bitcoin price today exact price", { page: 0, safe: false });
    console.log(JSON.stringify(searchResults, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
