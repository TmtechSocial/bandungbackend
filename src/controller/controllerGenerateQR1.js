const bwipjs = require('bwip-js');

async function generateBarcode(text) {
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: text, 
      scale: 3,
      height: 10,
      includetext: false,
      textxalign: 'center',
    });
    return png;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

module.exports = {
  generateBarcode
};